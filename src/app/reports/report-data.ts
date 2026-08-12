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
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { groupChannelSpendBySprintId } from "@/lib/channel-spend";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { resolveConsolidatedMonthlyPlanned } from "@/lib/client-plan";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import {
  computeAgencyExecutionSummary,
  computeSprintBehaviorRows,
  type AgencyExecutionSummary,
  type SprintBehaviorRow,
} from "@/lib/monthly-reports";
import type {
  ClientContractStatus,
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

export interface ReportViewData {
  clientId: string;
  clientName: string;
  /** Status contratual do cliente — página continua acessível em modo de
   * consulta mesmo quando pausado/encerrado (nunca filtrado aqui), só
   * exibe um banner (ver `report-view.tsx`). */
  clientContractStatus: ClientContractStatus;
  managerName: string | null;
  monthLabel: string;
  monthStart: string;
  reportId: string | null;
  status: MonthlyReportStatus;
  executiveSummary: string | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  isSnapshot: boolean;
  /** Etapa "Horizonte de Planejamento": `null` = cliente sem horizonte
   * configurado (comportamento idêntico a antes desta etapa). Repassado
   * pra `report-view.tsx` resolver o mesmo horizonte usado no cálculo
   * financeiro acima, pro rótulo "Período encerrado"/"não iniciado" nunca
   * divergir do número real. `null` também pra reports finalizados
   * (snapshot histórico, sempre de mês já encerrado). */
  planningEndDate: string | null;
  financial: { planned: number; actual: number; expectedToDate: number; status: SpendStatus };
  kpis: ReportKpiRow[];
  execution: AgencyExecutionSummary;
  sprintBehavior: SprintBehaviorRow[];
  timelineEvents: ReportTimelineEventRow[];
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
    .select("id, name, status, primary_manager:team_members!clients_primary_manager_id_fkey(name)")
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
      clientContractStatus: client.status,
      planningEndDate: null,
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
  // vigente (`resolveConsolidatedMonthlyPlanned`), realizado
  // (`sumActualSpendForMonth`), esperado até hoje
  // (`computeMonthlyExpectedToDateByCalendar`, Etapa 67) e
  // `classifySpendStatus`, nunca uma conta paralela.
  const [sprints, dailySpend, tasks, plannedAllocations, budgetChanges, { count: optimizationsCount }, channelSpendRows] =
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
      // Etapa "Migração Multicanal dos Consumidores": todos os canais (nunca
      // mais só `channel = 'meta'`) — `resolveConsolidatedMonthlyPlanned`
      // soma os canais com plano.
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("channel, month, new_amount, changed_at")
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
      // Investimento manual multicanal (`sprint_channel_spend`, adotada como
      // fonte de verdade — ver `resolveManualActualSpend`, lib/effective-spend.ts).
      requireQuery(
        supabase
          .from("sprint_channel_spend")
          .select("sprint_id, channel, spend_source, manual_actual_spend")
          .eq("client_id", clientId),
        "sprint_channel_spend",
      ),
    ]);

  // Etapa "Horizonte de Planejamento": cliente de evento (campanha que
  // termina antes do fim do mês) — null (comportamento idêntico a antes
  // desta etapa) pra qualquer cliente sem horizonte configurado. Repassado
  // cru (`planningEndDate`) no retorno pra `report-view.tsx` resolver o
  // mesmo horizonte pro rótulo "Período encerrado"/"não iniciado".
  const planningEndDate = await getClientMonthHorizon(supabase, clientId, monthRange.firstDay);
  const planningHorizon = resolvePlanningHorizon(monthRange, planningEndDate);

  // Investimento manual multicanal — resolve `manual_actual_spend` de cada
  // sprint ANTES de `sumActualSpendForMonth`/`computeSprintBehaviorRows`
  // (ver `resolveManualActualSpend`, lib/effective-spend.ts).
  const channelSpendBySprintId = groupChannelSpendBySprintId(
    (channelSpendRows ?? []).map((r) => ({
      sprintId: r.sprint_id,
      channel: r.channel,
      spend_source: r.spend_source,
      manual_actual_spend: r.manual_actual_spend,
    })),
  );
  const monthSprintRows = sprints.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(sprint.manual_actual_spend, channelSpendBySprintId.get(sprint.id) ?? []),
  }));
  const plannedAllocationRows = plannedAllocations.map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Etapa 66: orçamento mensal VIGENTE — nunca mais a soma dos planejamentos
  // diários persistidos (ver `resolveConsolidatedMonthlyPlanned`). Etapa
  // "Migração Multicanal dos Consumidores": consolidado real (Meta + Google
  // com plano), nunca mais só o que o Meta tem configurado.
  const planned = resolveConsolidatedMonthlyPlanned(
    AVAILABLE_TRAFFIC_CHANNELS,
    budgetChanges.map((c) => ({ channel: c.channel as TrafficChannel, month: c.month, changedAt: c.changed_at, investment: c.new_amount })),
    monthRange.firstDay,
    sumPlannedForMonth(plannedAllocationRows, monthRange),
  );
  const actual = sumActualSpendForMonth(monthSprintRows, monthRange, dailySpend);
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente.
  const expectedToDate = computeMonthlyExpectedToDateByCalendar(
    planned,
    planningHorizon,
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
      clientContractStatus: client.status,
      planningEndDate,
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
  const [kpiDefinitions, kpiValues, previousReport, timelineEvents, actionItems] =
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
    clientContractStatus: client.status,
    planningEndDate,
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
