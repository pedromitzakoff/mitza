import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  assertSingleCurrentSprint,
  currentMonthRange,
  findSprintForDate,
  getSprintTemporalStatus,
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { classifySpendStatus } from "@/lib/spend-status";
import { resolveBudgetEffectiveDate, computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { resolveClientMonthlyGoals, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel, formatRelativeDateTime, formatDueDate } from "@/lib/format";
import { contractStatusBannerText } from "@/lib/client-fields";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { resolveOperationPriorityGroup } from "@/lib/operation-triage";
import { PRIORITY_GROUP_TONE } from "@/app/operation/operation-client-card";
import { emphasizeDeviationText } from "@/components/workspace/status-dot";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { MonthInvestmentPaceNote, MonthInvestmentSummary } from "../month-investment-summary";
import { MonthlyGoalProgress } from "../monthly-goal-progress";
import { PerformanceDiagnosticCard } from "../performance-diagnostic";
import { evaluateInvestmentDiagnostic, evaluateCpaDiagnostic, metricToneSeverityRank, type MetricTone } from "@/lib/metric-diagnostics";
import { listClientGoals, resolvePrimaryGoal, resolveChannelGoal, type ClientGoal } from "@/lib/client-goals";
import { computePerformanceSummary } from "@/lib/performance";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, resolveClientMediaChannels, type TrafficChannel } from "@/lib/traffic-channels";
import { MonthSelect } from "../month-select";
import { DashboardBudget } from "../dashboard-budget";
import { DashboardChannelSection } from "../dashboard-channel-section";
import { countOpenDemandas } from "@/lib/pendencias";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { TASK_PRIORITY_DOT_CLASS } from "../task-labels";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
import { WorkspaceContainer } from "../workspace-container";
import { IconButton } from "@/components/workspace/button";
import { buildMetasHref } from "./metas/page";

/**
 * Objetivo em exibição na Performance (`?goal=`) — núcleo puro extraído de
 * dentro do componente (Etapa "Primeira Rodada Visual — Contexto +
 * Performance", seção 6/18 do pedido), mesmo padrão de
 * `resolveOperationGoal` (`app/operation/page.tsx`): valor inválido/ausente
 * NUNCA quebra a página, sempre cai num default seguro. Aqui o default é o
 * objetivo PRINCIPAL do cliente (nunca `"todos"` como em Operação — a
 * Performance sempre mostra EXATAMENTE um objetivo por vez), e "válido"
 * significa literalmente "está entre os objetivos que ESTE cliente tem
 * configurado" — nunca um objetivo de outro cliente sobrevivendo a uma
 * troca (seção 6: "compatível com troca de cliente").
 */
export function resolveSelectedGoal(
  goalParam: string | undefined,
  availableGoalTypes: PerformanceGoal[],
  primaryResultType: PerformanceGoal | null,
): PerformanceGoal | null {
  return goalParam && availableGoalTypes.includes(goalParam as PerformanceGoal) ? (goalParam as PerformanceGoal) : primaryResultType;
}

/**
 * Monta a URL de um dos 3 dropdowns de contexto (Mês/Meta-Planejamento/
 * Canal) — núcleo puro extraído de dentro do componente, mesmo motivo de
 * `resolveSelectedGoal` acima (testável sem Next/Supabase). Preserva
 * SEMPRE os 3 parâmetros juntos — nunca um dropdown reseta o estado dos
 * outros dois (seção 6 do pedido). `undefined` num campo de `overrides`
 * mantém o valor atual (`current`); `null` limpa o param explicitamente
 * (usado pelo objetivo PRINCIPAL, que navega pra uma URL SEM `goal` —
 * ausência é o estado "default", nunca um valor reservado).
 */
export function buildClientContextHref(
  clientId: string,
  current: { month?: string; metricsChannel?: string; goal?: string },
  overrides: { month?: string; metricsChannel?: string | null; goal?: string | null },
): string {
  const params = new URLSearchParams();
  const monthValue = overrides.month ?? current.month;
  if (monthValue) params.set("month", monthValue);
  const channelValue = overrides.metricsChannel !== undefined ? overrides.metricsChannel : current.metricsChannel;
  if (channelValue) params.set("metricsChannel", channelValue);
  const goalValue = overrides.goal !== undefined ? overrides.goal : current.goal;
  if (goalValue) params.set("goal", goalValue);
  const qs = params.toString();
  return `/clients/${clientId}${qs ? `?${qs}` : ""}`;
}

/**
 * Resolve pra ONDE a CTA do diagnóstico único do Dashboard deve apontar —
 * "Ver Metas →" quando o eixo fora do esperado é Investimento (ritmo de
 * planejamento, módulo Metas) ou "Ver Performance →" quando é Custo por
 * resultado (eficiência, módulo Performance). Etapa "MEGA FACELIFT — Fase
 * 4: Dashboard" (seção 6 do pedido: "nunca inventar causalidade") — núcleo
 * puro que REAPLICA os mesmos dois avaliadores e o mesmo desempate que
 * `PerformanceDiagnosticCard` já usa internamente (`metric-diagnostics.ts`,
 * Investimento primeiro em caso de empate de severidade), nunca um motor
 * novo. `null` quando não há nenhum eixo com base real de comparação, ou
 * quando o eixo escolhido está dentro do esperado (`tone === "normal"` —
 * sem desvio, não há "o que mais merece atenção" pra apontar).
 */
export function resolveDashboardDiagnosticCtaTarget(input: {
  actualSpend: number;
  expectedToDate: number | null;
  costPerResult: number | null;
  targetCostPerResult: number | null;
  resultCount: number;
  hasPerformanceGoal: boolean;
}): "metas" | "performance" | null {
  const investmentDiag = evaluateInvestmentDiagnostic(input.actualSpend, input.expectedToDate);
  const costDiag = input.hasPerformanceGoal ? evaluateCpaDiagnostic(input.costPerResult, input.targetCostPerResult, input.resultCount) : null;

  const candidates: { target: "metas" | "performance"; tone: MetricTone }[] = [];
  if (investmentDiag.expected !== null) candidates.push({ target: "metas", tone: investmentDiag.tone });
  if (costDiag && costDiag.expected !== null) candidates.push({ target: "performance", tone: costDiag.tone });
  if (candidates.length === 0) return null;

  const chosen = candidates.reduce((worst, candidate) => (metricToneSeverityRank(candidate.tone) < metricToneSeverityRank(worst.tone) ? candidate : worst));
  return chosen.tone === "normal" ? null : chosen.target;
}

/**
 * `/clients/[id]` — DASHBOARD do cliente (Etapa "MEGA FACELIFT — Fase 4").
 * A pergunta que esta página responde, e SÓ esta: "como está o growth
 * deste cliente agora?" — um cockpit executivo, não mais um painel que
 * tenta ser relatório/planejamento/operação/demandas/histórico/config ao
 * mesmo tempo (esses agora são módulos próprios, ver abaixo).
 *
 * Fases 1-3 ("MEGA FACELIFT") já tinham extraído Metas (`/metas`) e
 * recontextualizado Performance (`/relatorio`). Esta fase 4 termina a
 * extração do que sobrou aqui dentro, deixando SÓ o que é genuinamente
 * executivo — "o que saiu e para onde foi" (auditoria completa no
 * relatório de entrega desta etapa, não repetida aqui pra não duplicar):
 *
 * 1. PLANEJAMENTO DETALHADO (`ChannelPlanEditor`) — saiu por completo da
 *    experiência principal. Vira só um CTA "Editar planejamento →" pra
 *    `/clients/[id]/metas` (mesmo componente/dado, nunca deletado — só
 *    parou de competir pelo espaço principal do Dashboard).
 * 2. ANÁLISE PROFUNDA (campanhas/públicos/criativos/posicionamentos,
 *    `SecondaryGoalsPerformance`) — já vivia em `/relatorio`
 *    (Performance); o Dashboard mantém só uma síntese executiva
 *    (KPIs + ritmo + 1 diagnóstico + canal), nunca a investigação
 *    completa.
 * 3. HISTÓRICO DE ORÇAMENTO (`MonthlyBudgetHistoryDrawer`,
 *    `?historicoOrcamento=1`) — saiu; é detalhe de planejamento, não
 *    leitura executiva (mesmo raciocínio do item 1 — fica em Metas).
 *
 * `AccountFollowUpPanel` (o wrapper anterior que empilhava KPIs + ritmo +
 * diagnóstico + canal como um bloco só) foi substituído por uma composição
 * NOVA, direta nesta página: os mesmos componentes que ele orquestrava
 * (`MonthlyKpiSummary`/`MonthlyGoalProgress`/`MonthInvestmentSummary`/
 * `PerformanceDiagnosticCard`/`ResultsByChannel`) agora são renderizados em
 * cards próprios dentro de um grid — "reutilizar não significa empilhar
 * igual" (seção 19 do pedido). `account-follow-up-panel.tsx` continua no
 * disco, só sem nenhum consumidor nesta rodada (G — redundante,
 * documentado, não deletado).
 *
 * Operação e Demandas continuam como sínteses curtas com CTA (nunca a
 * lista/sprint completos — isso é `/operation`/`/clients/[id]/demandas`).
 * Nenhum cálculo de investimento/performance mudou nesta fase — só a
 * composição visual e o que deixou de aparecer aqui.
 */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    synced?: string;
    saved?: string;
    month?: string;
  }>;
}) {
  const { id } = await params;
  const { error, synced, saved, month: monthQueryParam } = await searchParams;

  function buildContextHref(overrides: { month?: string }): string {
    return buildClientContextHref(id, { month: monthQueryParam }, overrides);
  }

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(name), performance_goal, target_cost_per_result, avatar_url, media_channels, dashboard_url, balance_url, monthly_closing_sheet_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[ClientPage] falha ao buscar cliente ${id}:`, clientQueryError);
  if (!client) notFound();

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seção 12
  // do pedido): a MESMA fonte de sempre pra "quais canais este cliente
  // realmente usa" (`clients.media_channels`, lib/traffic-channels.ts) —
  // nunca uma segunda checagem de presença de dado. Ordenado por
  // `AVAILABLE_TRAFFIC_CHANNELS` (Meta antes de Google, mesma convenção já
  // usada pelo seletor de canal aposentado nesta etapa) — nunca a ordem
  // crua de `media_channels` no banco.
  const clientChannels = AVAILABLE_TRAFFIC_CHANNELS.filter((c) => resolveClientMediaChannels(client.media_channels).includes(c));

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;

  const [clientOperationalState] = await loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, id);
  const primaryReasonText = clientOperationalState?.evaluation.primaryDimension ? clientOperationalState.evaluation.primaryReason : null;
  const primaryReasonTone = clientOperationalState ? PRIORITY_GROUP_TONE[resolveOperationPriorityGroup(clientOperationalState.evaluation)] : "neutral";

  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const prevMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, -1) });
  const nextMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, 1) });
  // Preserva mês + canal + objetivo juntos (antes só preservava mês) — mesma
  // URL usada pro fechamento de drawers (histórico de orçamento,
  // Planejamento) e por qualquer CTA que precise "voltar pro estado atual".
  const returnTo = buildContextHref({});

  const [sprintsRaw, dailySpend, plannedAllocations, budgetChangesRaw, performanceTargetHistoryRaw, channelSpendRows, planningEndDate, allClientGoals] =
    await Promise.all([
      requireQuery(
        supabase
          .from("sprints")
          .select(
            "id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
          )
          .eq("client_id", id)
          .lte("start_date", lastDay)
          .gte("end_date", firstDay)
          .order("start_date"),
        "sprints",
      ),
      requireQuery(
        supabase.from("daily_spend").select("date, spend, channel").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "daily_spend",
      ),
      requireQuery(
        supabase.from("sprint_planned_allocations").select("sprint_id, date, planned_amount").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "sprint_planned_allocations",
      ),
      // Etapa "Primeira Rodada Visual — Contexto + Performance" (seção 5 do
      // pedido): busca TODOS os objetivos do mês (não mais só o principal
      // via `.or(primaryGoalResultTypeFilter(...))`) — `result_type` agora
      // selecionado explicitamente, a separação por objetivo acontece em
      // JS logo abaixo (`primaryBudgetChanges`/`selectedBudgetChanges`),
      // nunca duas queries por objetivo.
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select(
            "id, channel, result_type, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
          )
          .eq("client_id", id)
          .eq("month", firstDay)
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:current-month",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("channel, result_type, month, changed_at, new_amount, target_result_count, target_cost_per_result")
          .eq("client_id", id)
          .lte("month", firstDay)
          .order("month", { ascending: false })
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:target-history",
      ),
      requireQuery(
        supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
        "sprint_channel_spend",
      ),
      getClientMonthHorizon(supabase, id, firstDay),
      listClientGoals(supabase, id),
    ]);

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
    sprints.map((s) => ({ id: s.id, client_id: id, start_date: s.start_date, end_date: s.end_date })),
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

  // Múltiplos Objetivos (Etapa "Primeira Rodada Visual — Contexto +
  // Performance", seção 5 do pedido): ZERO migration — reaproveita
  // `client_goals`/`monthly_budget_changes.result_type`/
  // `resolveClientMonthlyGoals`, exatamente a estrutura que a auditoria
  // confirmou já existir. Cliente legado sem nenhuma linha em
  // `client_goals` (não deveria acontecer — todo `performance_goal`
  // configurado foi backfilled na Etapa "Múltiplos Objetivos" — mas sem
  // depender dessa garantia aqui) cai num objetivo "virtual" só com o
  // `performance_goal` legado, pra `resolveClientMonthlyGoals` continuar
  // funcionando sem um caso especial espalhado pela página inteira.
  const effectiveClientGoals: ClientGoal[] =
    allClientGoals.length > 0
      ? allClientGoals
      : client.performance_goal
        ? [{ id: "", clientId: id, resultType: client.performance_goal, channels: [], isPrimary: true, resultSource: "automatic" }]
        : [];
  const primaryResultType = resolvePrimaryGoal(effectiveClientGoals)?.resultType ?? null;

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seção 3 do
  // pedido): o seletor "Meta/Planejamento" saiu do Dashboard — Ritmo/
  // Diagnóstico/KPIs consolidados agora são SEMPRE do objetivo PRINCIPAL
  // (nunca mais um objetivo secundário "em exibição" escolhido num
  // dropdown). `resolveSelectedGoal` continua existindo e testada
  // (`metas-data.ts`/`test-client-context-performance.ts` seguem usando) —
  // só deixou de ser chamada AQUI, porque não há mais `?goal=` nesta
  // página pra resolver.
  const performanceGoal = primaryResultType;

  // `performanceTargetHistoryRaw` agora vem SEM filtro de objetivo (busca
  // acima) — linha histórica com `result_type IS NULL` (de antes da Etapa
  // "Múltiplos Objetivos") é sempre do objetivo PRINCIPAL (única leitura
  // possível: só existia um objetivo por cliente nessa época), nunca do
  // secundário — mesma regra que `primaryGoalResultTypeFilter` já
  // codificava, só que resolvida aqui em JS pra poder atender QUALQUER
  // objetivo selecionado na mesma passada, não só o principal.
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
  const EMPTY_GOAL_PLAN: { byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>; consolidated: ChannelMetrics } = {
    byChannel: {},
    consolidated: { investment: null, resultCount: null, cpa: null },
  };
  const primaryGoalPlan = clientGoalsPlan.goals.find((g) => g.resultType === primaryResultType) ?? EMPTY_GOAL_PLAN;

  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount }));
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);

  // Congelamento de sprint (`ensureClosedSprintSnapshots`) SEMPRE usa o
  // orçamento do objetivo PRINCIPAL, nunca o que está em exibição no
  // momento — é uma escrita permanente (`sprints.original_planned_amount`/
  // `final_recommended_amount`), não pode depender de qual objetivo um
  // gestor específico escolheu olhar quando uma sprint fechou. Quando o
  // objetivo selecionado É o principal (default), `primaryMonthPlanned`/
  // `primaryBudgetChanges` são idênticos ao que a página já usava antes
  // desta etapa — zero mudança de comportamento no caminho comum.
  const primaryMonthPlanned = primaryGoalPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const primaryBudgetChanges = (budgetChangesRaw ?? []).filter((c) => (c.result_type ?? primaryResultType) === primaryResultType);

  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: planningHorizon,
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: primaryBudgetChanges.map((c) => ({ channel: c.channel as TrafficChannel, newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: primaryMonthPlanned,
  });

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seção 1 do
  // pedido): Ritmo/KPIs/Diagnóstico do Dashboard são SEMPRE o consolidado
  // do objetivo PRINCIPAL agora — não existe mais um canal/objetivo "em
  // exibição" escolhido num seletor. Mesmo valor que `primaryMonthPlanned`
  // acima (já o consolidado do objetivo principal) — reaproveitado, nunca
  // recalculado uma segunda vez.
  const monthPlanned = primaryMonthPlanned;
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(monthPlanned, planningHorizon, todayStr).expectedToDate;
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);

  // `legacyFallback` (coluna antiga `clients.target_cost_per_result`)
  // sempre se aplica agora — o objetivo em exibição é sempre o PRINCIPAL
  // (nunca mais um objetivo secundário "em exibição" via seletor).
  const consolidatedTargetCostPerResult = resolveTargetCostPerResult({
    channel: "consolidated",
    plan: primaryGoalPlan,
    legacyFallback: client.target_cost_per_result,
  });
  const consolidatedPerformanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult: consolidatedTargetCostPerResult,
      })
    : null;
  const consolidatedTargetResultCount = primaryGoalPlan.consolidated.resultCount;
  const expectedResultsToDate =
    consolidatedTargetResultCount !== null
      ? computeMonthlyExpectedToDateByCalendar(consolidatedTargetResultCount, planningHorizon, todayStr).expectedToDate
      : null;

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seções 9/
  // 10/12/14/15 do pedido): um bloco por canal que o cliente REALMENTE usa
  // (`clientChannels`, já resolvido acima), cada um com o PRÓPRIO objetivo
  // (`resolveChannelGoal`, `lib/client-goals.ts` — nunca o objetivo de
  // outro canal nem um seletor manual) e o PRÓPRIO investimento realizado
  // (`sumChannelEffectiveSpend`, mesma função já usada por esta página
  // antes desta etapa pro canal selecionado — nunca um novo cálculo,
  // chamada uma vez por canal real em vez de uma vez pro canal escolhido
  // num dropdown). Investimento planejado por canal vem de
  // `clientGoalsPlan` (seção 15: nunca estimado/dividido do total).
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

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  const budgetSprints = sprints.map((sprint) => ({ sprintId: sprint.id, startDate: sprint.start_date, endDate: sprint.end_date }));

  // Demandas — resumo (Etapa "Correção de UX do Workspace", seção 10 do
  // pedido): contagem + até 3 itens mais urgentes, nunca a List View
  // inteira. Reaproveita `loadPendenciasRawData` (MESMA fonte/regra de
  // `/clients/[id]/demandas` e da área global — `origin='manual'`), nunca
  // uma terceira implementação da regra nem uma query paralela.
  const { items: demandaItems } = await loadPendenciasRawData(supabase, id);
  const { openCount: demandasOpenCount, overdueCount: demandasOverdueCount } = countOpenDemandas(
    demandaItems.map((item) => ({ origin: "manual" as const, client_id: id, status: item.rawStatus, due_date: item.dueDate })),
    () => true,
    today,
  );
  const demandasPreview = demandaItems
    .filter((item) => item.status !== "feito" && item.status !== "nao_realizado")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);

  // Operação — resumo (seção 9 do pedido): sprint atual, última otimização,
  // saúde/motivo do CPA. MESMOS dados/funções já usados por `/operation` e
  // pela fila global de Operação — nenhum cálculo novo, nunca tasks (isso
  // é Demandas×Operação de novo — ver bug corrigido na Fase 1). Sprint
  // atual só quando a Performance está no mês corrente (`isCurrentMonth`)
  // — fora dele o resumo operacional não reaproveitaria o `sprints` já
  // buscado pro mês em exibição, e buscar um segundo conjunto só pra isso
  // violaria "não duplicar dados" (seção 19).
  const currentSprint = isCurrentMonth ? findSprintForDate(sprints, todayStr) : null;
  const currentSprintLabel = currentSprint
    ? `${formatSprintPeriodLabel(currentSprint.start_date, currentSprint.end_date)} · ${
        getSprintTemporalStatus(currentSprint, today) === "atual" ? "em andamento" : "concluída"
      }`
    : null;

  const [lastReviewRow] = await requireQuery(
    supabase
      .from("account_reviews")
      .select("reviewed_at, outcome, team_member:team_members!account_reviews_team_member_id_fkey(name)")
      .eq("client_id", id)
      .order("reviewed_at", { ascending: false })
      .limit(1),
    "account_reviews:painel-operacao-resumo",
  );
  const lastOptimizationLabel = lastReviewRow
    ? `${ACCOUNT_REVIEW_OUTCOME_LABEL[lastReviewRow.outcome]} · ${formatRelativeDateTime(lastReviewRow.reviewed_at, new Date())}${lastReviewRow.team_member?.name ? ` · ${lastReviewRow.team_member.name}` : ""}`
    : "Nenhuma otimização registrada";

  // Sinal de sincronização com problema real agora vive só em "Informações
  // da conta" (drawer global do workspace) — nunca mais duplicado aqui.
  const contractBannerText = contractStatusBannerText(client.status);
  const banners = [
    contractBannerText && { tone: "amber", text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.` },
    error && { tone: "red", text: error },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green" | "amber"; text: string } => Boolean(banner));

  // Links externos (Dashboard/Saldo/Fechamento) — existiam na barra de
  // navegação da página antiga (auditoria via git show 402e0af), tinham
  // sumido sem substituto na Fase 1; restaurados aqui na correção de
  // direção (c707395) e removidos por engano no rollback de incidente
  // (a252f78, que revertia só a composição de Performance/Operação/
  // Demandas). Nunca tiveram relação com o bug real do incidente
  // (`formatDueDate` chamada do server, corrigido em 54f451d) — seguros
  // pra restaurar de volta.
  const externalLinks = [
    client.dashboard_url && { label: "Dashboard", href: client.dashboard_url },
    client.balance_url && { label: "Saldo", href: client.balance_url },
    client.monthly_closing_sheet_url && { label: "Fechamento", href: client.monthly_closing_sheet_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  // Resultado só tem leitura de ritmo (renderiza a barra) quando há meta de
  // QUANTIDADE configurada pro mês — mesmo guard que `AccountFollowUpPanel`
  // já aplicava antes de renderizar `MonthlyGoalProgress`, nenhuma condição
  // nova.
  const hasResultRitmo = Boolean(performanceGoal) && consolidatedTargetResultCount != null && consolidatedTargetResultCount > 0 && expectedResultsToDate != null;

  // CTA do diagnóstico único (seção 6 do pedido) — "Ver Metas →" quando o
  // eixo fora do esperado é Investimento, "Ver Performance →" quando é
  // Custo por resultado; `null` sem desvio real, nenhuma CTA extra.
  const diagnosticCtaTarget = resolveDashboardDiagnosticCtaTarget({
    actualSpend: monthActual,
    expectedToDate: monthExpectedToDate,
    costPerResult: consolidatedPerformanceSummary?.costPerResult ?? null,
    targetCostPerResult: consolidatedTargetCostPerResult,
    resultCount: consolidatedPerformanceSummary?.resultCount ?? 0,
    hasPerformanceGoal: performanceGoal !== null,
  });
  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seção 18 do
  // pedido): "Editar planejamento →" saiu do Dashboard (edição de
  // orçamento agora é inline, `DashboardBudget`) — `metasHref` continua
  // existindo só pros CTAs "Ver Metas →" (Ritmo/Diagnóstico), sem `goal`
  // (não há mais objetivo "em exibição" nesta página pra propagar).
  const metasHref = buildMetasHref(client.id, { month: monthParam }, {});
  const performanceHref = `/clients/${client.id}/relatorio`;
  const canEditBudgetInline = isAdmin && !isClosedMonth && Boolean(effectiveDate);

  return (
    <WorkspaceContainer>
      <ScrollRestoreOnMount />
      <ClientWorkspaceContext name={client.name} />

      {banners.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {banners.map((banner, index) => (
            <p
              key={index}
              className={
                banner.tone === "red"
                  ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  : banner.tone === "amber"
                    ? "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
              }
            >
              {banner.text}
            </p>
          ))}
        </div>
      )}

      {/* Etapa "MEGA FACELIFT — Fase 4: Dashboard" (seção 3 do pedido): o
          nome/status/avatar do cliente e a navegação entre módulos já estão
          no Client Context global (`ClientWorkspaceContext` acima) — aqui o
          conteúdo começa simples, só o nome do próprio módulo. */}
      <h1 className="mt-4 text-sm font-semibold uppercase tracking-wide text-overview-text-muted">Dashboard</h1>

      {/* CONTEXTO — só o mês continua sendo um seletor (seção 4 do pedido:
          "Mês continua sendo contexto"). Objetivo e canal saíram daqui —
          Etapa "Evolução do Dashboard — Visão Simultânea de Canais", seção
          3: Meta Ads e Google Ads aparecem simultaneamente abaixo, nunca
          mais escolhidos num seletor pra "enxergar outro canal". */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-overview-border pb-3 text-sm">
        <div className="flex items-center gap-0.5">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <MonthSelect today={today} selectedMonthParam={monthParam} buildHref={(value) => buildContextHref({ month: value })} />
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {externalLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-overview-text-secondary hover:underline"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* ORÇAMENTO + CANAIS SIMULTÂNEOS — seções 5/6/9/10/11 do pedido:
          "abri o cliente → vejo o mês inteiro", sem precisar alternar
          Meta/Google pra entender a situação. Orçamento do mês (edição
          inline, mesma Server Action/RPC oficiais) seguido de um bloco por
          canal que o cliente realmente usa, cada um com o PRÓPRIO
          objetivo — nunca um `MonthlyKpiSummary` único de um canal/
          objetivo escolhido num seletor. */}
      <div className="mt-5 flex flex-col gap-4">
        <DashboardBudget
          clientId={client.id}
          monthParam={monthParam}
          total={monthPlanned}
          channels={dashboardChannels.map((c) => ({ channel: c.channel, planned: c.planned }))}
          canEdit={canEditBudgetInline}
        />
        {dashboardChannels.map((c) => (
          <DashboardChannelSection
            key={c.channel}
            channel={c.channel}
            goal={c.goal}
            actualSpend={c.actualSpend}
            planned={c.planned}
            performanceSummary={c.performanceSummary}
            targetCostPerResult={c.targetCostPerResult}
            targetResultCount={c.targetResultCount}
            configureObjectiveHref={`/clients/${client.id}/edit`}
          />
        ))}
      </div>

      {/* RITMO + DIAGNÓSTICO — seções 5/6 do pedido: ritmo do mês (maior,
          reaproveita `MonthlyGoalProgress`/`MonthInvestmentSummary`/
          `MonthInvestmentPaceNote` exatamente como antes, só que agora num
          card próprio com CTA pra Metas) ao lado de um único diagnóstico
          (`PerformanceDiagnosticCard`, mesmo motor de sempre) com CTA
          dinâmica pro módulo que o eixo fora do esperado aponta. */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col rounded-lg border border-overview-border bg-overview-surface p-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Ritmo do mês</h2>
            <Link href={metasHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
              Ver Metas →
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-3.5">
            {hasResultRitmo && (
              <MonthlyGoalProgress
                monthResultCount={consolidatedPerformanceSummary?.resultCount ?? 0}
                targetResultCount={consolidatedTargetResultCount as number}
                expectedToDate={expectedResultsToDate as number}
              />
            )}
            <MonthInvestmentSummary
              planned={monthPlanned}
              actual={monthActual}
              expectedToDate={monthExpectedToDate}
              status={monthStatus}
              monthLabel={monthLabel}
              monthRange={planningHorizon}
              isClosedMonth={isClosedMonth}
              isFutureMonth={isFutureMonth}
              currentPlanningEndDate={planningEndDate}
            />
          </div>
          <div className="mt-2.5">
            <MonthInvestmentPaceNote
              planned={monthPlanned}
              actual={monthActual}
              expectedToDate={monthExpectedToDate}
              sprints={budgetSprints}
              monthRange={planningHorizon}
              effectiveDate={effectiveDate}
              isClosedMonth={isClosedMonth}
              isFutureMonth={isFutureMonth}
              isAdmin={isAdmin}
              lastChange={null}
              historyHref={returnTo}
            />
          </div>
        </div>

        <div className="flex flex-col rounded-lg border border-overview-border bg-overview-surface p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Diagnóstico</h2>
          <div className="mt-3">
            <PerformanceDiagnosticCard
              performanceGoal={performanceGoal}
              actualSpend={monthActual}
              expectedToDate={monthExpectedToDate}
              costPerResult={consolidatedPerformanceSummary?.costPerResult ?? null}
              targetCostPerResult={consolidatedTargetCostPerResult}
              resultCount={consolidatedPerformanceSummary?.resultCount ?? 0}
            />
          </div>
          {diagnosticCtaTarget && (
            <Link
              href={diagnosticCtaTarget === "metas" ? metasHref : performanceHref}
              className="mt-3 text-xs font-medium text-brand hover:underline"
            >
              {diagnosticCtaTarget === "metas" ? "Ver Metas →" : "Ver Performance →"}
            </Link>
          )}
        </div>
      </div>

      {/* OPERAÇÃO + DEMANDAS — seções 9/10 do pedido: só sínteses curtas com
          CTA pro módulo completo, nunca sprint/tarefas detalhadas aqui
          (mesmos dados/funções de `/operation`/`/clients/[id]/demandas`,
          nenhum cálculo novo). */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Operação</h2>
            <Link href={`/clients/${client.id}/operation`} className="shrink-0 text-xs font-medium text-brand hover:underline">
              Ver Operação →
            </Link>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div>
              <p className="text-[11px] text-overview-text-muted">Sprint atual</p>
              <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{currentSprintLabel ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-overview-text-muted">Última otimização</p>
              <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{lastOptimizationLabel}</p>
            </div>
            <div>
              <p className="text-[11px] text-overview-text-muted">Saúde</p>
              {primaryReasonText ? (
                <p className="mt-0.5 text-sm font-medium" title={primaryReasonText}>
                  {emphasizeDeviationText(primaryReasonText, primaryReasonTone)}
                </p>
              ) : (
                <p className="mt-0.5 text-sm font-medium text-overview-text-primary">Sem sinais de atenção</p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Demandas</h2>
              <p className="mt-1 text-[13px] text-overview-text-secondary">
                {demandasOpenCount} em aberto
                {demandasOverdueCount > 0 && ` · ${demandasOverdueCount} atrasada${demandasOverdueCount !== 1 ? "s" : ""}`}
              </p>
            </div>
            <Link href={`/clients/${client.id}/demandas`} className="shrink-0 text-xs font-medium text-brand hover:underline">
              Ver Demandas →
            </Link>
          </div>
          {demandasPreview.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {demandasPreview.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_PRIORITY_DOT_CLASS[item.priority]}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-overview-text-primary">{item.title}</span>
                  <span className="shrink-0 text-xs text-overview-text-muted">{formatDueDate(item.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </WorkspaceContainer>
  );
}
