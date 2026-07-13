import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumExpectedToDateForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { computeAgencyExecutionSummary, type AgencyExecutionSummary } from "@/lib/monthly-reports";
import type {
  KpiDirection,
  KpiUnit,
  MonthlyReportStatus,
  ReportActionItemStatus,
  ReportTimelineEventType,
} from "@/lib/supabase/database.types";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Busca o relatório de um cliente/mês, ou cria um registro "não iniciado"
 * na hora — assim a tela sempre tem um `report_id` pra pendurar KPIs,
 * acontecimentos e ações, mesmo antes de qualquer gestor abrir a tela.
 * `on conflict do nothing` + select cobre a corrida de duas requisições
 * simultâneas criando o mesmo relatório. */
export async function getOrCreateReport(
  supabase: Supabase,
  clientId: string,
  monthStart: string,
): Promise<{ id: string; status: MonthlyReportStatus }> {
  const { data: existing } = await supabase
    .from("monthly_reports")
    .select("id, status")
    .eq("client_id", clientId)
    .eq("month_start", monthStart)
    .maybeSingle();

  if (existing) return existing;

  await supabase
    .from("monthly_reports")
    .insert({ client_id: clientId, month_start: monthStart, status: "em_andamento" })
    .select("id")
    .maybeSingle();

  const { data: created } = await supabase
    .from("monthly_reports")
    .select("id, status")
    .eq("client_id", clientId)
    .eq("month_start", monthStart)
    .single();

  return created!;
}

export interface ReportKpiRow {
  id: string;
  name: string;
  unit: KpiUnit;
  direction: KpiDirection;
  target: number | null;
  result: number | null;
  previousResult: number | null;
}

export interface ReportTimelineEventRow {
  id: string;
  date: string;
  type: ReportTimelineEventType;
  description: string;
  responsibleName: string | null;
}

export interface ReportActionItemRow {
  id: string;
  description: string;
  responsibleId: string | null;
  responsibleName: string | null;
  dueDate: string | null;
  status: ReportActionItemStatus;
  sentToTaskId: string | null;
}

export interface ReportCommentRow {
  id: string;
  content: string;
  authorName: string | null;
  createdAt: string;
}

export interface ReportViewData {
  clientId: string;
  clientName: string;
  managerName: string | null;
  monthLabel: string;
  monthStart: string;
  reportId: string | null;
  status: MonthlyReportStatus;
  executiveSummary: string | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  isSnapshot: boolean;
  financial: { planned: number; actual: number; expectedToDate: number; status: SpendStatus };
  kpis: ReportKpiRow[];
  execution: AgencyExecutionSummary;
  timelineEvents: ReportTimelineEventRow[];
  comments: ReportCommentRow[];
  nextMonthPriority: string | null;
  nextMonthProblems: string | null;
  nextMonthOpportunities: string | null;
  nextMonthTests: string | null;
  actionItems: ReportActionItemRow[];
}

/** Monta os dados completos do relatório individual — ao vivo (dados atuais
 * do sistema) quando o relatório ainda não foi finalizado, ou a partir do
 * `snapshot` congelado quando já foi (regra da seção 13: relatório
 * finalizado nunca muda, mesmo que orçamento/KPIs mudem depois). */
export async function buildReportViewData(
  supabase: Supabase,
  clientId: string,
  monthParam: string | undefined,
  today: Date,
  monthLabelFormatter: (firstDay: string) => string,
): Promise<ReportViewData | null> {
  const monthRange = monthRangeFromParam(monthParam, today);
  const monthLabel = monthLabelFormatter(monthRange.firstDay);

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, primary_manager:profiles!clients_primary_manager_id_fkey(name)")
    .eq("id", clientId)
    .is("deleted_at", null)
    .single();

  if (!client) return null;
  const managerName = client.primary_manager?.name ?? null;

  const { data: report } = await supabase
    .from("monthly_reports")
    .select(
      "id, status, executive_summary, next_month_priority, next_month_problems, next_month_opportunities, next_month_tests, snapshot, finalized_at, finalized_by:profiles!monthly_reports_finalized_by_fkey(name)",
    )
    .eq("client_id", clientId)
    .eq("month_start", monthRange.firstDay)
    .maybeSingle();

  if (report?.status === "finalizado" && report.snapshot) {
    const snap = report.snapshot as Record<string, unknown>;
    return {
      clientId,
      clientName: client.name,
      managerName,
      monthLabel,
      monthStart: monthRange.firstDay,
      reportId: report.id,
      status: "finalizado",
      executiveSummary: report.executive_summary,
      finalizedByName: report.finalized_by?.name ?? null,
      finalizedAt: report.finalized_at,
      isSnapshot: true,
      financial: snap.financial as ReportViewData["financial"],
      kpis: snap.kpis as ReportKpiRow[],
      execution: snap.execution as AgencyExecutionSummary,
      timelineEvents: snap.timelineEvents as ReportTimelineEventRow[],
      comments: snap.comments as ReportCommentRow[],
      nextMonthPriority: report.next_month_priority,
      nextMonthProblems: report.next_month_problems,
      nextMonthOpportunities: report.next_month_opportunities,
      nextMonthTests: report.next_month_tests,
      actionItems: snap.actionItems as ReportActionItemRow[],
    };
  }

  // Dados ao vivo — mesma fonte financeira central de sempre (Etapa 50:
  // sumPlannedForMonth/sumActualSpendForMonth/sumExpectedToDateForMonth/
  // classifySpendStatus), nunca uma conta paralela.
  const [{ data: sprints }, { data: dailySpend }, { data: tasks }, { data: plannedAllocations }, { data: manualSpendByMonthRaw }] =
    await Promise.all([
      // Sobreposição com o mês (não "começa no mês") — sprint que atravessa
      // mês precisa ser encontrada mesmo com start_date fora do intervalo.
      supabase
        .from("sprints")
        .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
        .eq("client_id", clientId)
        .lte("start_date", monthRange.lastDay)
        .gte("end_date", monthRange.firstDay),
      supabase
        .from("daily_spend")
        .select("date, spend")
        .eq("client_id", clientId)
        .gte("date", monthRange.firstDay)
        .lte("date", monthRange.lastDay),
      supabase
        .from("tasks")
        .select("id, type, status, due_date, recurrence")
        .eq("client_id", clientId)
        .gte("due_date", monthRange.firstDay)
        .lte("due_date", monthRange.lastDay),
      supabase
        .from("sprint_planned_allocations")
        .select("date, planned_amount")
        .eq("client_id", clientId)
        .gte("date", monthRange.firstDay)
        .lte("date", monthRange.lastDay),
      supabase
        .from("sprint_manual_spend_by_month")
        .select("sprint_id, month_start, amount")
        .eq("client_id", clientId)
        .eq("month_start", monthRange.firstDay),
    ]);

  const monthSprintRows = sprints ?? [];
  const plannedAllocationRows = (plannedAllocations ?? []).map((a) => ({ date: a.date, sprintId: "", amount: a.planned_amount }));
  const manualSpendByMonthRows = (manualSpendByMonthRaw ?? []).map((m) => ({
    sprintId: m.sprint_id,
    monthStart: m.month_start,
    amount: m.amount,
  }));
  const planned = sumPlannedForMonth(plannedAllocationRows, monthRange);
  const actual = sumActualSpendForMonth(monthSprintRows, monthRange, dailySpend ?? [], manualSpendByMonthRows);
  const expectedToDate = sumExpectedToDateForMonth(plannedAllocationRows, monthRange, today);
  const status = classifySpendStatus(actual, expectedToDate, planned);
  const execution = computeAgencyExecutionSummary(tasks ?? [], today);

  if (!report) {
    return {
      clientId,
      clientName: client.name,
      managerName,
      monthLabel,
      monthStart: monthRange.firstDay,
      reportId: null,
      status: "nao_iniciado",
      executiveSummary: null,
      finalizedByName: null,
      finalizedAt: null,
      isSnapshot: false,
      financial: { planned, actual, expectedToDate, status },
      kpis: [],
      execution,
      timelineEvents: [],
      comments: [],
      nextMonthPriority: null,
      nextMonthProblems: null,
      nextMonthOpportunities: null,
      nextMonthTests: null,
      actionItems: [],
    };
  }

  const previousMonthParam = shiftMonthParam(monthRange, -1);
  const [
    { data: kpiDefinitions },
    { data: kpiValues },
    { data: previousReport },
    { data: timelineEvents },
    { data: commentSelections },
    { data: actionItems },
  ] = await Promise.all([
    supabase
      .from("client_kpi_definitions")
      .select("id, name, unit, direction, target")
      .eq("client_id", clientId)
      .order("display_order"),
    supabase.from("report_kpi_values").select("kpi_definition_id, result").eq("report_id", report.id),
    supabase
      .from("monthly_reports")
      .select("id")
      .eq("client_id", clientId)
      .eq("month_start", monthRangeFromParam(previousMonthParam, today).firstDay)
      .maybeSingle(),
    supabase
      .from("report_timeline_events")
      .select("id, event_date, type, description, responsible:profiles!report_timeline_events_responsible_id_fkey(name)")
      .eq("report_id", report.id)
      .order("event_date", { ascending: false }),
    supabase
      .from("report_comment_selections")
      .select("id, comment:comments(id, content, created_at, author:profiles!comments_author_id_fkey(name))")
      .eq("report_id", report.id),
    supabase
      .from("report_action_items")
      .select("id, description, due_date, status, sent_to_task_id, responsible_id, responsible:profiles(name)")
      .eq("report_id", report.id)
      .order("created_at"),
  ]);

  let previousValuesById = new Map<string, number>();
  if (previousReport) {
    const { data: previousValues } = await supabase
      .from("report_kpi_values")
      .select("kpi_definition_id, result")
      .eq("report_id", previousReport.id);
    previousValuesById = new Map((previousValues ?? []).map((v) => [v.kpi_definition_id, v.result ?? 0]));
  }

  const resultById = new Map((kpiValues ?? []).map((v) => [v.kpi_definition_id, v.result]));

  const kpis: ReportKpiRow[] = (kpiDefinitions ?? []).map((def) => ({
    id: def.id,
    name: def.name,
    unit: def.unit,
    direction: def.direction,
    target: def.target,
    result: resultById.get(def.id) ?? null,
    previousResult: previousValuesById.get(def.id) ?? null,
  }));

  return {
    clientId,
    clientName: client.name,
    managerName,
    monthLabel,
    monthStart: monthRange.firstDay,
    reportId: report.id,
    status: report.status,
    executiveSummary: report.executive_summary,
    finalizedByName: report.finalized_by?.name ?? null,
    finalizedAt: report.finalized_at,
    isSnapshot: false,
    financial: { planned, actual, expectedToDate, status },
    kpis,
    execution,
    timelineEvents: (timelineEvents ?? []).map((e) => ({
      id: e.id,
      date: e.event_date,
      type: e.type,
      description: e.description,
      responsibleName: e.responsible?.name ?? null,
    })),
    comments: (commentSelections ?? [])
      .filter((s) => s.comment)
      .map((s) => ({
        id: s.comment!.id,
        content: s.comment!.content,
        authorName: s.comment!.author?.name ?? null,
        createdAt: s.comment!.created_at,
      })),
    nextMonthPriority: report.next_month_priority,
    nextMonthProblems: report.next_month_problems,
    nextMonthOpportunities: report.next_month_opportunities,
    nextMonthTests: report.next_month_tests,
    actionItems: (actionItems ?? []).map((a) => ({
      id: a.id,
      description: a.description,
      responsibleId: a.responsible_id,
      responsibleName: a.responsible?.name ?? null,
      dueDate: a.due_date,
      status: a.status,
      sentToTaskId: a.sent_to_task_id,
    })),
  };
}
