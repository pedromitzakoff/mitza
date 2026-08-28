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
import { groupChannelSpendBySprintId, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { resolveConsolidatedMonthlyPlanned, primaryGoalResultTypeFilter } from "@/lib/client-plan";
import { resolveClientMonthlyActuals } from "@/lib/client-actuals";
import { computePerformanceSummary, type PerformanceSummary } from "@/lib/performance";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { buildCampaignSummaries, type CampaignSummary } from "@/lib/campaign-analytics";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries, type CreativeSummary } from "@/lib/creative-analytics";
import {
  AVAILABLE_TRAFFIC_CHANNELS,
  resolveClientChannelScopeOptions,
  resolveSelectedChannelScope,
  type ChannelScope,
  type TrafficChannel,
} from "@/lib/traffic-channels";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { PerformanceRecordRawRow } from "@/app/operation/operation-data";
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
  /** Etapa "Relatório de Performance das Campanhas": objetivo estruturado do
   * cliente (`clients.performance_goal`) — `null` = sem objetivo configurado
   * ainda, `report-view.tsx` mostra o mesmo link "Configurar objetivo" já
   * usado na Visão Geral, nunca inventa "leads" como padrão. */
  performanceGoal: PerformanceGoal | null;
  /** Opções de canal pra este cliente (Meta/Google/Consolidado), já na ordem
   * certa — mesma fonte única (`resolveClientChannelScopeOptions`,
   * lib/traffic-channels.ts) que a Visão Geral do cliente usa; nunca uma
   * segunda regra de "quais canais mostrar". */
  channelScopeOptions: ChannelScope[];
  /** Canal efetivamente selecionado (querystring `metricsChannel`, mesmo
   * nome de param que `VisaoGeralChannelSwitch` já usa — reaproveitado tal
   * qual, nunca uma segunda convenção de nome). */
  channelScope: ChannelScope;
  /** Investimento do canal/consolidado selecionado — alimenta o "Resumo do
   * período" (`MonthlyKpiSummary`, mesmo componente da Visão Geral do
   * cliente). Sempre um número (nunca `null`) pelo mesmo motivo de
   * `resolveClientMonthlyActuals`: um canal sem investimento no escopo não é
   * um canal presente em `channelScopeOptions`. */
  scopedInvestment: number;
  /** `null` só quando `performanceGoal` também é `null` — mesma regra do
   * `MonthlyKpiSummary` que a Visão Geral do cliente já usa; nenhum cálculo
   * novo, é a mesma `computePerformanceSummary` (lib/performance.ts). */
  performanceSummary: PerformanceSummary | null;
  targetCostPerResult: number | null;
  /** Campanhas do escopo selecionado (todas as do cliente quando
   * "consolidated") — nunca misturadas sem identificação: cada
   * `CampaignSummary` carrega seu próprio `channel`. Fonte:
   * `campaign_daily_metrics` via `getCampaignDailyMetricsForPeriod` +
   * `buildCampaignSummaries` (lib/campaign-analytics.ts) — nenhuma métrica
   * nova derivada aqui, só o que a fonte real já fornece por campanha. */
  campaigns: CampaignSummary[];
  /** Etapa "Três níveis de análise": criativos do período — fonte
   * (`ad_creative_daily_metrics` via `getAdCreativeDailyMetricsForPeriod`,
   * mesma usada pela seção "Criativos" do Analytics) NÃO tem coluna de
   * canal (é implicitamente só Meta — `creative_name` = `ad_name` do Meta,
   * ver `lib/creative-analytics.ts`). Por isso: escopo "google" sempre
   * devolve `[]` aqui (nunca atribui um criativo Meta a uma visão Google);
   * "meta"/"consolidated" devolvem o mesmo conjunto (não há o que
   * filtrar). `report-view.tsx` usa `channelScope === "google"` (não
   * `creatives.length === 0`) pra decidir entre a mensagem "Criativos do
   * Google ainda não estão disponíveis" e um EmptyState genérico — mesma
   * distinção que a Analytics já faz. */
  creatives: CreativeSummary[];
}

/** Monta os dados completos do relatório individual — ao vivo (dados atuais
 * do sistema) quando o relatório ainda não foi finalizado, ou a partir do
 * `snapshot` congelado quando já foi (regra da seção 13: relatório
 * finalizado nunca muda, mesmo que orçamento/KPIs mudem depois). */
export async function buildReportViewData(
  supabase: Supabase,
  clientId: string,
  monthParam: string | undefined,
  channelParam: string | undefined,
  today: Date,
  monthLabelFormatter: (firstDay: string) => string,
): Promise<ReportViewData | null> {
  const monthRange = monthRangeFromParam(monthParam, today);
  const monthLabel = monthLabelFormatter(monthRange.firstDay);

  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, status, performance_goal, media_channels, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(name)",
    )
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

  // Etapa "Relatório de Performance das Campanhas": investimento/resultado/
  // custo por escopo (canal/consolidado) + campanhas do período — SEMPRE
  // recalculados ao vivo, mesmo pra um relatório "finalizado" (o `snapshot`
  // dele é de antes desta etapa e nunca teve essa dimensão; congelar isso
  // também exigiria estender o formato do snapshot, fora do escopo desta
  // rodada — dado histórico de mídia de um mês encerrado já é estável na
  // prática, então recalcular ao vivo aqui não diverge do que seria
  // congelado). Reaproveita EXATAMENTE os mesmos resolvedores da Visão Geral
  // do cliente (`resolveClientMonthlyActuals`, `computePerformanceSummary`,
  // `resolveClientChannelScopeOptions`/`resolveSelectedChannelScope`) e da
  // seção "Campanhas" do Analytics (`getCampaignDailyMetricsForPeriod` +
  // `buildCampaignSummaries`) — nenhuma fórmula nova.
  const [sprintsForActuals, dailySpendChannelRows, channelSpendRows, campaignDailyMetricRows, adCreativeDailyMetricRows] =
    await Promise.all([
      requireQuery(
        supabase
          .from("sprints")
          .select("id, start_date, end_date")
          .eq("client_id", clientId)
          .lte("start_date", monthRange.lastDay)
          .gte("end_date", monthRange.firstDay),
        "sprints:actuals",
      ),
      requireQuery(
        supabase
          .from("daily_spend")
          .select("date, spend, channel")
          .eq("client_id", clientId)
          .gte("date", monthRange.firstDay)
          .lte("date", monthRange.lastDay),
        "daily_spend:channel",
      ),
      requireQuery(
        supabase
          .from("sprint_channel_spend")
          .select("sprint_id, channel, spend_source, manual_actual_spend")
          .eq("client_id", clientId),
        "sprint_channel_spend",
      ),
      getCampaignDailyMetricsForPeriod(supabase, clientId, { start: monthRange.firstDay, end: monthRange.lastDay }),
      getAdCreativeDailyMetricsForPeriod(supabase, clientId, { start: monthRange.firstDay, end: monthRange.lastDay }),
    ]);

  const performanceRecordRowsForActuals = await resolvePerformanceRowsForSprints(
    supabase,
    sprintsForActuals.map((s) => ({ id: s.id, client_id: clientId, start_date: s.start_date, end_date: s.end_date })),
  );
  const performanceRecordsForActuals: PerformanceRecordRawRow[] = performanceRecordRowsForActuals.map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  const channelSpendOverrideRowsForActuals: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));

  const performanceGoal = client.performance_goal;
  const actuals = resolveClientMonthlyActuals({
    sprints: sprintsForActuals.map((s) => ({ sprintId: s.id, start_date: s.start_date, end_date: s.end_date })),
    dailySpendChannel: (dailySpendChannelRows ?? []).map((d) => ({ date: d.date, channel: d.channel as TrafficChannel, spend: d.spend })),
    channelSpendOverrides: channelSpendOverrideRowsForActuals,
    performanceRecords: performanceRecordsForActuals,
    performanceGoal,
  });

  const channelScopeOptions = resolveClientChannelScopeOptions(client.media_channels);
  const channelScope = resolveSelectedChannelScope(channelParam, client.media_channels);
  const scopedMetrics = channelScope === "consolidated" ? actuals.consolidated : actuals.byChannel[channelScope];
  const scopedInvestment = scopedMetrics?.investment ?? 0;
  const targetCostPerResult =
    channelScope === "consolidated"
      ? client.target_cost_per_result
      : (actuals.byChannel[channelScope]?.cpa ?? client.target_cost_per_result);
  const performanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: channelScope,
        records: performanceRecordsForActuals,
        resultType: performanceGoal,
        consolidatedActualSpend: actuals.consolidated.investment ?? 0,
        targetCostPerResult,
        channelActualSpend: channelScope !== "consolidated" ? { [channelScope]: scopedInvestment } : undefined,
      })
    : null;

  // Campanhas do escopo selecionado — "consolidated" mostra as de TODOS os
  // canais configurados do cliente (cada uma já badge com seu próprio
  // `channel`, nunca misturadas sem identificação); um canal específico
  // filtra só as campanhas daquele canal.
  const scopedCampaignRows =
    channelScope === "consolidated" ? campaignDailyMetricRows : campaignDailyMetricRows.filter((r) => r.channel === channelScope);
  const campaigns = buildCampaignSummaries(scopedCampaignRows);

  // Criativos: `ad_creative_daily_metrics` não tem coluna de canal (só
  // Meta, ver comentário de `ReportViewData.creatives`) — escopo "google"
  // nunca atribui um criativo Meta a essa visão, então devolve `[]` aqui em
  // vez de deixar `report-view.tsx` inferir isso de uma lista vazia por
  // acaso (que também aconteceria com um cliente Meta sem nenhum criativo).
  const creatives = channelScope === "google" ? [] : buildCreativeSummaries(adCreativeDailyMetricRows);

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
      performanceGoal,
      channelScopeOptions,
      channelScope,
      scopedInvestment,
      performanceSummary,
      targetCostPerResult,
      campaigns,
      creatives,
    };
  }

  // Dados ao vivo — mesma fonte financeira central de sempre: orçamento
  // vigente (`resolveConsolidatedMonthlyPlanned`), realizado
  // (`sumActualSpendForMonth`), esperado até hoje
  // (`computeMonthlyExpectedToDateByCalendar`, Etapa 67) e
  // `classifySpendStatus`, nunca uma conta paralela.
  const [sprints, dailySpend, tasks, plannedAllocations, budgetChanges, { count: optimizationsCount }] = await Promise.all([
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
    // Etapa "Múltiplos Objetivos": só o objetivo PRINCIPAL — nunca deixa a
    // meta de um objetivo secundário aparecer no Relatório do principal.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, month, new_amount, changed_at")
        .eq("client_id", clientId)
        .eq("month", monthRange.firstDay)
        .or(primaryGoalResultTypeFilter(client.performance_goal)),
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
      performanceGoal,
      channelScopeOptions,
      channelScope,
      scopedInvestment,
      performanceSummary,
      targetCostPerResult,
      campaigns,
      creatives,
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
    performanceGoal,
    channelScopeOptions,
    channelScope,
    scopedInvestment,
    performanceSummary,
    targetCostPerResult,
    campaigns,
    creatives,
  };
}
