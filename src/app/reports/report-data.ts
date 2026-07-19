import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { getCurrentProfile } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import {
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { resolveMonthlyBudget, computeMonthlyExpectedToDateByCalendar } from "@/lib/monthly-budget";
import {
  computeAgencyExecutionSummary,
  computeSprintBehaviorRows,
  type AgencyExecutionSummary,
  type SprintBehaviorRow,
} from "@/lib/monthly-reports";
import type {
  KpiDirection,
  KpiUnit,
  MonthlyReportStatus,
  ReportActionItemDependency,
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

  // Diferente do `existing` acima (onde `null` é um estado de negócio
  // legítimo — "relatório ainda não criado"), aqui a linha DEVERIA existir
  // sempre (acabamos de inserir ou outra requisição concorrente já
  // inseriu) — se vier erro, é falha de infraestrutura de verdade, não
  // "não encontrado"; `requireQuery` lança em vez de deixar `created!`
  // mentir pro TypeScript sobre um valor que pode ser `undefined`.
  const created = await requireQuery<{ id: string; status: MonthlyReportStatus }>(
    supabase.from("monthly_reports").select("id, status").eq("client_id", clientId).eq("month_start", monthStart).single(),
    "monthly_reports:get-or-create",
  );

  // Primeira mutação de relatório deste cliente/mês — registra
  // monthly_report_started. Resolvido aqui (em vez de em cada uma das 8
  // Server Actions que chamam esta função) pra não duplicar a lógica de
  // "só na primeira vez" em cada call site.
  const profile = await getCurrentProfile();
  if (profile && created) {
    await recordOperationalEvent(supabase, actorFromProfile(profile), {
      eventType: OperationalEventType.MONTHLY_REPORT_STARTED,
      entityType: "monthly_report",
      entityId: created.id,
      clientId,
      source: "server",
      metadata: { month_start: monthStart },
    });
  }

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
  title: string | null;
  description: string;
  responsibleId: string | null;
  responsibleName: string | null;
  dueDate: string | null;
  dependency: ReportActionItemDependency | null;
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
  sprintBehavior: SprintBehaviorRow[];
  timelineEvents: ReportTimelineEventRow[];
  comments: ReportCommentRow[];
  analysisWhatWorked: string | null;
  analysisWhatDidntWork: string | null;
  analysisProblems: string | null;
  analysisOpportunities: string | null;
  analysisLearnings: string | null;
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
    .select("id, name, primary_manager:team_members!clients_primary_manager_id_fkey(name)")
    .eq("id", clientId)
    .is("deleted_at", null)
    .single();

  if (!client) return null;
  const managerName = client.primary_manager?.name ?? null;

  const { data: report } = await supabase
    .from("monthly_reports")
    .select(
      "id, status, executive_summary, next_month_priority, next_month_problems, next_month_opportunities, next_month_tests, analysis_what_worked, analysis_what_didnt_work, analysis_problems, analysis_opportunities, analysis_learnings, snapshot, finalized_at, finalized_by:team_members!monthly_reports_finalized_by_fkey(name)",
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
      sprintBehavior: (snap.sprintBehavior as SprintBehaviorRow[]) ?? [],
      timelineEvents: snap.timelineEvents as ReportTimelineEventRow[],
      comments: snap.comments as ReportCommentRow[],
      analysisWhatWorked: report.analysis_what_worked,
      analysisWhatDidntWork: report.analysis_what_didnt_work,
      analysisProblems: report.analysis_problems,
      analysisOpportunities: report.analysis_opportunities,
      analysisLearnings: report.analysis_learnings,
      nextMonthPriority: report.next_month_priority,
      nextMonthProblems: report.next_month_problems,
      nextMonthOpportunities: report.next_month_opportunities,
      nextMonthTests: report.next_month_tests,
      actionItems: snap.actionItems as ReportActionItemRow[],
    };
  }

  // Dados ao vivo — mesma fonte financeira central de sempre: orçamento
  // vigente (`resolveMonthlyBudget`), realizado (`sumActualSpendForMonth`),
  // esperado até hoje (`computeMonthlyExpectedToDateByCalendar`, Etapa 67) e
  // `classifySpendStatus`, nunca uma conta paralela.
  const [sprints, dailySpend, tasks, plannedAllocations, budgetChanges, { count: optimizationsCount }] =
    await Promise.all([
      // Sobreposição com o mês (não "começa no mês") — sprint que atravessa
      // mês precisa ser encontrada mesmo com start_date fora do intervalo.
      requireQuery(
        supabase
          .from("sprints")
          .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
          .eq("client_id", clientId)
          .lte("start_date", monthRange.lastDay)
          .gte("end_date", monthRange.firstDay),
        "sprints",
      ),
      requireQuery(
        supabase
          .from("daily_spend")
          .select("date, spend")
          .eq("client_id", clientId)
          .gte("date", monthRange.firstDay)
          .lte("date", monthRange.lastDay),
        "daily_spend",
      ),
      requireQuery(
        supabase
          .from("tasks")
          .select("id, type, status, due_date, recurrence, sprint_id")
          .eq("client_id", clientId)
          .gte("due_date", monthRange.firstDay)
          .lte("due_date", monthRange.lastDay),
        "tasks",
      ),
      requireQuery(
        supabase
          .from("sprint_planned_allocations")
          .select("sprint_id, date, planned_amount")
          .eq("client_id", clientId)
          .gte("date", monthRange.firstDay)
          .lte("date", monthRange.lastDay),
        "sprint_planned_allocations",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("new_amount, changed_at")
          .eq("client_id", clientId)
          .eq("month", monthRange.firstDay),
        "monthly_budget_changes",
      ),
      // Otimizações do mês (Etapa 74) — revisões estratégicas da conta
      // (account_reviews.reviewed_at) registradas no período, mesma definição
      // usada na Visão Geral; `head: true` porque só a contagem importa aqui.
      supabase
        .from("account_reviews")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .gte("reviewed_at", `${monthRange.firstDay}T00:00:00Z`)
        .lte("reviewed_at", `${monthRange.lastDay}T23:59:59.999Z`),
    ]);

  const monthSprintRows = sprints;
  const plannedAllocationRows = plannedAllocations.map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Etapa 66: orçamento mensal VIGENTE — nunca mais a soma dos planejamentos
  // diários persistidos (ver `resolveMonthlyBudget`).
  const planned = resolveMonthlyBudget(
    budgetChanges.map((c) => ({ newAmount: c.new_amount, changedAt: c.changed_at })),
    sumPlannedForMonth(plannedAllocationRows, monthRange),
  );
  const actual = sumActualSpendForMonth(monthSprintRows, monthRange, dailySpend);
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente.
  const expectedToDate = computeMonthlyExpectedToDateByCalendar(
    planned,
    monthRange,
    today.toISOString().slice(0, 10),
  ).expectedToDate;
  const status = classifySpendStatus(actual, expectedToDate, planned);
  const execution = computeAgencyExecutionSummary(tasks, today, optimizationsCount ?? 0);
  const sprintBehavior = computeSprintBehaviorRows(
    monthSprintRows,
    plannedAllocationRows,
    dailySpend,
    tasks,
    monthRange,
    today,
  );

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
      sprintBehavior,
      timelineEvents: [],
      comments: [],
      analysisWhatWorked: null,
      analysisWhatDidntWork: null,
      analysisProblems: null,
      analysisOpportunities: null,
      analysisLearnings: null,
      nextMonthPriority: null,
      nextMonthProblems: null,
      nextMonthOpportunities: null,
      nextMonthTests: null,
      actionItems: [],
    };
  }

  const previousMonthParam = shiftMonthParam(monthRange, -1);
  const [kpiDefinitions, kpiValues, previousReport, timelineEvents, commentSelections, actionItems] =
    await Promise.all([
      requireQuery(
        supabase
          .from("client_kpi_definitions")
          .select("id, name, unit, direction, target")
          .eq("client_id", clientId)
          .order("display_order"),
        "client_kpi_definitions",
      ),
      requireQuery(
        supabase.from("report_kpi_values").select("kpi_definition_id, result").eq("report_id", report.id),
        "report_kpi_values",
      ),
      // `.maybeSingle()` legítimo: `null` é "não existe relatório do mês
      // anterior" (estado de negócio normal), não falha de consulta.
      requireQuery<{ id: string } | null>(
        supabase
          .from("monthly_reports")
          .select("id")
          .eq("client_id", clientId)
          .eq("month_start", monthRangeFromParam(previousMonthParam, today).firstDay)
          .maybeSingle(),
        "monthly_reports:previous-month",
      ),
      requireQuery(
        supabase
          .from("report_timeline_events")
          .select(
            "id, event_date, type, description, responsible:team_members!report_timeline_events_responsible_id_fkey(name)",
          )
          .eq("report_id", report.id)
          .order("event_date", { ascending: false }),
        "report_timeline_events",
      ),
      requireQuery(
        supabase
          .from("report_comment_selections")
          .select("id, comment:comments(id, content, created_at, author:team_members!comments_author_id_fkey(name))")
          .eq("report_id", report.id),
        "report_comment_selections",
      ),
      requireQuery(
        supabase
          .from("report_action_items")
          .select(
            "id, title, description, due_date, dependency, status, sent_to_task_id, responsible_id, responsible:team_members(name)",
          )
          .eq("report_id", report.id)
          .order("created_at"),
        "report_action_items",
      ),
    ]);

  let previousValuesById = new Map<string, number>();
  if (previousReport) {
    const previousValues = await requireQuery(
      supabase.from("report_kpi_values").select("kpi_definition_id, result").eq("report_id", previousReport.id),
      "report_kpi_values:previous-month",
    );
    previousValuesById = new Map(previousValues.map((v) => [v.kpi_definition_id, v.result ?? 0]));
  }

  const resultById = new Map(kpiValues.map((v) => [v.kpi_definition_id, v.result]));

  const kpis: ReportKpiRow[] = kpiDefinitions.map((def) => ({
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
    sprintBehavior,
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
    analysisWhatWorked: report.analysis_what_worked,
    analysisWhatDidntWork: report.analysis_what_didnt_work,
    analysisProblems: report.analysis_problems,
    analysisOpportunities: report.analysis_opportunities,
    analysisLearnings: report.analysis_learnings,
    nextMonthPriority: report.next_month_priority,
    nextMonthProblems: report.next_month_problems,
    nextMonthOpportunities: report.next_month_opportunities,
    nextMonthTests: report.next_month_tests,
    actionItems: (actionItems ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      responsibleId: a.responsible_id,
      responsibleName: a.responsible?.name ?? null,
      dueDate: a.due_date,
      dependency: a.dependency,
      status: a.status,
      sentToTaskId: a.sent_to_task_id,
    })),
  };
}
