import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";
import { computeCostPerResult } from "@/lib/performance";
import {
  computeMonthlyExpectedPct,
  resolveMonthlyPlanSnapshot,
  type MonthlyPlanChange,
} from "@/lib/monthly-budget";
import { evaluateAccountHealth, type AccountHealthInput } from "@/lib/account-health-engine";
import { DEFAULT_REVIEW_MAX_BUSINESS_DAYS } from "@/lib/operation-health-thresholds";
import { monthRangeFromOperationParam, sortOperationClientCards, type OperationClientCard } from "@/lib/operation-triage";

/**
 * Pipeline de dados PRÓPRIO da Operação — nenhuma query aqui é
 * compartilhada com `app/operation/operation-data.ts` (motor da Sprint,
 * usado por Visão Geral/Clientes/Relatórios) nem com `app/sprints/`. Se
 * este arquivo mudar, nada fora da Operação é afetado; se a Sprint for
 * removida, nada aqui quebra.
 *
 * Etapa "Redesenho da Operação" (PR 2): resolve tudo (planejamento
 * mensal, realizado, cadência de revisão) e delega a classificação
 * inteira pra `evaluateAccountHealth` (`lib/account-health-engine.ts`);
 * este arquivo nunca decide severidade sozinho. Diferente do PR 1, o
 * `AccountHealthEvaluation` inteiro segue pra frente (`OperationClientCard.
 * evaluation`) — a tela consome a estrutura completa (dimensões, motivo
 * principal, dimensão principal) pra montar os termômetros e os filtros,
 * nunca reimplementando nada que o motor já decidiu.
 */

export async function loadOperationTriageClients(monthParam: string): Promise<OperationClientCard[]> {
  const supabase = await createSupabaseClient();
  const today = todayUTC();
  const todayStr = todayDateString();

  const monthRange = monthRangeFromOperationParam(monthParam);
  const { firstDay: monthStart, lastDay: monthEnd } = monthRange;
  const monthExpectedPct = computeMonthlyExpectedPct(monthRange, todayStr);

  const [clients, dailySpendRows, latestReviews, performanceRows, openTasks, planChanges, reviewCadences] =
    await Promise.all([
      requireQuery(
        supabase
          .from("clients")
          .select(
            "id, name, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(name)",
          )
          .is("deleted_at", null)
          .order("name"),
        "clients",
      ),
      requireQuery(
        supabase
          .from("daily_spend")
          .select("client_id, date, spend, synced_at")
          .gte("date", monthStart)
          .lte("date", monthEnd),
        "daily_spend",
      ),
      requireQuery(
        supabase.from("account_reviews").select("client_id, reviewed_at").order("reviewed_at", { ascending: false }),
        "account_reviews",
      ),
      requireQuery(
        supabase
          .from("performance_records")
          .select("client_id, result_type, result_count, period_start, period_end")
          .lte("period_start", monthEnd)
          .gte("period_end", monthStart),
        "performance_records",
      ),
      requireQuery(
        supabase
          .from("tasks")
          .select("client_id, status, due_date")
          .in("status", ["pendente", "atrasado"]),
        "tasks",
      ),
      // Planejamento mensal vigente (investimento + as duas metas de
      // performance) — mesmo padrão de `page.tsx`/`clients/[id]/page.tsx`:
      // `.lte("month", ...)`, resolvido por cliente com
      // `resolveMonthlyPlanSnapshot` (a versão vigente do mês selecionado
      // pode ter sido definida num mês anterior).
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("client_id, month, changed_at, new_amount, target_result_count, target_cost_per_result")
          .lte("month", monthRange.firstDay),
        "monthly_budget_changes:plan-history",
      ),
      // Cadência de revisão configurada por cliente — cliente sem linha
      // aqui usa `DEFAULT_REVIEW_MAX_BUSINESS_DAYS` como fallback.
      requireQuery(
        supabase.from("account_review_cadences").select("client_id, max_business_days_without_review, is_active"),
        "account_review_cadences",
      ),
    ]);

  const monthSpendByClient = new Map<string, number>();
  const hasSyncedDataByClient = new Set<string>();
  const lastSyncedAtByClient = new Map<string, string>();
  for (const row of dailySpendRows) {
    monthSpendByClient.set(row.client_id, (monthSpendByClient.get(row.client_id) ?? 0) + row.spend);
    hasSyncedDataByClient.add(row.client_id);
    const previousLatest = lastSyncedAtByClient.get(row.client_id);
    if (!previousLatest || row.synced_at > previousLatest) {
      lastSyncedAtByClient.set(row.client_id, row.synced_at);
    }
  }

  const latestReviewByClient = new Map<string, string>();
  for (const row of latestReviews ?? []) {
    if (!latestReviewByClient.has(row.client_id)) latestReviewByClient.set(row.client_id, row.reviewed_at);
  }

  // Cada linha de resultado só conta se bater com o `performance_goal` do
  // próprio cliente — nunca soma leads e vendas juntos.
  const performanceGoalByClient = new Map((clients ?? []).map((client) => [client.id, client.performance_goal]));
  const resultCountByClient = new Map<string, number>();
  const hasPerformanceDataByClient = new Set<string>();
  for (const row of performanceRows ?? []) {
    if (row.result_type !== performanceGoalByClient.get(row.client_id)) continue;
    resultCountByClient.set(row.client_id, (resultCountByClient.get(row.client_id) ?? 0) + row.result_count);
    hasPerformanceDataByClient.add(row.client_id);
  }

  const overdueCountByClient = new Map<string, number>();
  for (const task of openTasks ?? []) {
    if (effectiveTaskStatus(task, today) !== "atrasado") continue;
    overdueCountByClient.set(task.client_id, (overdueCountByClient.get(task.client_id) ?? 0) + 1);
  }

  const planChangesByClient = new Map<string, MonthlyPlanChange[]>();
  for (const row of planChanges ?? []) {
    const list = planChangesByClient.get(row.client_id) ?? [];
    list.push({
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
      targetCostPerResult: row.target_cost_per_result,
    });
    planChangesByClient.set(row.client_id, list);
  }

  const reviewCadenceByClient = new Map((reviewCadences ?? []).map((row) => [row.client_id, row]));

  const cards: OperationClientCard[] = (clients ?? []).map((client) => {
    const managerName = client.primary_manager?.name ?? null;
    const monthSpend = monthSpendByClient.get(client.id) ?? 0;

    const resultCount = resultCountByClient.get(client.id) ?? 0;
    const hasPerformanceData = hasPerformanceDataByClient.has(client.id);
    const costActual = computeCostPerResult(monthSpend, resultCount, hasPerformanceData);

    const plan = resolveMonthlyPlanSnapshot(
      planChangesByClient.get(client.id) ?? [],
      monthRange.firstDay,
      client.target_cost_per_result,
    );

    const lastReviewAt = latestReviewByClient.get(client.id) ?? null;
    const reviewBusinessDaysAgo = lastReviewAt ? businessDaysSince(new Date(lastReviewAt), today) : null;

    const cadence = reviewCadenceByClient.get(client.id);
    const reviewMaxBusinessDays = cadence
      ? cadence.is_active
        ? cadence.max_business_days_without_review
        : null // cadência desativada — dimensão de revisão não avaliada
      : DEFAULT_REVIEW_MAX_BUSINESS_DAYS;

    const input: AccountHealthInput = {
      investmentActual: monthSpend,
      investmentPlanned: plan.investmentPlanned,
      investmentHasSyncedData: hasSyncedDataByClient.has(client.id),
      resultActual: resultCount,
      resultPlanned: plan.targetResultCount,
      hasPerformanceData,
      performanceGoalConfigured: client.performance_goal !== null,
      costActual,
      costPlanned: plan.targetCostPerResult,
      monthExpectedPct,
      reviewBusinessDaysAgo,
      reviewMaxBusinessDays,
    };

    return {
      clientId: client.id,
      clientName: client.name,
      managerName,
      // Sem infraestrutura de avatar ainda (PR 3, exclusivo pra isso) — a
      // Operação já consome `ClientAvatar`/`avatarUrl` no contrato, mas
      // sempre `null` até o upload existir; nenhuma mudança no componente
      // será necessária quando o PR 3 começar a preencher isto de verdade.
      avatarUrl: null,
      performanceGoal: client.performance_goal,
      evaluation: evaluateAccountHealth(input),
      overdueTasksCount: overdueCountByClient.get(client.id) ?? 0,
      lastDataSyncAt: lastSyncedAtByClient.get(client.id) ?? null,
    };
  });

  return sortOperationClientCards(cards);
}
