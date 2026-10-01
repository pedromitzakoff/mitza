import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { listClientGoals, resolvePrimaryGoal, type ClientGoal } from "@/lib/client-goals";
import { resolveClientMonthlyGoals, resolveTargetCostPerResult, type ClientPlanChangeRow, type ClientGoalPlan } from "@/lib/client-plan";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { sumActualSpendForMonth } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, getRemainingEligibleDaysIncludingToday } from "@/lib/monthly-budget";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeCostPerResult, computeRoas } from "@/lib/performance";
import { computeAssignmentCoverage, computeGoalSpend, resolveGoalCostPerResult, describeGoalCostUnavailableReason } from "@/lib/goal-spend";
import { fetchCampaignAssignments, fetchCampaignSpendForCoverage } from "@/lib/campaign-goal-assignments";
import { buildCumulativeRow, buildRatioRow, sumByDate, type MetasRow } from "@/lib/metas-table";
import type { SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveSelectedGoal } from "./[id]/page";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

const EMPTY_GOAL_PLAN: Pick<ClientGoalPlan, "byChannel" | "consolidated"> = {
  byChannel: {},
  consolidated: { investment: null, resultCount: null, cpa: null },
};

export interface MetasPageData {
  goals: ClientGoal[];
  selectedGoal: ClientGoal | null;
  isPrimary: boolean;
  monthRange: { firstDay: string; lastDay: string };
  todayStr: string;
  rows: MetasRow[];
  /** Plano por canal do objetivo selecionado — exposto pra reaproveitar
   * `ChannelPlanEditor` (objetivo principal) sem recalcular nada de novo. */
  selectedGoalPlan: Pick<ClientGoalPlan, "byChannel" | "consolidated">;
}

/**
 * Carrega os dados da tabela "RESUMO DAS METAS" — Etapa "MEGA FACELIFT —
 * Fase 2: Metas". Reaproveita integralmente o núcleo já existente
 * (`listClientGoals`/`resolveClientMonthlyGoals`/`resolveSelectedGoal`,
 * este último importado de `[id]/page.tsx` em vez de duplicado — mesmo
 * seletor de objetivo do Painel, nenhuma segunda regra); a única lógica
 * genuinamente NOVA é a montagem das linhas/grade de dias
 * (`lib/metas-table.ts`).
 *
 * Auditoria desta etapa (seção 9 do pedido) confirmou uma assimetria real
 * entre objetivo PRINCIPAL e SECUNDÁRIO, nunca uma simplificação de
 * implementação:
 * - Investimento do PRINCIPAL vem do plano mensal por canal
 *   (`monthly_budget_changes`, mesma fonte do Painel) + `daily_spend` real.
 * - Investimento de um SECUNDÁRIO nunca é planejado manualmente
 *   (`apply_monthly_channel_plan_change` grava SEMPRE `result_type` do
 *   objetivo principal — ver `monthly-budget-actions.ts` — e
 *   `set_goal_monthly_target` grava `new_amount = 0` como placeholder,
 *   nunca orçamento real, ver `supabase/client-goals.sql`): "Meta" fica
 *   SEMPRE `null` pra este objetivo, "Realizado" vem só do que é
 *   DERIVÁVEL de campanhas de fato classificadas a ele (`goalSpend`,
 *   `lib/goal-spend.ts` — mesma fonte já usada por
 *   `fetchSecondaryGoalsPerformance`), sem granularidade diária nesta
 *   rodada (gap documentado no relatório de entrega, nunca uma
 *   distribuição inventada do total mensal pelos dias).
 *
 * Resultado (contagem) não tem essa assimetria — `client_goals.result_source`
 * (automático/manual) decide a granularidade pra QUALQUER objetivo,
 * principal ou secundário: automático lê `daily_performance` (grão diário
 * real), manual lê `performance_records` (grão de sprint, sem grade diária
 * possível — nunca fabricada).
 */
export async function loadMetasPageData(
  supabase: Supabase,
  clientId: string,
  monthRange: { firstDay: string; lastDay: string },
  todayStr: string,
  goalParam: string | undefined,
): Promise<MetasPageData | null> {
  const { firstDay, lastDay } = monthRange;

  const [{ data: client }, allClientGoals] = await Promise.all([
    supabase.from("clients").select("id, performance_goal, target_cost_per_result").eq("id", clientId).is("deleted_at", null).maybeSingle(),
    listClientGoals(supabase, clientId),
  ]);
  if (!client) return null;

  // Mesma ponte de compatibilidade do Painel (`[id]/page.tsx`) — cliente
  // legado sem nenhuma linha em `client_goals` (não deveria acontecer, mas
  // nunca assumido como garantia aqui) cai num objetivo "virtual" só com o
  // `performance_goal` legado.
  const effectiveClientGoals: ClientGoal[] =
    allClientGoals.length > 0
      ? allClientGoals
      : client.performance_goal
        ? [{ id: "", clientId, resultType: client.performance_goal, channels: [], isPrimary: true, resultSource: "automatic" }]
        : [];

  const primaryResultType = resolvePrimaryGoal(effectiveClientGoals)?.resultType ?? null;
  const selectedResultType = resolveSelectedGoal(goalParam, effectiveClientGoals.map((g) => g.resultType), primaryResultType);
  const selectedGoal = effectiveClientGoals.find((g) => g.resultType === selectedResultType) ?? null;

  if (!selectedGoal) {
    return { goals: effectiveClientGoals, selectedGoal: null, isPrimary: false, monthRange, todayStr, rows: [], selectedGoalPlan: EMPTY_GOAL_PLAN };
  }

  const isPrimary = selectedGoal.isPrimary;
  const goalChannels: TrafficChannel[] = selectedGoal.channels.length > 0 ? selectedGoal.channels : AVAILABLE_TRAFFIC_CHANNELS;

  const [sprintsRaw, dailySpendRaw, channelSpendRows, budgetHistoryRaw] = await Promise.all([
    requireQuery(
      supabase
        .from("sprints")
        .select("id, start_date, end_date, spend_source, manual_actual_spend")
        .eq("client_id", clientId)
        .lte("start_date", lastDay)
        .gte("end_date", firstDay),
      "sprints:metas",
    ),
    requireQuery(
      supabase.from("daily_spend").select("date, channel, spend").eq("client_id", clientId).gte("date", firstDay).lte("date", lastDay),
      "daily_spend:metas",
    ),
    requireQuery(
      supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", clientId),
      "sprint_channel_spend:metas",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, result_type, month, changed_at, new_amount, target_result_count")
        .eq("client_id", clientId)
        .lte("month", firstDay),
      "monthly_budget_changes:metas",
    ),
  ]);

  const channelSpendOverrideRows: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));
  const sprints = sprintsRaw.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(sprint.manual_actual_spend, channelSpendOverrideRows.filter((r) => r.sprintId === sprint.id)),
  }));

  const budgetHistory: ClientPlanChangeRow[] = (budgetHistoryRaw ?? []).map((row) => ({
    channel: row.channel as TrafficChannel,
    month: row.month,
    changedAt: row.changed_at,
    investment: row.new_amount,
    targetResultCount: row.target_result_count,
    resultType: (row.result_type ?? primaryResultType) as PerformanceGoal | null,
  }));
  const clientGoalsPlan = resolveClientMonthlyGoals({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: budgetHistory,
    selectedMonth: firstDay,
    clientGoals: effectiveClientGoals,
  });
  const selectedGoalPlan = clientGoalsPlan.goals.find((g) => g.resultType === selectedGoal.resultType) ?? EMPTY_GOAL_PLAN;

  const effectiveDateInfo = resolveBudgetEffectiveDate(monthRange, todayStr);
  const eligibleDaysCount = getRemainingEligibleDaysIncludingToday(monthRange, effectiveDateInfo.effectiveDate);

  // ---- Resultado (contagem) + Faturamento — granularidade decidida por
  // `result_source`, válida igualmente pra objetivo principal ou secundário.
  let resultRows: { date: string; result_count: number; revenue: number | null }[];
  const hasDailyResultGranularity = selectedGoal.resultSource === "automatic";

  if (hasDailyResultGranularity) {
    const dailyPerfRaw = await requireQuery(
      supabase
        .from("daily_performance")
        .select("date, channel, result_type, result_count, revenue")
        .eq("client_id", clientId)
        .gte("date", firstDay)
        .lte("date", lastDay),
      "daily_performance:metas",
    );
    resultRows = (dailyPerfRaw ?? [])
      .filter((r) => r.result_type === selectedGoal.resultType && goalChannels.includes(r.channel as TrafficChannel))
      .map((r) => ({ date: r.date, result_count: r.result_count, revenue: r.revenue }));
  } else {
    const manualRaw = await requireQuery(
      supabase
        .from("performance_records")
        .select("period_start, channel, result_type, result_count, revenue")
        .eq("client_id", clientId)
        .eq("source", "manual")
        .gte("period_start", firstDay)
        .lte("period_end", lastDay),
      "performance_records:metas",
    );
    resultRows = (manualRaw ?? [])
      .filter((r) => r.result_type === selectedGoal.resultType && goalChannels.includes(r.channel as TrafficChannel))
      .map((r) => ({ date: r.period_start, result_count: r.result_count, revenue: r.revenue }));
  }

  const resultCountTotal = resultRows.reduce((sum, r) => sum + r.result_count, 0);
  const hasResultData = resultRows.length > 0;
  const revenueRows = resultRows.filter((r) => r.revenue !== null && r.revenue !== undefined);
  const revenueTotal = revenueRows.length > 0 ? revenueRows.reduce((sum, r) => sum + (r.revenue ?? 0), 0) : null;

  const resultDailyValues = hasDailyResultGranularity ? sumByDate(resultRows.map((r) => ({ date: r.date, value: r.result_count }))) : null;
  const revenueDailyValues =
    hasDailyResultGranularity && revenueTotal !== null ? sumByDate(revenueRows.map((r) => ({ date: r.date, value: r.revenue as number }))) : null;

  const targetResultCount = selectedGoalPlan.consolidated.resultCount;

  // ---- Investimento + Custo por resultado — assimetria real
  // principal×secundário (ver doc-comment do módulo acima).
  let investmentTargetMonth: number | null = null;
  let investmentRealizedMonth = 0;
  let investmentDailyValues: Map<string, number> | null = null;
  let targetCostPerResult: number | null = null;
  let costPerResultRealized: number | null = null;
  let costUnavailableNote: string | null = null;

  if (isPrimary) {
    investmentTargetMonth = selectedGoalPlan.consolidated.investment;
    const dailySpendInScope = (dailySpendRaw ?? []).filter((d) => goalChannels.includes(d.channel as TrafficChannel));
    investmentRealizedMonth = sumActualSpendForMonth(sprints, monthRange, dailySpendInScope);
    investmentDailyValues = dailySpendInScope.length > 0 ? sumByDate(dailySpendInScope.map((d) => ({ date: d.date, value: d.spend }))) : null;
    targetCostPerResult = resolveTargetCostPerResult({ channel: "consolidated", plan: selectedGoalPlan, legacyFallback: client.target_cost_per_result });
    costPerResultRealized = computeCostPerResult(investmentRealizedMonth, resultCountTotal, hasResultData);
  } else {
    const [campaignSpend, assignments] = await Promise.all([
      fetchCampaignSpendForCoverage(supabase, clientId, { start: firstDay, end: lastDay }, selectedGoal.channels.length > 0 ? selectedGoal.channels : null),
      fetchCampaignAssignments(supabase, clientId),
    ]);
    const coverage = computeAssignmentCoverage(campaignSpend, assignments);
    investmentRealizedMonth = computeGoalSpend(campaignSpend, assignments, selectedGoal.resultType);
    // Sem grade diária nesta rodada — gap documentado, nunca uma
    // distribuição inventada do total mensal pelos dias.
    investmentDailyValues = null;

    const { costPerResult, reason } = resolveGoalCostPerResult({
      resultCount: resultCountTotal,
      hasResult: hasResultData,
      goalSpend: investmentRealizedMonth,
      coverage,
    });
    costPerResultRealized = costPerResult;
    costUnavailableNote = describeGoalCostUnavailableReason(reason);
    // Meta de custo de um secundário nunca existe de verdade (não há meta
    // de investimento real pra derivar) — nunca fabricada.
    targetCostPerResult = null;
  }

  const roasRealized = computeRoas(revenueTotal, investmentRealizedMonth);

  const resultLabel = PERFORMANCE_GOALS[selectedGoal.resultType].resultMetricLabel;
  const costLabel = PERFORMANCE_GOALS[selectedGoal.resultType].costMetricShortLabel;

  const rows: MetasRow[] = [
    buildCumulativeRow({
      key: "resultado",
      label: resultLabel,
      unit: "count",
      monthRange,
      todayStr,
      eligibleDaysCount,
      targetMonth: targetResultCount,
      realizedMonth: resultCountTotal,
      hasRealizedData: hasResultData,
      dailyValues: resultDailyValues,
      sensitivity: "any",
    }),
    buildCumulativeRow({
      key: "investimento",
      label: "Investimento",
      unit: "currency",
      monthRange,
      todayStr,
      eligibleDaysCount,
      targetMonth: investmentTargetMonth,
      realizedMonth: investmentRealizedMonth,
      hasRealizedData: true,
      dailyValues: investmentDailyValues,
      sensitivity: "any",
    }),
    buildRatioRow({
      key: "custo",
      label: costLabel,
      unit: "currency",
      monthRange,
      todayStr,
      targetMonth: targetCostPerResult,
      realizedMonth: costPerResultRealized,
      resultCountForReliability: resultCountTotal,
      diagnosticKind: "cpa",
      unavailableNote: costUnavailableNote,
      dailyNumerator: investmentDailyValues,
      dailyDenominator: resultDailyValues,
    }),
  ];

  if (revenueTotal !== null) {
    rows.push(
      buildCumulativeRow({
        key: "faturamento",
        label: "Faturamento",
        unit: "currency",
        monthRange,
        todayStr,
        eligibleDaysCount,
        targetMonth: null,
        realizedMonth: revenueTotal,
        hasRealizedData: true,
        dailyValues: revenueDailyValues,
        sensitivity: "any",
      }),
    );
    rows.push(
      buildRatioRow({
        key: "roas",
        label: "ROAS",
        unit: "ratio_x",
        monthRange,
        todayStr,
        targetMonth: null,
        realizedMonth: roasRealized,
        diagnosticKind: "none",
        unavailableNote: null,
        dailyNumerator: revenueDailyValues,
        dailyDenominator: investmentDailyValues,
      }),
    );
  }

  return { goals: effectiveClientGoals, selectedGoal, isPrimary, monthRange, todayStr, rows, selectedGoalPlan };
}
