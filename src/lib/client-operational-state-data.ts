import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "@/lib/performance";
import { sumEffectiveSpendForMonth, type SprintSpendSource, type DailySpendRow } from "@/lib/effective-spend";
import {
  computeMonthlyExpectedPct,
  computeMonthlyExpectedToDateByCalendar,
  resolveMonthlyPlanSnapshot,
  type MonthlyPlanChange,
} from "@/lib/monthly-budget";
import { evaluateAccountHealth, type AccountHealthInput } from "@/lib/account-health-engine";
import { DEFAULT_REVIEW_MAX_BUSINESS_DAYS } from "@/lib/operation-health-thresholds";
import { monthRangeFromOperationParam } from "@/lib/operation-triage";
import { sortClientOperationalStates, type ClientOperationalState } from "@/lib/client-operational-state";
import { evaluateClientDiagnostics } from "@/lib/metric-diagnostics";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Pipeline de dados do domínio `ClientOperationalState` (Etapa "Consolidação
 * da Arquitetura — Fase B") — extraído de `app/operation/operation-triage-data.ts`
 * pra virar neutro (não pertence só à Operação): a Visão Geral (Fase B)
 * também chama esta função agora, reaproveitando exatamente a mesma
 * implementação — nenhuma fórmula duplicada entre as duas telas.
 * `operation-triage-data.ts` mantém seu `loadOperationTriageClients` como um
 * wrapper fino sobre esta função (mesmo comportamento externo de sempre).
 *
 * Resolve tudo (planejamento mensal, realizado, cadência de revisão) e
 * delega a classificação inteira pra `evaluateAccountHealth`
 * (`lib/account-health-engine.ts`); este arquivo nunca decide severidade
 * sozinho. Investimento resolve pela mesma fonte oficial que a página do
 * Cliente usa (`sumEffectiveSpendForMonth`, `lib/effective-spend.ts`).
 */
export async function loadClientOperationalStates(supabase: Supabase, monthParam: string): Promise<ClientOperationalState[]> {
  const today = todayUTC();
  const todayStr = todayDateString();
  const now = new Date();

  const monthRange = monthRangeFromOperationParam(monthParam);
  const { firstDay: monthStart, lastDay: monthEnd } = monthRange;
  const monthExpectedPct = computeMonthlyExpectedPct(monthRange, todayStr);

  const [clients, sprints, dailySpendRows, latestReviews, lastActivityRows, openTasks, planChanges, reviewCadences] =
    await Promise.all([
      requireQuery(
        supabase
          .from("clients")
          .select(
            "id, name, avatar_url, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
          )
          .is("deleted_at", null)
          .order("name"),
        "clients",
      ),
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
      // Fonte real de Atividade (task criada/editada/concluída/comentada,
      // comentário de sprint) — `operational_activities`/view agregada já
      // existiam (Etapa 15) pra outro propósito; aqui viram, junto com
      // `account_reviews` acima, os dois insumos legítimos de "alguém agiu
      // nesta conta", nunca um valor fabricado.
      requireQuery(
        supabase.from("client_last_operational_activity").select("client_id, last_activity_at"),
        "client_last_operational_activity",
      ),
      requireQuery(
        supabase
          .from("tasks")
          .select("client_id, status, due_date")
          .in("status", ["pendente", "atrasado"]),
        "tasks",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("client_id, month, changed_at, new_amount, target_result_count, target_cost_per_result")
          .lte("month", monthRange.firstDay),
        "monthly_budget_changes:plan-history",
      ),
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

  const lastTaskActivityByClient = new Map<string, string>();
  for (const row of lastActivityRows ?? []) {
    if (row.client_id && row.last_activity_at) lastTaskActivityByClient.set(row.client_id, row.last_activity_at);
  }

  const overdueCountByClient = new Map<string, number>();
  // Etapa "Novo Conceito de Monitoramento Operacional": Pendências conta
  // qualquer tarefa ABERTA (pendente OU atrasada), não só a atrasada — a
  // query já filtra pra `status in ('pendente', 'atrasado')`, então basta
  // contar cada linha, sem o filtro extra de `effectiveTaskStatus` (esse
  // continua existindo só pra `overdueCountByClient`, usado por telas que
  // ainda não migraram pro novo motor de diagnóstico).
  const openCountByClient = new Map<string, number>();
  for (const task of openTasks ?? []) {
    openCountByClient.set(task.client_id, (openCountByClient.get(task.client_id) ?? 0) + 1);
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

  const cards: ClientOperationalState[] = (clients ?? []).map((client) => {
    const managerId = client.primary_manager?.id ?? null;
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
        : null
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

    // Etapa "Novo Conceito de Monitoramento Operacional": mesmos números
    // já resolvidos acima (spend/plan/costActual), só reempacotados pro
    // Motor de Diagnóstico Único em vez do Motor de Saúde de 5 dimensões.
    // `expectedToDate` só é calculável quando existe planejamento mensal
    // (`plan.investmentPlanned`) — sem plano, o eixo Investimento fica sem
    // base de comparação (`expected: null`), nunca um "0 esperado"
    // fabricado.
    const investmentExpectedToDate =
      plan.investmentPlanned !== null
        ? computeMonthlyExpectedToDateByCalendar(plan.investmentPlanned, monthRange, todayStr).expectedToDate
        : null;

    // Atividade: "alguém agiu nesta conta" — o mais recente entre uma
    // otimização (`account_reviews`, placeholder até a estrutura real de
    // Otimizações existir) e qualquer atividade operacional real já
    // logada (`client_last_operational_activity`: tarefa criada/editada/
    // concluída/comentada, comentário de sprint). Nunca um só dos dois:
    // uma conta pode estar sendo bem cuidada só com tarefas em dia, sem
    // nenhuma otimização registrada ainda, e vice-versa.
    const lastTaskActivityAt = lastTaskActivityByClient.get(client.id) ?? null;
    const lastActivityAt =
      !lastReviewAt || !lastTaskActivityAt
        ? (lastReviewAt ?? lastTaskActivityAt)
        : new Date(lastReviewAt).getTime() >= new Date(lastTaskActivityAt).getTime()
          ? lastReviewAt
          : lastTaskActivityAt;
    const hoursSinceLastActivity = lastActivityAt ? (now.getTime() - new Date(lastActivityAt).getTime()) / 3_600_000 : null;

    const diagnostics = evaluateClientDiagnostics({
      cpa: { costPerResult: costActual, targetCostPerResult: plan.targetCostPerResult },
      investment: { actualSpend: spend.actual, expectedToDate: investmentExpectedToDate },
      pendencias: { openTasksCount: openCountByClient.get(client.id) ?? 0 },
      atividade: { lastActivityAt, hoursSinceLastActivity },
    });

    const lastDataSyncAt =
      spend.lastUpdatedAt && performanceResult.latestUpdatedAt
        ? spend.lastUpdatedAt > performanceResult.latestUpdatedAt
          ? spend.lastUpdatedAt
          : performanceResult.latestUpdatedAt
        : (spend.lastUpdatedAt ?? performanceResult.latestUpdatedAt ?? null);

    return {
      clientId: client.id,
      clientName: client.name,
      managerId,
      managerName,
      avatarUrl: client.avatar_url,
      performanceGoal: client.performance_goal,
      evaluation: evaluateAccountHealth(input),
      overdueTasksCount: overdueCountByClient.get(client.id) ?? 0,
      openTasksCount: openCountByClient.get(client.id) ?? 0,
      lastDataSyncAt,
      diagnostics,
    };
  });

  return sortClientOperationalStates(cards);
}
