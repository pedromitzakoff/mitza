import Link from "next/link";
import { Fragment } from "react";
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
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import {
  resolveBudgetEffectiveDate,
  computeMonthlyExpectedToDateByCalendar,
  resolvePlanningHorizon,
  computeMonthlyBudgetPlan,
  computeNeededDailyRate,
  getRemainingEligibleDaysIncludingToday,
} from "@/lib/monthly-budget";
import { resolveClientMonthlyGoals, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import { consolidateAdditive, type ChannelMetrics } from "@/lib/channel-metrics";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatRelativeDateTime } from "@/lib/format";
import { contractStatusBannerText } from "@/lib/client-fields";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { evaluateCpaDiagnostic } from "@/lib/metric-diagnostics";
import { listClientGoals, resolvePrimaryGoal, resolveChannelGoal, type ClientGoal } from "@/lib/client-goals";
import { computePerformanceSummary } from "@/lib/performance";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, resolveClientMediaChannels, TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { MonthSelect } from "../month-select";
import { DashboardChannelSection, type DashboardChannelDataIssue } from "../dashboard-channel-section";
import { countOpenDemandas } from "@/lib/pendencias";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
import { WorkspaceContainer } from "../workspace-container";
import { IconButton } from "@/components/workspace/button";
import { buildMetasHref } from "./metas/page";
import { groupChannelsByResultType } from "@/lib/cockpit-result-groups";
import { buildCockpitInsights } from "@/lib/cockpit-diagnostics";
import type { DataAttention } from "@/lib/data-trust";
import { loadDadosPageData } from "../dados-data";
import { fetchClientTimelinePage } from "@/lib/client-timeline";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPeriodReading } from "@/lib/performance-report/report-derivatives";
import { CockpitResultCard, CockpitCostCard, CockpitBudgetCard, type CockpitResultCardView, type CockpitCostCardView } from "../cockpit-meta-ritmo-section";
import { CockpitDiagnosticsCard } from "../cockpit-diagnostics-card";
import { CockpitExecutionSection } from "../cockpit-execution-section";
import { CockpitPerformanceSection, type CockpitPerformanceView } from "../cockpit-performance-section";
import { CockpitHistorySection } from "../cockpit-history-section";
import { RecordAccountReviewDrawer } from "../record-account-review-drawer";

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
 * troca (seção 6: "compatível com troca de cliente"). Continua exportada e
 * testada (`metas-data.ts` segue usando) mesmo não sendo mais chamada por
 * esta página.
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

/** Anota um canal com a atenção de Dados que o afeta (seção 16 do pedido:
 * "diferenciar canal sem dados / erro de sincronização / zero resultados —
 * nunca tratar todos como '—'") — reaproveita literalmente a mesma lista
 * de atenções que `/clients/[id]/dados` já exibe (`DataAttention.message`
 * sempre carrega "{Provedor} · {Canal}: ..."), nenhuma segunda checagem de
 * fonte/sincronização. `null` quando nenhuma atenção menciona este canal. */
export function findChannelDataIssue(attentions: DataAttention[], channelLabel: string): DashboardChannelDataIssue | null {
  const match = attentions.find((a) => a.message.includes(channelLabel));
  if (!match) return null;
  return { severity: match.severity, label: match.severity === "error" ? "Erro de sincronização" : "Sem dados recebidos" };
}

/**
 * `/clients/[id]` — MITZA ONE, Fase 1: Cockpit Único do Cliente. A pergunta
 * que esta página responde, e SÓ esta: "como está o growth deste cliente
 * agora, e o que precisa da minha atenção?" — uma NOVA COMPOSIÇÃO em torno
 * da infraestrutura oficial já existente (Dashboard/Metas/Performance/
 * Dados/Operação/Demandas/Timeline), nunca as 7 páginas antigas empilhadas
 * (ver relatório de entrega desta fase — estrutura final, fontes por
 * seção, divergências encontradas).
 *
 * As 7 rotas de aprofundamento (`/metas`, `/relatorio`, `/dados`,
 * `/operation`, `/demandas`, `/timeline`, `/edit`) continuam existindo
 * integralmente — esta página só deixa de ser a soma delas, virando o
 * ponto de partida que aponta pra cada uma quando for preciso investigar
 * mais a fundo.
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
    review?: string;
    reviewError?: string;
  }>;
}) {
  const { id } = await params;
  const { error, synced, saved, month: monthQueryParam, review, reviewError } = await searchParams;

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

  const canOperate = client.status === "ativo";

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais" (seção 12
  // do pedido): a MESMA fonte de sempre pra "quais canais este cliente
  // realmente usa" (`clients.media_channels`, lib/traffic-channels.ts) —
  // nunca uma segunda checagem de presença de dado. Ordenado por
  // `AVAILABLE_TRAFFIC_CHANNELS` (Meta antes de Google) — nunca a ordem
  // crua de `media_channels` no banco.
  const clientChannels = AVAILABLE_TRAFFIC_CHANNELS.filter((c) => resolveClientMediaChannels(client.media_channels).includes(c));

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;

  const [clientOperationalState] = await loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, id);

  const monthParam = firstDay.slice(0, 7);
  const prevMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, -1) });
  const nextMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, 1) });
  const returnTo = buildContextHref({});
  const registerReviewHref = `${returnTo}${returnTo.includes("?") ? "&" : "?"}review=new`;

  const [sprintsRaw, dailySpend, plannedAllocations, budgetChangesRaw, performanceTargetHistoryRaw, channelSpendRows, planningEndDate, allClientGoals, dadosData] =
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
      // MITZA ONE — Fase 1, Seção "Dados vira alerta" (seção 13 do pedido):
      // MESMA função que `/clients/[id]/dados` já usa (`loadDadosPageData`)
      // — nenhuma segunda leitura de `import_sources`/`metric_mappings`.
      // Só os `attentions` entram no Diagnóstico; o resto do retorno (fontes/
      // objetivos/health) não é usado aqui (a tela Dados completa continua
      // existindo pra quem precisar do detalhe).
      loadDadosPageData(supabase, id, isAdmin),
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

  // Múltiplos Objetivos: ZERO migration — reaproveita
  // `client_goals`/`monthly_budget_changes.result_type`/
  // `resolveClientMonthlyGoals`. Cliente legado sem nenhuma linha em
  // `client_goals` cai num objetivo "virtual" só com o `performance_goal`
  // legado, pra `resolveClientMonthlyGoals` continuar funcionando sem um
  // caso especial espalhado pela página inteira.
  const effectiveClientGoals: ClientGoal[] =
    allClientGoals.length > 0
      ? allClientGoals
      : client.performance_goal
        ? [{ id: "", clientId: id, resultType: client.performance_goal, channels: [], isPrimary: true, resultSource: "automatic" }]
        : [];
  const primaryResultType = resolvePrimaryGoal(effectiveClientGoals)?.resultType ?? null;

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

  // Etapa "Evolução do Dashboard — Visão Simultânea de Canais": um bloco
  // por canal que o cliente REALMENTE usa, cada um com o PRÓPRIO objetivo
  // (`resolveChannelGoal`) e o PRÓPRIO investimento realizado
  // (`sumChannelEffectiveSpend`). Investimento planejado por canal vem de
  // `clientGoalsPlan` (nunca estimado/dividido do total).
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

  // Etapa "Correção de Semântica — Orçamento do Mês Multicanal": o
  // "Orçamento do mês" é a SOMA dos planejamentos REAIS de cada canal que o
  // cliente usa — dinheiro sempre soma entre canais, independente de
  // objetivo (nunca confundir com a regra de Resultado, abaixo, que NUNCA
  // soma entre objetivos diferentes).
  const totalPlannedAcrossChannels =
    consolidateAdditive(clientChannels, (channel) => dashboardChannels.find((c) => c.channel === channel)?.planned ?? null) ??
    sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });

  const monthPlanned = totalPlannedAcrossChannels;
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(monthPlanned, planningHorizon, todayStr).expectedToDate;
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);
  const canEditBudgetInline = isAdmin && !isClosedMonth && Boolean(effectiveDate);

  // MITZA ONE — Fase 1, card "ORÇAMENTO": "Necessário R$Z/dia" é
  // `computeMonthlyBudgetPlan(...).recommendedDaily` — MESMA função
  // central que `MonthInvestmentPaceNote` já usava antes desta fase, nunca
  // uma segunda fórmula de ritmo recomendado. `null` fora do mês corrente
  // (mês futuro/encerrado não tem "dias restantes" — mesmo guard de
  // `hasPace` em `month-investment-summary.tsx`).
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

  // MITZA ONE — Fase 1, Seção "Meta & Ritmo" (seção 9 do pedido: "não somar
  // resultados incompatíveis"). Agrupa os canais pelo PRÓPRIO objetivo
  // (`groupChannelsByResultType`, núcleo puro) — caso comum (1 objetivo só)
  // gera 1 grupo, idêntico ao que a página já calculava antes desta fase;
  // mais de um objetivo gera 1 grupo por objetivo, nunca um consolidado
  // fabricado entre eles.
  const resultGroups = groupChannelsByResultType(
    dashboardChannels.map((c) => ({ channel: c.channel, resultType: c.goal?.resultType ?? null })),
    primaryResultType,
  );
  const eligibleDaysCount = getRemainingEligibleDaysIncludingToday(planningHorizon, effectiveDate);

  const resultCards: { result: CockpitResultCardView; status: SpendStatus | null; cost: CockpitCostCardView }[] = resultGroups.map((group) => {
      const groupActualSpend = group.channels.reduce((sum, channel) => sum + (dashboardChannels.find((c) => c.channel === channel)?.actualSpend ?? 0), 0);
      const goalPlan = clientGoalsPlan.goals.find((g) => g.resultType === group.resultType) ?? EMPTY_GOAL_PLAN;
      const targetCostPerResult = resolveTargetCostPerResult({
        channel: "consolidated",
        plan: goalPlan,
        legacyFallback: group.isPrimary ? client.target_cost_per_result : null,
      });
      const performanceSummary = computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: group.resultType,
        consolidatedActualSpend: groupActualSpend,
        targetCostPerResult,
      });
      const targetResultCount = goalPlan.consolidated.resultCount;
      const expectedResultsToDate =
        targetResultCount !== null ? computeMonthlyExpectedToDateByCalendar(targetResultCount, planningHorizon, todayStr).expectedToDate : null;
      const neededDailyRate = computeNeededDailyRate(targetResultCount, performanceSummary.resultCount, eligibleDaysCount);
      const status =
        targetResultCount !== null && targetResultCount > 0 && expectedResultsToDate !== null
          ? classifySpendStatus(performanceSummary.resultCount, expectedResultsToDate, targetResultCount)
          : null;
      const costDiagnostic = evaluateCpaDiagnostic(performanceSummary.costPerResult, targetCostPerResult, performanceSummary.resultCount);

      return {
        result: {
          resultType: group.resultType,
          channelsLabel: resultGroups.length > 1 ? group.channels.map((c) => TRAFFIC_CHANNELS[c].label).join(" + ") : null,
          resultCount: performanceSummary.resultCount,
          targetResultCount,
          expectedResultsToDate,
          neededDailyRate,
        },
        status,
        cost: {
          resultType: group.resultType,
          costPerResult: performanceSummary.costPerResult,
          targetCostPerResult,
          deviationPct: costDiagnostic?.deviationPct ?? null,
          tone: costDiagnostic?.tone ?? "normal",
        },
      };
    });

  // MITZA ONE — Fase 1, Seção "Diagnóstico" (seções 11-13 do pedido):
  // reaproveita o `ClientDiagnostics` que `loadClientOperationalStates` já
  // calcula (escopado ao objetivo PRINCIPAL, mesma convenção de sempre —
  // generalizar por objetivo é um escopo maior, documentado como
  // divergência conhecida no relatório desta fase) + as atenções de Dados
  // já carregadas acima.
  const insights = clientOperationalState
    ? buildCockpitInsights({
        diagnostics: clientOperationalState.diagnostics,
        costLabel: primaryResultType ? PERFORMANCE_GOALS[primaryResultType].costMetricShortLabel : "Custo por resultado",
        dataAttentions: dadosData?.attentions ?? [],
      })
    : [];

  // Demandas — resumo: contagem + até 3 itens mais urgentes, nunca a List
  // View inteira. Reaproveita `loadPendenciasRawData` (MESMA fonte/regra de
  // `/clients/[id]/demandas` e da área global — `origin='manual'`).
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

  // Operação — resumo: sprint atual, última otimização. MESMOS dados/
  // funções já usados por `/operation` e pela fila global de Operação.
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
    "account_reviews:cockpit-resumo",
  );
  const lastOptimizationLabel = lastReviewRow
    ? `${ACCOUNT_REVIEW_OUTCOME_LABEL[lastReviewRow.outcome]} · ${formatRelativeDateTime(lastReviewRow.reviewed_at, new Date())}${lastReviewRow.team_member?.name ? ` · ${lastReviewRow.team_member.name}` : ""}`
    : "Nenhuma otimização registrada";

  // MITZA ONE — Fase 1, Seção "Histórico": MESMA fonte da Timeline do
  // cliente (`fetchClientTimelinePage`), só as linhas mais recentes.
  const { rows: historyRows } = profile
    ? await fetchClientTimelinePage(supabase, profile.organizationId, id, "todos", 0, 6)
    : { rows: [] };

  // MITZA ONE — Fase 1, Seção "Performance essencial" (seções 18-20 do
  // pedido): reaproveita 100% a Camada 1 do Relatório de Performance
  // (`buildPerformanceReportData`) e a "Leitura do período"
  // (`buildPeriodReading`) — nenhum cálculo novo, nenhuma segunda
  // agregação de campanhas. Sempre "Visão geral" (nunca um funil
  // específico nesta primeira camada).
  const performanceReportData = await buildPerformanceReportData(supabase, id, { start: firstDay, end: lastDay });
  const performanceView: CockpitPerformanceView =
    performanceReportData.summary.status === "no_goal"
      ? { kind: "no_goal" }
      : performanceReportData.summary.status === "no_data"
        ? { kind: "no_data" }
        : performanceReportData.summary.status === "investment_only"
          ? { kind: "investment_only", totalSpend: performanceReportData.summary.totalSpend }
          : {
              kind: "ok",
              reading: buildPeriodReading({
                performanceGoal: performanceReportData.performanceGoal as PerformanceGoal,
                performanceSummary: performanceReportData.summary.performanceSummary,
                campaigns: performanceReportData.campaigns,
              }),
            };

  const contractBannerText = contractStatusBannerText(client.status);
  const banners = [
    contractBannerText && { tone: "amber", text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.` },
    error && { tone: "red", text: error },
    reviewError && { tone: "red", text: reviewError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green" | "amber"; text: string } => Boolean(banner));

  const externalLinks = [
    client.dashboard_url && { label: "Dashboard", href: client.dashboard_url },
    client.balance_url && { label: "Saldo", href: client.balance_url },
    client.monthly_closing_sheet_url && { label: "Fechamento", href: client.monthly_closing_sheet_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  const metasHref = buildMetasHref(client.id, { month: monthParam }, {});
  const performanceHref = `/clients/${client.id}/relatorio`;
  const operationHref = `/clients/${client.id}/operation`;
  const demandasHref = `/clients/${client.id}/demandas`;
  const timelineHref = `/clients/${client.id}/timeline`;

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

      {/* CONTEXTO — seção 4 do pedido: "DASHBOARD / [Mês]". Mês continua
          sendo o único seletor de contexto no topo (nunca mais canal/
          objetivo — Meta Ads e Google Ads sempre simultâneos abaixo). */}
      <h1 className="mt-4 text-sm font-semibold uppercase tracking-wide text-overview-text-muted">Dashboard</h1>

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

      {/* SEÇÃO 1 — META & RITMO (pedido, seções 5-10): "Estamos no caminho
          certo?". Um par Resultado/Custo por objetivo realmente em jogo +
          1 card de Orçamento (sempre multicanal). "Ver Metas →" aponta pro
          planejamento completo por canal (`ChannelPlanEditor`), mesma
          simetria que as outras seções já têm com seu módulo completo. */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Meta &amp; Ritmo</h2>
        <Link href={metasHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
          Ver Metas →
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {resultCards.map(({ result, status, cost }) => (
          <Fragment key={`group-${result.resultType}-${result.channelsLabel ?? "all"}`}>
            <CockpitResultCard view={result} status={status} />
            <CockpitCostCard view={cost} />
          </Fragment>
        ))}
        <CockpitBudgetCard
          headline={{ monthActual, monthPlanned, monthExpectedToDate, monthStatus, neededDailyRate: budgetNeededDailyRate }}
          clientId={client.id}
          monthParam={monthParam}
          channels={dashboardChannels.map((c) => ({ channel: c.channel, planned: c.planned }))}
          canEdit={canEditBudgetInline}
        />
      </div>

      {/* SEÇÃO 2 — DIAGNÓSTICO (pedido, seções 11-13): "Onde preciso
          prestar atenção?". */}
      <div className="mt-5">
        <CockpitDiagnosticsCard insights={insights} />
      </div>

      {/* SEÇÃO 3 — CANAIS (pedido, seções 14-17): "Como cada canal está
          performando?". Empilhado verticalmente, sem dropdown/tabs/
          carousel — mesmos componentes de sempre (`DashboardChannelSection`),
          só com o selo de atenção de Dados quando existe (seção 16). */}
      <div className="mt-5 flex flex-col gap-4">
        {dashboardChannels.map((c) => (
          <DashboardChannelSection
            key={c.channel}
            channel={c.channel}
            goal={c.goal}
            actualSpend={c.actualSpend}
            performanceSummary={c.performanceSummary}
            targetCostPerResult={c.targetCostPerResult}
            targetResultCount={c.targetResultCount}
            configureObjectiveHref={`/clients/${client.id}/edit`}
            dataIssue={findChannelDataIssue(dadosData?.attentions ?? [], TRAFFIC_CHANNELS[c.channel].label)}
          />
        ))}
      </div>

      {/* SEÇÃO 4 — PERFORMANCE ESSENCIAL (pedido, seções 18-20): "Onde está
          o problema ou oportunidade?". */}
      <div className="mt-5">
        <CockpitPerformanceSection view={performanceView} campaignsHref={performanceHref} fullReportHref={performanceHref} />
      </div>

      {/* SEÇÃO 5 — EXECUÇÃO (pedido, seções 21-25): "O que estamos fazendo
          nessa conta?" / "O que está pendente?". */}
      <div className="mt-5">
        <CockpitExecutionSection
          clientId={client.id}
          currentSprintLabel={currentSprintLabel}
          lastOptimizationLabel={lastOptimizationLabel}
          registerReviewHref={registerReviewHref}
          operationHref={operationHref}
          demandasOpenCount={demandasOpenCount}
          demandasOverdueCount={demandasOverdueCount}
          demandasPreview={demandasPreview}
          demandasHref={demandasHref}
          canOperate={canOperate}
        />
      </div>

      {/* SEÇÃO 6 — HISTÓRICO (pedido, seções 26-28): "O que aconteceu
          recentemente?". */}
      <div className="mt-5">
        <CockpitHistorySection rows={historyRows} fullHistoryHref={timelineHref} />
      </div>

      {review === "new" && (
        <RecordAccountReviewDrawer clientId={client.id} closeHref={returnTo} managers={[]} error={reviewError} />
      )}
    </WorkspaceContainer>
  );
}
