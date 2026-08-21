import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { ClientGoal } from "@/lib/client-goals";
import {
  computeAssignmentCoverage,
  computeGoalSpend,
  resolveGoalCostPerResult,
  type GoalCostUnavailableReason,
} from "@/lib/goal-spend";
import { fetchCampaignAssignments, fetchCampaignSpendForCoverage } from "@/lib/campaign-goal-assignments";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface SecondaryGoalPerformanceView {
  resultType: PerformanceGoal;
  resultCount: number;
  targetResultCount: number | null;
  goalSpend: number;
  costPerResult: number | null;
  costUnavailableReason: GoalCostUnavailableReason;
}

/**
 * Performance de objetivos SECUNDÁRIOS pro bloco adicional da página do
 * cliente (Etapa "Múltiplos Objetivos", seção 27) — deliberadamente uma
 * consulta PRÓPRIA por objetivo (nunca `resolvePerformanceRowsForSprints`,
 * `lib/performance-queries.ts`): aquela função decide manual×automático UMA
 * VEZ por CLIENTE inteiro (`getClientIdsWithActiveImportSource`) — correto
 * quando só existe 1 objetivo, mas incorreto aqui, onde CADA objetivo tem
 * sua própria `resultSource` (ex.: Leads automático via Stract, Seguidores
 * manual, mesmo cliente). Esta função decide a fonte OBJETIVO A OBJETIVO,
 * usando `client_goals.result_source`.
 */
export async function fetchSecondaryGoalsPerformance(
  supabase: Supabase,
  clientId: string,
  secondaryGoals: ClientGoal[],
  monthRange: { firstDay: string; lastDay: string },
  targetByGoal: Map<PerformanceGoal, number | null>,
): Promise<SecondaryGoalPerformanceView[]> {
  if (secondaryGoals.length === 0) return [];

  const [manualRows, automaticRows, assignments] = await Promise.all([
    requireQuery(
      supabase
        .from("performance_records")
        .select("channel, result_type, result_count, sprint_id")
        .eq("client_id", clientId)
        .gte("period_start", monthRange.firstDay)
        .lte("period_end", monthRange.lastDay)
        .eq("source", "manual"),
      "performance_records:secondary-goals",
    ),
    requireQuery(
      supabase
        .from("daily_performance")
        .select("channel, result_type, result_count")
        .eq("client_id", clientId)
        .gte("date", monthRange.firstDay)
        .lte("date", monthRange.lastDay),
      "daily_performance:secondary-goals",
    ),
    fetchCampaignAssignments(supabase, clientId),
  ]);

  const views: SecondaryGoalPerformanceView[] = [];

  for (const goal of secondaryGoals) {
    const rows = goal.resultSource === "manual" ? manualRows : automaticRows;
    const resultCount = rows.filter((r) => r.result_type === goal.resultType).reduce((sum, r) => sum + r.result_count, 0);

    const channels: TrafficChannel[] | null = goal.channels.length > 0 ? goal.channels : null;
    const campaignSpend = await fetchCampaignSpendForCoverage(supabase, clientId, { start: monthRange.firstDay, end: monthRange.lastDay }, channels);
    const coverage = computeAssignmentCoverage(campaignSpend, assignments);
    const goalSpend = computeGoalSpend(campaignSpend, assignments, goal.resultType);

    const { costPerResult, reason } = resolveGoalCostPerResult({
      resultCount,
      hasResult: resultCount > 0 || rows.some((r) => r.result_type === goal.resultType),
      goalSpend,
      coverage,
    });

    views.push({
      resultType: goal.resultType,
      resultCount,
      targetResultCount: targetByGoal.get(goal.resultType) ?? null,
      goalSpend,
      costPerResult,
      costUnavailableReason: reason,
    });
  }

  return views;
}
