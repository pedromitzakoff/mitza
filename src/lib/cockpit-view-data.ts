import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireQuery } from "@/lib/require-query";
import {
  assertSingleCurrentSprint,
  currentMonthRange,
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import {
  resolveBudgetEffectiveDate,
  computeMonthlyExpectedToDateByCalendar,
  resolvePlanningHorizon,
  computeMonthlyBudgetPlan,
  computeNeededDailyRate,
  getRemainingEligibleDaysIncludingToday,
  listDatesInclusive,
} from "@/lib/monthly-budget";
import { resolveClientMonthlyGoals, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import { consolidateAdditive, type ChannelMetrics } from "@/lib/channel-metrics";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatShortDate, formatMonthLabel } from "@/lib/format";
import { contractStatusBannerText } from "@/lib/client-fields";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { evaluateCpaDiagnostic } from "@/lib/metric-diagnostics";
import { listClientGoals, resolvePrimaryGoal, resolveChannelGoal, type ClientGoal } from "@/lib/client-goals";
import { computePerformanceSummary } from "@/lib/performance";
import { resolvePerformanceRowsForSprints, getDailyPerformanceRowsForPeriod } from "@/lib/performance-queries";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import {
  AVAILABLE_TRAFFIC_CHANNELS,
  resolveClientMediaChannels,
  resolveClientChannelScopeOptions,
  resolveSelectedChannelScope,
  TRAFFIC_CHANNELS,
  type ChannelScope,
  type TrafficChannel,
} from "@/lib/traffic-channels";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import type { DashboardChannelDataIssue } from "@/app/clients/channel-data-issue";
import type { DataAttention } from "@/lib/data-trust";
import { buildMetasHref } from "@/app/clients/[id]/metas/page";
import { groupChannelsByResultType } from "@/lib/cockpit-result-groups";
import { buildCockpitInsights, type CockpitInsight } from "@/lib/cockpit-diagnostics";
import { loadDadosPageData } from "@/app/clients/dados-data";
import { scheduleCreativePreviewRefreshIfStale } from "@/lib/creative-preview-refresh";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import {
  type CockpitResultCardView,
  type CockpitCostCardView,
  type CockpitGoalEditAffordance,
} from "@/app/clients/cockpit-meta-ritmo-section";
import {
  resolveCockpitFilterState,
  filterCampaignDailyRows,
  filterCampaignSummaries,
  filterAdSetDailyRows,
  filterCreativeDailyRows,
  resolveFilteredExecutiveCardOverride,
} from "@/lib/cockpit-global-filter";
import {
  resolveMetaAdAccountId,
  fetchAccountPeriodReachSnapshot,
  fetchAccountBalanceSnapshot,
  buildCockpitAdPerformanceData,
  type MetaAdAccountBalanceSnapshot,
} from "@/lib/meta-ads-dashboard/dashboard-data";
import { buildMetricCardViewModels, type MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";
import { campaignSummaryToRow, type ExplorationRow } from "@/lib/meta-ads-dashboard/exploration-data";
import type { AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import type { ChannelBreakdownRowView } from "@/app/clients/cockpit-channel-breakdown";
import { resolveEffectiveDashboardMetrics, type DashboardMetricKey, type MetricView } from "@/lib/dashboard-metrics";
import { resolveDashboardMetricViews } from "@/lib/dashboard-metrics-resolver";
import { loadDashboardGoalPerformanceData } from "@/lib/dashboard-metrics-data";
import { buildCockpitDailyEvolutionPoints } from "@/lib/cockpit-daily-evolution";
import { buildGoalEvolutionSeries, resolveDefaultEvolutionSeriesId, type EvolutionSeriesOption } from "@/lib/cockpit-evolution-merge";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/date-range";

/**
 * Correção definitiva da divergência Dashboard interno × link compartilhado
 * (pedido explícito do usuário): até aqui, `/r/[token]` nunca renderizava o
 * Cockpit — era uma implementação inteiramente separada (o Relatório de
 * Performance). Esta função é o núcleo ÚNICO de carregamento/cálculo do
 * Cockpit, extraído de `/clients/[id]/page.tsx` (zero lógica nova), agora
 * parametrizado por `viewer` — é ELE quem decide, no servidor, o que existe
 * no `CockpitViewModel` resultante. Nunca uma segunda cópia: tanto
 * `/clients/[id]/page.tsx` (agência) quanto `/r/[token]/page.tsx`
 * (compartilhado, sem login) chamam esta função e renderizam o MESMO
 * `<CockpitView>`.
 *
 * Segurança no servidor (nunca só esconder botão): com `viewer.kind ===
 * "shared"`, os campos administrativos (`budget.canEdit`,
 * `resultCards[].result.edit`/`cost.edit`, `metasHref`,
 * `dashboardMetricsConfigHref`, `channelBreakdownRows[].configureObjectiveHref`,
 * `adBalance`) nunca são CALCULADOS — ficam `false`/`null` na origem, nunca
 * computados e só escondidos na view. Como vários cards do Cockpit são
 * Client Component (`cockpit-goal-card.tsx`, `cockpit-ad-exploration-section.tsx`
 * etc.), qualquer prop que chegasse até eles seria serializada no payload
 * RSC enviado ao navegador mesmo sem ser renderizada — por isso o corte
 * precisa ser na ORIGEM do dado, não na árvore de componentes.
 */
export type CockpitViewer = { kind: "agency"; isAdmin: boolean } | { kind: "shared" };

export interface CockpitBanner {
  tone: "red" | "green" | "amber";
  text: string;
}

export interface CockpitViewModel {
  clientId: string;
  clientName: string;
  /** Logo do cliente (cabeçalho unificado) — mesmo campo que já alimentava
   * `ClientWorkspaceHeader`/`ClientAvatar`, nenhuma segunda fonte. */
  clientAvatarUrl: string | null;
  /** Status CONTRATUAL (nunca confundido com saúde de performance) — mesmo
   * registro (`CLIENT_STATUS_LABEL`/`CLIENT_STATUS_BADGE_CLASSES`) que já
   * exibia o badge "Ativo" no header antigo; seguro pros dois visitantes
   * (o próprio cliente já sabe se seu contrato está ativo). */
  clientStatus: ClientContractStatus;
  /** `null` no modo compartilhado — o drawer "Informações da conta"
   * (sincronização, link de compartilhamento, histórico) é só da agência;
   * presente = `clientId` pra `AccountInfoDrawerLauncher`. */
  accountInfoClientId: string | null;
  /** Raiz da rota que está exibindo este modelo (`/clients/{id}` na agência,
   * `/r/{token}` no link compartilhado) — usada só pra montar hrefs de
   * navegação de mês (`MonthSelect`), nunca pra decidir permissão. */
  basePath: string;
  headerChannelsLabel: string;
  /** Etapa "Visualizações independentes por canal": opções do seletor já na
   * ordem certa pra ESTE cliente (`resolveClientChannelScopeOptions`) —
   * comprimento 1 (ou 0) = nada pra selecionar, seletor não aparece
   * (ver `cockpit-view.tsx`). */
  channelScopeOptions: ChannelScope[];
  /** Canal efetivamente em exibição agora — já resolvido/validado pra este
   * cliente (`resolveSelectedChannelScope`), nunca o parâmetro bruto da URL. */
  channelScope: ChannelScope;
  /** `null` no modo compartilhado — `/metas` é uma rota autenticada,
   * inacessível a um visitante sem login. */
  metasHref: string | null;
  prevMonthHref: string;
  nextMonthHref: string;
  monthParam: string;
  /** Etapa "Seletor global de período" — único estado que `PeriodRangePicker`
   * precisa pra se desenhar/reabrir (atalho ativo, intervalo consultado).
   * `monthParam`/`prevMonthHref`/`nextMonthHref` acima continuam existindo
   * só pro "Ver Metas"/editor inline (sempre mensais, estrutura intocada). */
  periodResolved: ResolvedPeriod;
  filterText: string;
  filterMode: ReturnType<typeof resolveCockpitFilterState>["mode"];
  isFilterActive: boolean;
  banners: CockpitBanner[];
  budget: {
    headline: {
      monthActual: number;
      monthPlanned: number;
      monthExpectedToDate: number;
      monthStatus: SpendStatus;
      neededDailyRate: number | null;
    };
    channels: { channel: TrafficChannel; planned: number | null }[];
    /** `false` sempre no modo compartilhado — nunca calculado a partir de
     * `isAdmin` nesse caso (ver nota de segurança acima). */
    canEdit: boolean;
  };
  resultCards: { result: CockpitResultCardView; status: SpendStatus | null; cost: CockpitCostCardView }[];
  insights: CockpitInsight[];
  channelBreakdownRows: ChannelBreakdownRowView[];
  showMetaSection: boolean;
  /** `null` no modo compartilhado — saldo da conta Meta é informação de
   * billing da agência, nunca do cliente (decisão explícita do usuário). */
  adBalance: MetaAdAccountBalanceSnapshot | null;
  adMetricCards: MetricCardViewModel[];
  dataFreshness: { lastSuccessAt: string | null };
  hasConfiguredDashboardMetrics: boolean;
  dashboardMetricViews: Map<DashboardMetricKey, MetricView>;
  /** `null` no modo compartilhado — "Cadastro do Cliente" é `/clients/[id]/edit`,
   * autenticado. */
  dashboardMetricsConfigHref: string | null;
  evolution: {
    series: EvolutionSeriesOption[];
    defaultLeftId: string;
    defaultRightId: string;
    freshness: { latestDataLabel: string | null; latestSyncLabel: string | null };
    emptyMessage: string;
  };
  adExploration: {
    campaigns: ExplorationRow[];
    adSetDailyRows: AdSetDailyMetricRow[];
    creativeDailyRows: AdCreativeDailyMetricRow[];
  } | null;
  externalLinks: { label: string; href: string }[];
}

/** Núcleo puro já existente, reaproveitado sem mudança (ver
 * `findChannelDataIssue` original em `[id]/page.tsx`, agora re-exportado de
 * lá pra manter compatibilidade de import nos testes). */
export function buildCockpitMonthHref(basePath: string, month: string | null): string {
  return `${basePath}${month ? `?month=${month}` : ""}`;
}

/** Mesmo padrão de `buildCockpitMonthHref` — preserva o mês selecionado
 * junto da troca de canal (`?month=...&canal=...`), nunca reseta um ao
 * trocar o outro. `canal` sempre explícito na URL (inclusive
 * "consolidated") pra sobreviver a um refresh/link compartilhado sem
 * voltar pro default (`resolveSelectedChannelScope` só cai no default
 * quando o parâmetro está AUSENTE). */
export function buildCockpitChannelHref(basePath: string, month: string | null, channel: ChannelScope): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  params.set("canal", channel);
  return `${basePath}?${params.toString()}`;
}

export async function buildCockpitViewModel(
  supabase: SupabaseClient,
  clientId: string,
  options: {
    monthQueryParam: string | undefined;
    /** Etapa "Seletor global de período": atalho ativo (`?period=`) + datas
     * personalizadas (`?start=`/`?end=`) — `monthQueryParam` continua lido
     * SÓ como fallback de link antigo (ver `resolvePeriod`,
     * `lib/date-range.ts`), nunca mais escrito por esta tela. */
    periodParam: string | undefined;
    startParam: string | undefined;
    endParam: string | undefined;
    filterTextParam: string | undefined;
    filterModeParam: string | undefined;
    channelScopeParam: string | undefined;
    viewer: CockpitViewer;
    basePath: string;
    extraBanners?: CockpitBanner[];
  },
): Promise<CockpitViewModel> {
  const {
    monthQueryParam,
    periodParam,
    startParam,
    endParam,
    filterTextParam,
    filterModeParam,
    channelScopeParam,
    viewer,
    basePath,
    extraBanners = [],
  } = options;
  const isAdmin = viewer.kind === "agency" && viewer.isAdmin;
  const cockpitFilter = resolveCockpitFilterState(filterTextParam, filterModeParam);

  function buildContextHref(overrides: { month?: string }): string {
    return buildCockpitMonthHref(basePath, overrides.month ?? monthQueryParam ?? null);
  }

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(name), performance_goal, target_cost_per_result, avatar_url, media_channels, dashboard_url, balance_url, monthly_closing_sheet_url, dashboard_metrics",
    )
    .eq("id", clientId)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[buildCockpitViewModel] falha ao buscar cliente ${clientId}:`, clientQueryError);
  if (!client) notFound();

  const hasConfiguredDashboardMetrics = (client.dashboard_metrics ?? []).length > 0;
  const effectiveDashboardMetrics = resolveEffectiveDashboardMetrics(client.dashboard_metrics ?? [], client.performance_goal);

  const allClientChannels = AVAILABLE_TRAFFIC_CHANNELS.filter((c) => resolveClientMediaChannels(client.media_channels).includes(c));

  /**
   * Etapa "Visualizações independentes por canal" (pedido explícito do
   * usuário: "não faz sentido somar os dois... quero visualizações
   * independentes"): `channelScope` é a ÚNICA fonte de verdade de "qual(is)
   * canal(is) esta renderização enxerga" — reaproveita 100% de
   * `lib/traffic-channels.ts` (`resolveClientChannelScopeOptions`/
   * `resolveSelectedChannelScope`, construídas numa etapa anterior pra essa
   * MESMA finalidade mas nunca ligadas ao Cockpit). `clientChannels` (nome
   * mantido — é o único identificador que todo o resto da função já usa
   * pra decidir "quais canais entram no cálculo") vira o recorte efetivo: o
   * MESMO array de sempre em "Consolidado" (nenhuma mudança pra cliente de
   * 1 canal só, a grande maioria), ou só o canal escolhido quando o usuário
   * seleciona um — toda a cascata downstream (orçamento, grupos de
   * resultado, saldo/indicadores/exploração Meta, quebra por canal) já é
   * inteiramente escrita em cima de `clientChannels`, então filtrar aqui
   * nesta única linha propaga pra tudo, sem precisar repetir a lógica em
   * cada seção.
   */
  const channelScopeOptions = resolveClientChannelScopeOptions(client.media_channels);
  const channelScope = resolveSelectedChannelScope(channelScopeParam, client.media_channels);
  const clientChannels: TrafficChannel[] = channelScope === "consolidated" ? allClientChannels : allClientChannels.filter((c) => c === channelScope);

  const today = todayUTC();
  const todayStr = todayDateString();

  /**
   * Etapa "Seletor global de período" (pedido explícito do usuário):
   * `resolvePeriod` (núcleo puro, `lib/date-range.ts`) é a ÚNICA resolução
   * de período — nunca uma segunda lógica de datas por tela. Dois conceitos
   * nunca confundidos (ver doc-comment do módulo):
   *
   * - `{firstDay,lastDay}` (ANCHOR, mês de referência) — ESTRUTURA DE METAS
   *   100% intocada: sprints, orçamento planejado, editor inline, "Ver
   *   Metas" continuam exatamente como sempre, só que agora o "mês"
   *   vem de `periodResolved.monthParam` em vez de só `?month=` cru.
   * - `{queryFirstDay,queryLastDay}` (intervalo CONSULTADO) — rege
   *   indicadores Meta Ads, evolução, Campanhas/Anúncios (seção 5 do
   *   pedido: "respeitar exatamente o intervalo selecionado").
   * - `isMonthAligned` — `false` pra Hoje/Ontem/Últimos 7/30 dias/
   *   Personalizado: ritmo/barra/edição de meta não fazem sentido pra uma
   *   janela que não é "o mês inteiro" (decisão explícita do usuário) —
   *   os 3 cards principais mostram os números REAIS do intervalo, sem
   *   veredito de ritmo fabricado contra uma meta mensal incompatível.
   */
  const periodResolved = resolvePeriod({ period: periodParam, start: startParam, end: endParam, month: monthQueryParam }, today);
  const isMonthAligned = periodResolved.isMonthAligned;
  const queryFirstDay = periodResolved.range.firstDay;
  const queryLastDay = periodResolved.range.lastDay;

  const { firstDay, lastDay } = monthRangeFromParam(periodResolved.monthParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;

  const monthParam = firstDay.slice(0, 7);
  const prevMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, -1) });
  const nextMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, 1) });

  const [
    sprintsRaw,
    dailySpend,
    plannedAllocations,
    budgetChangesRaw,
    performanceTargetHistoryRaw,
    channelSpendRows,
    planningEndDate,
    allClientGoals,
    dadosData,
    dailyPerformanceRowsForEvolution,
    queryDailySpendRows,
    [clientOperationalState],
    performanceReportData,
    metaAdAccountId,
  ] = await Promise.all([
    requireQuery(
      supabase
        .from("sprints")
        .select(
          "id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
        )
        .eq("client_id", clientId)
        .lte("start_date", lastDay)
        .gte("end_date", firstDay)
        .order("start_date"),
      "sprints",
    ),
    requireQuery(
      supabase.from("daily_spend").select("date, spend, channel").eq("client_id", clientId).gte("date", firstDay).lte("date", lastDay),
      "daily_spend",
    ),
    requireQuery(
      supabase.from("sprint_planned_allocations").select("sprint_id, date, planned_amount").eq("client_id", clientId).gte("date", firstDay).lte("date", lastDay),
      "sprint_planned_allocations",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select(
          "id, channel, result_type, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
        )
        .eq("client_id", clientId)
        .eq("month", firstDay)
        .order("changed_at", { ascending: false }),
      "monthly_budget_changes:current-month",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, result_type, month, changed_at, new_amount, target_result_count, target_cost_per_result")
        .eq("client_id", clientId)
        .lte("month", firstDay)
        .order("month", { ascending: false })
        .order("changed_at", { ascending: false }),
      "monthly_budget_changes:target-history",
    ),
    requireQuery(
      supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", clientId),
      "sprint_channel_spend",
    ),
    getClientMonthHorizon(supabase, clientId, firstDay),
    listClientGoals(supabase, clientId),
    loadDadosPageData(supabase, clientId, isAdmin),
    // Etapa "Seletor global de período": evolução/indicadores respeitam o
    // intervalo CONSULTADO (seção 5 do pedido), nunca o mês de referência —
    // os dois só coincidem quando `isMonthAligned`.
    getDailyPerformanceRowsForPeriod(supabase, clientId, { firstDay: queryFirstDay, lastDay: queryLastDay }),
    // `dailySpend` acima fica reservado ao mês de referência (orçamento,
    // intocado) — este é o MESMO dado (`daily_spend`), só com os limites do
    // intervalo consultado, pra nunca faltar dia quando o intervalo
    // atravessa o mês (ex.: "Últimos 30 dias" perto da virada do mês).
    requireQuery(
      supabase.from("daily_spend").select("date, spend, channel").eq("client_id", clientId).gte("date", queryFirstDay).lte("date", queryLastDay),
      "daily_spend:query-range",
    ),
    loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, clientId),
    buildPerformanceReportData(supabase, clientId, { start: queryFirstDay, end: queryLastDay }),
    clientChannels.includes("meta") ? resolveMetaAdAccountId(supabase, clientId) : Promise.resolve(null),
  ]);

  // Preview de criativos / congelamento de sprints encerrados: mecanismos
  // automáticos de consistência de dados, nunca uma ação administrativa
  // disparada por clique — rodam do mesmo jeito pra qualquer visualização
  // (agência ou compartilhada), exatamente como sempre rodaram.
  void scheduleCreativePreviewRefreshIfStale(supabase, clientId, metaAdAccountId);

  const planningHorizon = resolvePlanningHorizon({ firstDay, lastDay }, planningEndDate);

  const channelSpendOverrideRows: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));
  const dailySpendChannelRows = (dailySpend ?? []).map((d) => ({ date: d.date, channel: d.channel as TrafficChannel, spend: d.spend }));
  const sprints = sprintsRaw.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(
      sprint.manual_actual_spend,
      channelSpendOverrideRows.filter((r) => r.sprintId === sprint.id),
    ),
  }));
  assertSingleCurrentSprint(sprints, today);

  const performanceRecordRows = await resolvePerformanceRowsForSprints(
    supabase,
    sprints.map((s) => ({ id: s.id, client_id: clientId, start_date: s.start_date, end_date: s.end_date })),
  );
  const performanceRecords = performanceRecordRows.map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  const effectiveClientGoals: ClientGoal[] =
    allClientGoals.length > 0
      ? allClientGoals
      : client.performance_goal
        ? [{ id: "", clientId, resultType: client.performance_goal, channels: [], isPrimary: true, resultSource: "automatic" }]
        : [];
  const primaryResultType = resolvePrimaryGoal(effectiveClientGoals)?.resultType ?? null;

  const dashboardGoalPerformance = hasConfiguredDashboardMetrics
    ? await loadDashboardGoalPerformanceData(supabase, clientId, effectiveDashboardMetrics, { firstDay, lastDay }, effectiveClientGoals)
    : { hasMetaAccount: false, goalsWithActiveMapping: new Set<PerformanceGoal>(), goals: new Map() };

  const performanceTargetHistoryRows: ClientPlanChangeRow[] = (performanceTargetHistoryRaw ?? []).map((row) => ({
    channel: row.channel as TrafficChannel,
    month: row.month,
    changedAt: row.changed_at,
    investment: row.new_amount,
    targetResultCount: row.target_result_count,
    resultType: (row.result_type ?? primaryResultType) as PerformanceGoal | null,
  }));
  const clientGoalsPlan = resolveClientMonthlyGoals({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: performanceTargetHistoryRows,
    selectedMonth: firstDay,
    clientGoals: effectiveClientGoals,
  });
  const EMPTY_GOAL_PLAN: { byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>; consolidated: ChannelMetrics; inheritedFromMonth: string | null } = {
    byChannel: {},
    consolidated: { investment: null, resultCount: null, cpa: null },
    inheritedFromMonth: null,
  };
  const primaryGoalPlan = clientGoalsPlan.goals.find((g) => g.resultType === primaryResultType) ?? EMPTY_GOAL_PLAN;

  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount }));
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);

  const primaryMonthPlanned = primaryGoalPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const primaryBudgetChanges = (budgetChangesRaw ?? []).filter((c) => (c.result_type ?? primaryResultType) === primaryResultType);

  await ensureClosedSprintSnapshots(supabase, {
    clientId,
    today,
    monthRange: planningHorizon,
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: primaryBudgetChanges.map((c) => ({ channel: c.channel as TrafficChannel, newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: primaryMonthPlanned,
  });

  const dashboardChannels = clientChannels.map((channel) => {
    const channelGoal = resolveChannelGoal(effectiveClientGoals, channel);
    const goalPlan = channelGoal ? clientGoalsPlan.goals.find((g) => g.resultType === channelGoal.resultType) ?? EMPTY_GOAL_PLAN : EMPTY_GOAL_PLAN;
    const actualSpend = sumChannelEffectiveSpend(
      sprints.map((s) => ({ sprintId: s.id, start_date: s.start_date, end_date: s.end_date })),
      channel,
      dailySpendChannelRows,
      channelSpendOverrideRows,
    );
    const planned = goalPlan.byChannel[channel]?.investment ?? null;
    const targetCostPerResult = channelGoal
      ? resolveTargetCostPerResult({
          channel,
          plan: goalPlan,
          legacyFallback: channelGoal.resultType === primaryResultType ? client.target_cost_per_result : null,
        })
      : null;
    const targetResultCount = goalPlan.byChannel[channel]?.resultCount ?? null;
    const performanceSummary = channelGoal
      ? computePerformanceSummary({
          scope: channel,
          records: performanceRecords,
          resultType: channelGoal.resultType,
          consolidatedActualSpend: monthActual,
          targetCostPerResult,
          channelActualSpend: { [channel]: actualSpend },
        })
      : null;

    return { channel, goal: channelGoal, actualSpend, planned, performanceSummary, targetCostPerResult, targetResultCount };
  });

  const totalPlannedAcrossChannels =
    consolidateAdditive(clientChannels, (channel) => dashboardChannels.find((c) => c.channel === channel)?.planned ?? null) ??
    sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });

  /**
   * Etapa "Seletor global de período" (seção 5 do pedido: "Investimento...
   * deve respeitar exatamente o intervalo selecionado"; seção 6: "não
   * apresentar uma meta proporcional como se fosse a meta oficial"):
   * card de Orçamento mostra o GASTO REAL do intervalo consultado (nunca
   * o do mês inteiro) quando o período não é "o mês inteiro" — sem
   * ritmo/barra fabricados contra uma meta mensal que não corresponde a
   * essa janela mais curta. `monthPlanned = 0` reaproveita o branch JÁ
   * EXISTENTE de `CockpitBudgetCard` ("Sem planejamento configurado"),
   * `monthStatus = "sem_meta"` reaproveita o badge neutro já existente
   * ("SEM PLANEJAMENTO") — nenhum componente/veredito novo, só os NÚMEROS
   * certos pra este caso.
   */
  const queryRangeDailySpendRows = (queryDailySpendRows ?? []).map((row) => ({ date: row.date, channel: row.channel as TrafficChannel, spend: row.spend }));
  const queryRangeDailyPerformanceRows = dailyPerformanceRowsForEvolution.map((row) => ({
    date: row.date,
    channel: row.channel as TrafficChannel,
    resultType: row.resultType as PerformanceGoal,
    resultCount: row.resultCount,
  }));
  const queryRangeActualSpend = sumDailySpendForRange(queryRangeDailySpendRows, clientChannels, queryFirstDay, queryLastDay);
  const monthPlanned = isMonthAligned ? totalPlannedAcrossChannels : 0;
  const monthActualForHeadline = isMonthAligned ? monthActual : queryRangeActualSpend;
  const monthExpectedToDate = isMonthAligned ? computeMonthlyExpectedToDateByCalendar(monthPlanned, planningHorizon, todayStr).expectedToDate : 0;
  const monthStatus = isMonthAligned ? classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned) : "sem_meta";

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);
  // Correção da divergência Dashboard × link compartilhado: a edição
  // inline SEMPRE depende de `isAdmin`, nunca mais diretamente — e
  // `isAdmin` já é `false` para `viewer.kind === "shared"` (linha ~190
  // acima). É este boolean, nunca calculado para o visitante público, que
  // garante (na ORIGEM, não só na view) que nenhum `goalEdit`/`canEdit`
  // chega ao payload de um link compartilhado.
  // Etapa "Seletor global de período" (seção 6 do pedido, decisão explícita
  // do usuário): editar "a meta do mês" só faz sentido olhando o mês
  // inteiro — fora disso (Hoje/Ontem/Últimos 7/30 dias/Personalizado) a
  // edição fica indisponível, nunca ambígua sobre qual período está sendo
  // editado.
  const canEditBudgetInline = isAdmin && !isClosedMonth && Boolean(effectiveDate) && isMonthAligned;

  const hasBudgetPace = monthPlanned > 0 && !isClosedMonth && isCurrentMonth && Boolean(effectiveDate);
  const budgetNeededDailyRate = hasBudgetPace
    ? computeMonthlyBudgetPlan({
        monthlyBudget: monthPlanned,
        monthActual,
        monthRange: planningHorizon,
        effectiveDate: effectiveDate as string,
        sprints: sprints.map((s) => ({ sprintId: s.id, startDate: s.start_date, endDate: s.end_date })),
      }).recommendedDaily
    : null;

  const resultGroups = groupChannelsByResultType(
    dashboardChannels.map((c) => ({ channel: c.channel, resultType: c.goal?.resultType ?? null })),
    primaryResultType,
  );
  const eligibleDaysCount = getRemainingEligibleDaysIncludingToday(planningHorizon, effectiveDate);

  const monthLabel = formatMonthLabel(firstDay);
  const cockpitReturnTo = buildContextHref({});

  const resultCards: { result: CockpitResultCardView; status: SpendStatus | null; cost: CockpitCostCardView }[] = resultGroups.map((group) => {
    const channelsLabel = resultGroups.length > 1 ? group.channels.map((c) => TRAFFIC_CHANNELS[c].label).join(" + ") : null;

    /**
     * Etapa "Seletor global de período" (seções 5-6 do pedido, decisão
     * explícita do usuário): fora de "o mês inteiro" (Hoje/Ontem/Últimos
     * 7/30 dias/Personalizado), os cards de Resultado/Custo mostram o
     * NÚMERO REAL do intervalo consultado — somado direto das tabelas
     * diárias (`daily_performance`/`daily_spend`, confirmado na auditoria:
     * granularidade diária, cobertura completa), NUNCA via o mecanismo de
     * sprints (que só existe em granularidade mensal/semanal, não serve
     * pra "Hoje" ou "Últimos 7 dias"). Sem meta/ritmo/edição — comparar
     * com a meta MENSAL seria enganoso pra uma janela mais curta (mesmo
     * raciocínio do card de Orçamento, acima).
     *
     * Filtro global de texto (campanha) ativo ao mesmo tempo: as tabelas
     * diárias não têm dimensão de campanha (só `daily_performance`/
     * `daily_spend`, por cliente+canal+dia) — recalcular o filtrado exigiria
     * a tabela de campanhas (Meta-only, não cobre Google), então este caso
     * combinado fica `unavailableReason`, nunca um número fabricado.
     */
    if (!isMonthAligned) {
      if (cockpitFilter.isActive) {
        const unavailableReason = "Filtro de campanha indisponível em períodos personalizados — volte para 'Este mês' ou limpe o filtro.";
        return {
          result: {
            resultType: group.resultType,
            channelsLabel,
            resultCount: 0,
            targetResultCount: null,
            expectedResultsToDate: null,
            neededDailyRate: null,
            edit: null,
            unavailableReason,
          },
          status: null,
          cost: {
            resultType: group.resultType,
            costPerResult: null,
            targetCostPerResult: null,
            deviationPct: null,
            tone: "normal",
            edit: null,
            unavailableReason,
          },
        };
      }
      const rangeResultCount = sumDailyResultCountForRange(queryRangeDailyPerformanceRows, group.resultType, group.channels, queryFirstDay, queryLastDay);
      const rangeSpend = sumDailySpendForRange(queryRangeDailySpendRows, group.channels, queryFirstDay, queryLastDay);
      const rangeCostPerResult = rangeResultCount > 0 ? rangeSpend / rangeResultCount : null;
      return {
        result: {
          resultType: group.resultType,
          channelsLabel,
          resultCount: rangeResultCount,
          targetResultCount: null,
          expectedResultsToDate: null,
          neededDailyRate: null,
          edit: null,
        },
        status: null,
        cost: {
          resultType: group.resultType,
          costPerResult: rangeCostPerResult,
          targetCostPerResult: null,
          deviationPct: null,
          tone: "normal",
          edit: null,
        },
      };
    }

    const groupActualSpend = group.channels.reduce((sum, channel) => sum + (dashboardChannels.find((c) => c.channel === channel)?.actualSpend ?? 0), 0);
    const goalPlan = clientGoalsPlan.goals.find((g) => g.resultType === group.resultType) ?? EMPTY_GOAL_PLAN;
    const goalEdit: CockpitGoalEditAffordance | null = canEditBudgetInline
      ? {
          kind: group.isPrimary ? "primary" : "secondary",
          clientId: client.id,
          monthParam,
          monthLabel,
          monthRange: { firstDay, lastDay },
          currentPlanningEndDate: planningEndDate,
          channels: group.isPrimary ? AVAILABLE_TRAFFIC_CHANNELS : group.channels,
          byChannel: goalPlan.byChannel,
          performanceGoal: group.resultType,
          returnTo: cockpitReturnTo,
        }
      : null;
    const isGoalConfiguredThisMonth = goalPlan.inheritedFromMonth == null;
    const targetCostPerResult = isGoalConfiguredThisMonth
      ? resolveTargetCostPerResult({
          channel: "consolidated",
          plan: goalPlan,
          legacyFallback: group.isPrimary ? client.target_cost_per_result : null,
        })
      : null;
    const performanceSummary = computePerformanceSummary({
      scope: "consolidated",
      records: performanceRecords,
      resultType: group.resultType,
      consolidatedActualSpend: groupActualSpend,
      targetCostPerResult,
    });
    const targetResultCount = isGoalConfiguredThisMonth ? goalPlan.consolidated.resultCount : null;
    const expectedResultsToDate =
      targetResultCount !== null ? computeMonthlyExpectedToDateByCalendar(targetResultCount, planningHorizon, todayStr).expectedToDate : null;
    const neededDailyRate = computeNeededDailyRate(targetResultCount, performanceSummary.resultCount, eligibleDaysCount);
    const status =
      targetResultCount !== null && targetResultCount > 0 && expectedResultsToDate !== null
        ? classifySpendStatus(performanceSummary.resultCount, expectedResultsToDate, targetResultCount)
        : null;
    const costDiagnostic = evaluateCpaDiagnostic(performanceSummary.costPerResult, targetCostPerResult, performanceSummary.resultCount);

    const filteredOverride = cockpitFilter.isActive
      ? resolveFilteredExecutiveCardOverride(group.resultType, group.channels, performanceReportData.campaignDailyRows, cockpitFilter)
      : null;

    return {
      result: {
        resultType: group.resultType,
        channelsLabel,
        resultCount: filteredOverride ? filteredOverride.resultCount ?? 0 : performanceSummary.resultCount,
        targetResultCount: filteredOverride ? null : targetResultCount,
        expectedResultsToDate: filteredOverride ? null : expectedResultsToDate,
        neededDailyRate: filteredOverride ? null : neededDailyRate,
        edit: filteredOverride ? null : goalEdit,
        filteredNotice: filteredOverride?.filteredNotice,
        unavailableReason: filteredOverride?.unavailableReason,
      },
      status: filteredOverride ? null : status,
      cost: {
        resultType: group.resultType,
        costPerResult: filteredOverride ? filteredOverride.costPerResult : performanceSummary.costPerResult,
        targetCostPerResult: filteredOverride ? null : targetCostPerResult,
        deviationPct: filteredOverride ? null : costDiagnostic?.deviationPct ?? null,
        tone: filteredOverride ? "normal" : costDiagnostic?.tone ?? "normal",
        edit: filteredOverride ? null : group.isPrimary ? goalEdit : null,
        filteredNotice: filteredOverride?.filteredNotice,
        unavailableReason: filteredOverride?.unavailableReason,
      },
    };
  });

  const hasDailyIntegration = Boolean(dadosData?.sources.some((s) => s.enabled));
  const evolutionWindowDates = listDatesInclusive(queryFirstDay, queryLastDay);
  const evolutionDailyPerformanceRows = queryRangeDailyPerformanceRows;
  const evolutionDailySpendRows = queryRangeDailySpendRows;

  const goalEvolutionSeries: EvolutionSeriesOption[] = hasDailyIntegration
    ? buildGoalEvolutionSeries(
        resultGroups.map((group) => ({
          resultType: group.resultType,
          resultLabel: PERFORMANCE_GOALS[group.resultType].resultMetricLabel,
          costLabel: PERFORMANCE_GOALS[group.resultType].costMetricShortLabel,
          channelsLabel: resultGroups.length > 1 ? group.channels.map((c) => TRAFFIC_CHANNELS[c].label).join(" + ") : null,
          points: buildCockpitDailyEvolutionPoints({
            windowDates: evolutionWindowDates,
            todayStr,
            resultType: group.resultType,
            channels: group.channels,
            performanceRows: evolutionDailyPerformanceRows,
            spendRows: evolutionDailySpendRows,
          }),
        })),
      )
    : [];

  const evolutionFreshness = {
    latestDataLabel: dadosData?.health.latestImportedDate ? formatShortDate(dadosData.health.latestImportedDate) : null,
    latestSyncLabel: dadosData?.health.latestSuccessAtLabel ?? null,
  };

  const evolutionEmptyMessage = cockpitFilter.isActive
    ? !clientChannels.includes("meta")
      ? "Métricas diárias não podem ser filtradas por campanha sem a integração Meta Ads (única fonte com esse nível de detalhe)."
      : "Nenhuma campanha corresponde a este filtro no período."
    : resultGroups.length === 0
      ? "Este cliente ainda não tem um objetivo de performance configurado."
      : !hasDailyIntegration
        ? "Sem dados diários disponíveis para este cliente."
        : "Nenhuma métrica de evolução disponível para este cliente.";

  const insights = clientOperationalState
    ? buildCockpitInsights({
        diagnostics: clientOperationalState.diagnostics,
        costLabel: primaryResultType ? PERFORMANCE_GOALS[primaryResultType].costMetricShortLabel : "Custo por resultado",
        dataAttentions: dadosData?.attentions ?? [],
      })
    : [];

  // Saldo da conta Meta Ads: decisão explícita do usuário — informação de
  // billing da agência, nunca calculada (nem a chamada à Graph API feita)
  // pra um visitante compartilhado.
  const [adReach, adBalance] = clientChannels.includes("meta")
    ? await Promise.all([
        fetchAccountPeriodReachSnapshot(metaAdAccountId, { start: queryFirstDay, end: queryLastDay }),
        viewer.kind === "agency" ? fetchAccountBalanceSnapshot(metaAdAccountId) : Promise.resolve(null),
      ])
    : ([{ status: "unavailable", reason: "not_configured" } as const, null] as const);

  const filteredCampaignDailyRows = filterCampaignDailyRows(performanceReportData.campaignDailyRows, cockpitFilter);
  const filteredExplorationCampaigns = filterCampaignSummaries(performanceReportData.campaigns, cockpitFilter);
  const filteredAdSetDailyRows = filterAdSetDailyRows(performanceReportData.adSetDailyRows, cockpitFilter);
  const filteredCreativeDailyRows = filterCreativeDailyRows(performanceReportData.creativeDailyRows, cockpitFilter);

  const adPerformanceData = buildCockpitAdPerformanceData({
    client: { id: client.id, name: client.name },
    metaAdAccountId,
    period: { start: queryFirstDay, end: queryLastDay },
    campaignDailyRows: filteredCampaignDailyRows,
    explorationCampaigns: filteredExplorationCampaigns,
    explorationAdSetRows: filteredAdSetDailyRows,
    explorationCreativeRows: filteredCreativeDailyRows,
    resultType: performanceReportData.performanceGoal,
    reach: adReach,
    lastSyncAt: dadosData?.health.latestSuccessAt ?? null,
  });
  const adMetricCards = buildMetricCardViewModels(adPerformanceData, cockpitFilter.isActive);
  const adExplorationCampaignRows = adPerformanceData.explorationCampaigns.map(campaignSummaryToRow);

  const hasMetaSyncError = (dadosData?.attentions ?? []).some((a) => a.severity === "error" && a.message.includes(TRAFFIC_CHANNELS.meta.label));
  const dashboardMetricViews = hasConfiguredDashboardMetrics
    ? resolveDashboardMetricViews({
        keys: effectiveDashboardMetrics,
        hasMetaSyncError,
        hasMetaAccount: dashboardGoalPerformance.hasMetaAccount,
        goalsWithActiveMapping: dashboardGoalPerformance.goalsWithActiveMapping,
        goals: dashboardGoalPerformance.goals,
        delivery: clientChannels.includes("meta")
          ? {
              spend: adPerformanceData.comparison.current.totals.spend,
              impressions: adPerformanceData.comparison.current.totals.impressions,
              clicks: adPerformanceData.comparison.current.totals.clicks,
              ctr: adPerformanceData.comparison.current.derived.ctr,
              cpc: adPerformanceData.comparison.current.derived.cpc,
              cpm: adPerformanceData.comparison.current.derived.cpm,
            }
          : null,
        reach: adReach,
        isGlobalFilterActive: cockpitFilter.isActive,
      })
    : new Map();

  const mergedEvolutionSeries: EvolutionSeriesOption[] = cockpitFilter.isActive
    ? clientChannels.includes("meta")
      ? adPerformanceData.evolution
      : []
    : [
        ...goalEvolutionSeries,
        ...(clientChannels.includes("meta")
          ? adPerformanceData.evolution.filter((s) => s.id !== "investment" && s.id !== "results" && s.id !== "costPerResult")
          : []),
      ];

  const defaultEvolutionLeftId = resolveDefaultEvolutionSeriesId(
    mergedEvolutionSeries,
    cockpitFilter.isActive ? ["results"] : primaryResultType ? [`goal:${primaryResultType}:result`, "results"] : ["results"],
  );
  const defaultEvolutionRightId = resolveDefaultEvolutionSeriesId(
    mergedEvolutionSeries,
    cockpitFilter.isActive ? ["investment"] : primaryResultType ? [`goal:${primaryResultType}:investment`, "investment"] : ["investment"],
  );

  // "Configurar objetivo" (canal sem objetivo definido) aponta pra
  // `/clients/[id]/edit`, autenticado — `null` no modo compartilhado
  // (mesmo critério de `metasHref`/`dashboardMetricsConfigHref`).
  const channelBreakdownRows: ChannelBreakdownRowView[] =
    dashboardChannels.length > 1
      ? dashboardChannels.map((c) => ({
          channel: c.channel,
          goal: c.goal,
          actualSpend: c.actualSpend,
          performanceSummary: c.performanceSummary,
          targetCostPerResult: c.targetCostPerResult,
          configureObjectiveHref: viewer.kind === "agency" ? `/clients/${client.id}/edit` : null,
          dataIssue: findChannelDataIssue(dadosData?.attentions ?? [], TRAFFIC_CHANNELS[c.channel].label),
        }))
      : [];

  const contractBannerText = contractStatusBannerText(client.status);
  const banners: CockpitBanner[] = [
    contractBannerText && { tone: "amber" as const, text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.` },
    ...extraBanners,
  ].filter((banner): banner is CockpitBanner => Boolean(banner));

  const externalLinks = [
    client.dashboard_url && { label: "Dashboard", href: client.dashboard_url },
    client.balance_url && { label: "Saldo", href: client.balance_url },
    client.monthly_closing_sheet_url && { label: "Fechamento", href: client.monthly_closing_sheet_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  const metasHref = viewer.kind === "agency" ? buildMetasHref(client.id, { month: monthParam }, {}) : null;
  const headerChannelsLabel = clientChannels.map((c) => TRAFFIC_CHANNELS[c].label).join(" + ");
  const showMetaSection = clientChannels.includes("meta");

  return {
    clientId: client.id,
    clientName: client.name,
    clientAvatarUrl: client.avatar_url,
    clientStatus: client.status,
    accountInfoClientId: viewer.kind === "agency" ? client.id : null,
    basePath,
    headerChannelsLabel,
    channelScopeOptions,
    channelScope,
    metasHref,
    prevMonthHref,
    nextMonthHref,
    monthParam,
    periodResolved,
    filterText: cockpitFilter.text,
    filterMode: cockpitFilter.mode,
    isFilterActive: cockpitFilter.isActive,
    banners,
    budget: {
      headline: { monthActual: monthActualForHeadline, monthPlanned, monthExpectedToDate, monthStatus, neededDailyRate: budgetNeededDailyRate },
      channels: dashboardChannels.map((c) => ({ channel: c.channel, planned: c.planned })),
      canEdit: canEditBudgetInline,
    },
    resultCards,
    insights,
    channelBreakdownRows,
    showMetaSection,
    adBalance,
    adMetricCards,
    dataFreshness: { lastSuccessAt: dadosData?.health.latestSuccessAt ?? null },
    hasConfiguredDashboardMetrics,
    dashboardMetricViews,
    dashboardMetricsConfigHref: viewer.kind === "agency" ? `/clients/${client.id}/edit` : null,
    evolution: {
      series: mergedEvolutionSeries,
      defaultLeftId: defaultEvolutionLeftId,
      defaultRightId: defaultEvolutionRightId,
      freshness: evolutionFreshness,
      emptyMessage: evolutionEmptyMessage,
    },
    adExploration: showMetaSection
      ? {
          campaigns: adExplorationCampaignRows,
          adSetDailyRows: adPerformanceData.explorationAdSetRows,
          creativeDailyRows: adPerformanceData.explorationCreativeRows,
        }
      : null,
    externalLinks,
  };
}

/** Objetivo em exibição na Performance (`?goal=`) — núcleo puro, reaproveitado
 * sem mudança (ver histórico original em `[id]/page.tsx`). */
export function resolveSelectedGoal(
  goalParam: string | undefined,
  availableGoalTypes: PerformanceGoal[],
  primaryResultType: PerformanceGoal | null,
): PerformanceGoal | null {
  return goalParam && availableGoalTypes.includes(goalParam as PerformanceGoal) ? (goalParam as PerformanceGoal) : primaryResultType;
}

/** Anota um canal com a atenção de Dados que o afeta — núcleo puro,
 * reaproveitado sem mudança (ver histórico original em `[id]/page.tsx`). */
export function findChannelDataIssue(attentions: DataAttention[], channelLabel: string): DashboardChannelDataIssue | null {
  const match = attentions.find((a) => a.message.includes(channelLabel));
  if (!match) return null;
  return { severity: match.severity, label: match.severity === "error" ? "Erro de sincronização" : "Sem dados recebidos" };
}

/**
 * Etapa "Seletor global de período": soma ADITIVA pura de `daily_spend`
 * pro intervalo CONSULTADO (nunca o mês de referência) — usada só quando
 * `!isMonthAligned`, onde os cards principais precisam do gasto/resultado
 * REAL do período exato (seção 5 do pedido), sem passar pelo mecanismo de
 * sprints (que só existe em granularidade mensal/semanal). Soma direta de
 * linhas diárias já existentes — nenhum dado novo, nenhuma aproximação.
 */
export function sumDailySpendForRange(
  rows: { date: string; channel: TrafficChannel; spend: number }[],
  channels: TrafficChannel[],
  firstDay: string,
  lastDay: string,
): number {
  return rows.reduce((sum, row) => (channels.includes(row.channel) && row.date >= firstDay && row.date <= lastDay ? sum + row.spend : sum), 0);
}

/** Mesma lógica de `sumDailySpendForRange`, pro resultado (`daily_performance`)
 * de um objetivo específico — núcleo puro, mesma convenção. */
export function sumDailyResultCountForRange(
  rows: { date: string; channel: TrafficChannel; resultType: PerformanceGoal; resultCount: number }[],
  resultType: PerformanceGoal,
  channels: TrafficChannel[],
  firstDay: string,
  lastDay: string,
): number {
  return rows.reduce(
    (sum, row) =>
      row.resultType === resultType && channels.includes(row.channel) && row.date >= firstDay && row.date <= lastDay ? sum + row.resultCount : sum,
    0,
  );
}
