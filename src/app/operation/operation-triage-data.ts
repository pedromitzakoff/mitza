import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "@/lib/performance";
import { sumEffectiveSpendForMonth, type SprintSpendSource, type DailySpendRow } from "@/lib/effective-spend";
import {
  computeMonthlyExpectedPct,
  resolveMonthlyPlanSnapshot,
  type MonthlyPlanChange,
} from "@/lib/monthly-budget";
import { evaluateAccountHealth, type AccountHealthInput } from "@/lib/account-health-engine";
import { DEFAULT_REVIEW_MAX_BUSINESS_DAYS } from "@/lib/operation-health-thresholds";
import { monthRangeFromOperationParam, sortOperationClientCards, type OperationClientCard } from "@/lib/operation-triage";

/**
 * Pipeline de dados PRÓPRIO da Operação — nenhuma query aqui importa de
 * `app/operation/operation-data.ts` (motor da Sprint, usado por Visão
 * Geral/Clientes/Relatórios), `app/sprints/` ou `lib/sprint-financials.ts`.
 * Se este arquivo mudar, nada fora da Operação é afetado.
 *
 * Etapa "Single Source of Truth — investimento": investimento e resultado
 * agora resolvem pela MESMA fonte oficial que a página do Cliente usa —
 * `sprints` (via `sumEffectiveSpendForMonth`, `lib/effective-spend.ts` —
 * módulo de domínio NEUTRO, nem da Sprint nem da Operação, a única
 * implementação da fórmula manual×meta_api/sobreposição de mês em toda a
 * plataforma) e `performance_records` por `sprint_id` (não mais por
 * `client_id`+sobreposição de datas, que ignorava o gasto manual e
 * dependia de campos redundantes). A Operação consulta a tabela `sprints`
 * diretamente — permitido: independência da Operação é não depender da
 * INTERFACE/divisão visual das Sprints, nunca ignorar onde o dado oficial
 * mora.
 *
 * Resolve tudo (planejamento mensal, realizado, cadência de revisão) e
 * delega a classificação inteira pra `evaluateAccountHealth`
 * (`lib/account-health-engine.ts`); este arquivo nunca decide severidade
 * sozinho.
 */

export async function loadOperationTriageClients(monthParam: string): Promise<OperationClientCard[]> {
  const supabase = await createSupabaseClient();
  const today = todayUTC();
  const todayStr = todayDateString();

  const monthRange = monthRangeFromOperationParam(monthParam);
  const { firstDay: monthStart, lastDay: monthEnd } = monthRange;
  const monthExpectedPct = computeMonthlyExpectedPct(monthRange, todayStr);

  const [clients, sprints, dailySpendRows, latestReviews, openTasks, planChanges, reviewCadences] =
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
      // Sprints que se sobrepõem ao mês, de TODOS os clientes (mesma
      // condição de sobreposição usada pela página do Cliente:
      // `start_date <= lastDay && end_date >= firstDay`) — fonte oficial
      // de investimento (`spend_source`/`manual_actual_spend`) e a ponte
      // pra `performance_records` via `sprint_id`.
      requireQuery(
        supabase
          .from("sprints")
          .select("id, client_id, start_date, end_date, spend_source, manual_actual_spend, manual_spend_updated_at")
          .lte("start_date", monthEnd)
          .gte("end_date", monthStart),
        "sprints",
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

  const sprintsByClient = new Map<string, typeof sprints>();
  const sprintIdToClientId = new Map<string, string>();
  for (const sprint of sprints) {
    const list = sprintsByClient.get(sprint.client_id) ?? [];
    list.push(sprint);
    sprintsByClient.set(sprint.client_id, list);
    sprintIdToClientId.set(sprint.id, sprint.client_id);
  }
  const allSprintIds = sprints.map((s) => s.id);

  const dailySpendByClient = new Map<string, { date: string; spend: number; synced_at: string }[]>();
  for (const row of dailySpendRows) {
    const list = dailySpendByClient.get(row.client_id) ?? [];
    list.push(row);
    dailySpendByClient.set(row.client_id, list);
  }

  // performance_records por sprint_id — mesmo caminho que a página do
  // Cliente usa (nunca client_id + sobreposição de datas, que dependia de
  // period_start/period_end ficarem sempre consistentes com a sprint).
  const performanceRows =
    allSprintIds.length > 0
      ? await requireQuery(
          supabase
            .from("performance_records")
            .select("sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", allSprintIds),
          "performance_records",
        )
      : [];

  const performanceRowsByClient = new Map<string, PerformanceRecordRow[]>();
  for (const row of performanceRows) {
    if (!row.sprint_id) continue;
    const clientId = sprintIdToClientId.get(row.sprint_id);
    if (!clientId) continue;
    const list = performanceRowsByClient.get(clientId) ?? [];
    list.push({
      channel: row.channel,
      resultType: row.result_type,
      resultCount: row.result_count,
      source: row.source,
      sourceUpdatedAt: row.source_updated_at,
    });
    performanceRowsByClient.set(clientId, list);
  }

  const latestReviewByClient = new Map<string, string>();
  for (const row of latestReviews ?? []) {
    if (!latestReviewByClient.has(row.client_id)) latestReviewByClient.set(row.client_id, row.reviewed_at);
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

    const clientSprints: SprintSpendSource[] = (sprintsByClient.get(client.id) ?? []).map((sprint) => ({
      startDate: sprint.start_date,
      endDate: sprint.end_date,
      spendSource: sprint.spend_source,
      manualActualSpend: sprint.manual_actual_spend,
      manualSpendUpdatedAt: sprint.manual_spend_updated_at,
    }));
    const clientDailySpend: DailySpendRow[] = (dailySpendByClient.get(client.id) ?? []).map((row) => ({
      date: row.date,
      spend: row.spend,
      syncedAt: row.synced_at,
    }));
    const spend = sumEffectiveSpendForMonth(clientSprints, monthRange, clientDailySpend);

    const performanceResult = client.performance_goal
      ? aggregatePerformanceResults(performanceRowsByClient.get(client.id) ?? [], client.performance_goal)
      : { resultCount: 0, hasAnyRecord: false, latestSource: null, latestUpdatedAt: null };

    // `spend.hasData` vira `null` explícito (não `0`) pra `computeCostPerResult`
    // nunca confundir "sem investimento confiável" com "investiu R$0" —
    // mesma régua de ausência usada no resto da plataforma.
    const costActual = computeCostPerResult(
      spend.hasData ? spend.actual : null,
      performanceResult.resultCount,
      performanceResult.hasAnyRecord,
    );

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
      investmentActual: spend.actual,
      investmentPlanned: plan.investmentPlanned,
      investmentHasSyncedData: spend.hasData,
      resultActual: performanceResult.resultCount,
      resultPlanned: plan.targetResultCount,
      hasPerformanceData: performanceResult.hasAnyRecord,
      performanceGoalConfigured: client.performance_goal !== null,
      costActual,
      costPlanned: plan.targetCostPerResult,
      monthExpectedPct,
      reviewBusinessDaysAgo,
      reviewMaxBusinessDays,
    };

    const lastDataSyncAt =
      spend.lastUpdatedAt && performanceResult.latestUpdatedAt
        ? spend.lastUpdatedAt > performanceResult.latestUpdatedAt
          ? spend.lastUpdatedAt
          : performanceResult.latestUpdatedAt
        : (spend.lastUpdatedAt ?? performanceResult.latestUpdatedAt ?? null);

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
      lastDataSyncAt,
    };
  });

  return sortOperationClientCards(cards);
}
