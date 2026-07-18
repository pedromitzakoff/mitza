import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";
import { computeVariationFromTarget, isCostAboveTargetPriority } from "@/lib/performance";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import {
  buildOperationTriageClient,
  computeComparableSpendRanges,
  sortOperationTriageClients,
  type OperationTriageClient,
} from "@/lib/operation-triage";

const MIN_RELIABLE_RESULT_COUNT = 3;

/**
 * Pipeline de dados PRÓPRIO da Operação (seção 5 do pedido) — nenhuma
 * query aqui é compartilhada com `app/operation/operation-data.ts` (motor
 * da Sprint, usado por Visão Geral/Clientes/Relatórios) nem com
 * `app/sprints/`. Se este arquivo mudar, nada fora da Operação é afetado;
 * se a Sprint for removida (Etapa 5), nada aqui quebra.
 */
export async function loadOperationTriageClients(monthParam: string): Promise<OperationTriageClient[]> {
  const supabase = await createSupabaseClient();
  const today = todayUTC();

  const { current, previous } = computeComparableSpendRanges(monthParam, today);
  const monthStart = monthParam;
  const monthEnd = `${monthParam.slice(0, 7)}-31`;

  const [
    { data: clients },
    { data: dailySpendRows },
    { data: latestReviews },
    { data: performanceRows },
    { data: openTasks },
    { data: lastActivityRows },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(name)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("daily_spend")
      .select("client_id, date, spend")
      .gte("date", previous.start)
      .lte("date", current.end),
    supabase.from("account_reviews").select("client_id, reviewed_at").order("reviewed_at", { ascending: false }),
    supabase
      .from("performance_records")
      .select("client_id, result_type, result_count, period_start, period_end")
      .lte("period_start", monthEnd)
      .gte("period_end", monthStart),
    supabase
      .from("tasks")
      .select("client_id, status, due_date")
      .in("status", ["pendente", "atrasado"]),
    supabase.from("client_last_operational_activity").select("client_id, last_activity_at"),
  ]);

  const monthSpendByClient = new Map<string, number>();
  const currentPeriodSpendByClient = new Map<string, number>();
  const previousPeriodSpendByClient = new Map<string, number>();
  for (const row of dailySpendRows ?? []) {
    if (row.date >= monthStart && row.date <= monthEnd) {
      monthSpendByClient.set(row.client_id, (monthSpendByClient.get(row.client_id) ?? 0) + row.spend);
    }
    if (row.date >= current.start && row.date <= current.end) {
      currentPeriodSpendByClient.set(row.client_id, (currentPeriodSpendByClient.get(row.client_id) ?? 0) + row.spend);
    }
    if (row.date >= previous.start && row.date <= previous.end) {
      previousPeriodSpendByClient.set(row.client_id, (previousPeriodSpendByClient.get(row.client_id) ?? 0) + row.spend);
    }
  }

  const latestReviewByClient = new Map<string, string>();
  for (const row of latestReviews ?? []) {
    if (!latestReviewByClient.has(row.client_id)) latestReviewByClient.set(row.client_id, row.reviewed_at);
  }

  const resultCountByClient = new Map<string, number>();
  for (const row of performanceRows ?? []) {
    resultCountByClient.set(row.client_id, (resultCountByClient.get(row.client_id) ?? 0) + row.result_count);
  }

  const overdueCountByClient = new Map<string, number>();
  for (const task of openTasks ?? []) {
    if (effectiveTaskStatus(task, today) !== "atrasado") continue;
    overdueCountByClient.set(task.client_id, (overdueCountByClient.get(task.client_id) ?? 0) + 1);
  }

  const lastActivityByClient = new Map<string, string>();
  for (const row of lastActivityRows ?? []) {
    if (row.client_id && row.last_activity_at) lastActivityByClient.set(row.client_id, row.last_activity_at);
  }

  const triageClients = (clients ?? []).map((client) => {
    const managerName = client.primary_manager?.name ?? null;
    const monthSpend = monthSpendByClient.get(client.id) ?? 0;

    const currentPeriodSpend = currentPeriodSpendByClient.get(client.id) ?? 0;
    const previousPeriodSpend = previousPeriodSpendByClient.get(client.id) ?? 0;
    const monthSpendDeltaFraction =
      previousPeriodSpend > 0 ? (currentPeriodSpend - previousPeriodSpend) / previousPeriodSpend : null;

    let costAboveTargetFraction: number | null = null;
    let costMetricLabel = "Custo por resultado";
    if (client.performance_goal) {
      costMetricLabel = PERFORMANCE_GOALS[client.performance_goal].costMetricShortLabel;
      const resultCount = resultCountByClient.get(client.id) ?? 0;
      const costPerResult = resultCount > 0 ? monthSpend / resultCount : null;
      if (
        isCostAboveTargetPriority(costPerResult, client.target_cost_per_result, resultCount, MIN_RELIABLE_RESULT_COUNT)
      ) {
        costAboveTargetFraction = computeVariationFromTarget(costPerResult, client.target_cost_per_result);
      }
    }

    const lastReviewAt = latestReviewByClient.get(client.id) ?? null;
    const reviewDaysAgo = lastReviewAt
      ? Math.floor((today.getTime() - new Date(lastReviewAt).getTime()) / 86_400_000)
      : null;

    const lastActivityAt = lastActivityByClient.get(client.id) ?? null;
    const inactivityBusinessDays = lastActivityAt ? businessDaysSince(new Date(lastActivityAt), today) : null;

    return buildOperationTriageClient({
      clientId: client.id,
      clientName: client.name,
      managerName,
      monthSpend,
      signals: {
        costAboveTargetFraction,
        costMetricLabel,
        reviewDaysAgo,
        inactivityBusinessDays,
        overdueTasksCount: overdueCountByClient.get(client.id) ?? 0,
        monthSpendDeltaFraction,
      },
    });
  });

  return sortOperationTriageClients(triageClients);
}
