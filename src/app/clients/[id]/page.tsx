import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  assertSingleCurrentSprint,
  computeSprintEffectiveSpend,
  computeSprintFinancials,
  currentMonthRange,
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { classifySpendStatus } from "@/lib/spend-status";
import { computeNextAction } from "@/lib/next-action";
import { buildSprintExecutionAlert, formatSprintExecutionLabel } from "@/lib/sprint-execution";
import {
  resolveBudgetEffectiveDate,
  resolveMonthlyBudget,
  resolveMonthlyPerformanceTargets,
  computeMonthlyExpectedToDateByCalendar,
} from "@/lib/monthly-budget";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel, formatRelationshipDuration } from "@/lib/format";
import { computeOperationalTracking, computeMonthlyOccurrenceSummary } from "@/lib/operational-tracking";
import { fetchClientOperationalHistory } from "@/lib/client-operational-history";
import { computeClientUpdateStatus } from "@/lib/client-updates";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import { syncClientMetaAction } from "../meta-actions";
import { ClientIdentitySticky } from "../client-identity-sticky";
import { MonthInvestmentSummary } from "../month-investment-summary";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import { AccountFollowUpPanel, type LastOptimizationInfo } from "../account-follow-up-panel";
import { ClientOperationalHistoryDrawer } from "../client-operational-history-drawer";
import { ScheduleOccurrenceDrawer } from "../schedule-occurrence-drawer";
import { EssentialInfoPanel } from "../essential-info-panel";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";
import type { AccountReviewSummaryItem } from "../account-reviews-section";
import { RecordAccountReviewDrawer } from "../record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "../account-review-detail-drawer";
import { generateClientUpdateAction } from "../client-update-actions";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationTaskItem, PerformanceRecordRawRow } from "@/app/operation/operation-data";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { MonthlyBudgetHistoryDrawer } from "../monthly-budget-history-drawer";
import {
  aggregatePerformanceResults,
  buildEditableChannelValues,
  buildSprintPerformanceView,
  computePerformanceSummary,
} from "@/lib/performance";
import { AVAILABLE_TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { PerformanceSummarySection } from "../performance-summary";
import type { SprintPerformanceProps } from "../sprint-card";
import { SprintFocusBar } from "../sprint-focus-bar";

function groupAccountReviewsBySprintId(
  reviews: (AccountReviewSummaryItem & { sprintId: string })[],
): Map<string, AccountReviewSummaryItem[]> {
  const map = new Map<string, AccountReviewSummaryItem[]>();
  for (const { sprintId, ...review } of reviews) {
    const list = map.get(sprintId) ?? [];
    list.push(review);
    map.set(sprintId, list);
  }
  return map;
}

async function fetchCommentsByType(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  type: "sprint" | "task",
  ids: string[],
): Promise<CommentItem[]> {
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("comments")
    .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
    .eq("commentable_type", type)
    .in("commentable_id", ids)
    .order("created_at");

  return data ?? [];
}

function groupByCommentableId(comments: CommentItem[]): Map<string, CommentItem[]> {
  const map = new Map<string, CommentItem[]>();
  for (const comment of comments) {
    const list = map.get(comment.commentable_id) ?? [];
    list.push(comment);
    map.set(comment.commentable_id, list);
  }
  return map;
}

/** Anexa `?param` (ou `&param` se a URL já tiver query string) — necessário
 * a partir da Etapa 62 porque `returnTo` agora pode já carregar `?month=...`
 * (contexto temporal da página inteira), então nenhum href pode mais
 * simplesmente concatenar "?" sem checar. */
function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

function groupBySprintId(
  tasks: (TaskListItem & { sprint_id: string | null })[],
): { bySprintId: Map<string, TaskListItem[]>; unlinked: TaskListItem[] } {
  const bySprintId = new Map<string, TaskListItem[]>();
  const unlinked: TaskListItem[] = [];

  for (const { sprint_id, ...task } of tasks) {
    if (!sprint_id) {
      unlinked.push(task);
      continue;
    }
    const list = bySprintId.get(sprint_id) ?? [];
    list.push(task);
    bySprintId.set(sprint_id, list);
  }

  return { bySprintId, unlinked };
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    synced?: string;
    saved?: string;
    taskError?: string;
    task?: string;
    historicoOrcamento?: string;
    review?: string;
    reviewDetail?: string;
    reviewError?: string;
    reviewsHistory?: string;
    reviewSaved?: string;
    clientUpdateError?: string;
    month?: string;
    scheduleOccurrence?: string;
    scheduleTaskId?: string;
    historyPage?: string;
  }>;
}) {
  const { id } = await params;
  const {
    error,
    synced,
    saved,
    taskError,
    task: openTaskId,
    historicoOrcamento,
    review: openReview,
    reviewDetail: openReviewDetailId,
    reviewError,
    reviewsHistory,
    reviewSaved,
    clientUpdateError,
    month: monthQueryParam,
    scheduleOccurrence,
    scheduleTaskId,
    historyPage: historyPageParam,
  } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, contract_start_date, primary_manager:team_members!clients_primary_manager_id_fkey(name), main_objective, main_product_or_service, operation_region, primary_audience, client_differentials, client_restrictions, important_seasonal_dates, operational_summary, important_notes, performance_goal, target_cost_per_result",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!client) notFound();

  // Etapa 53: "hoje" tinha que ser SEMPRE todayUTC() (meia-noite UTC do dia
  // civil no fuso America/Sao_Paulo) — usar `new Date()` puro aqui fazia a
  // sprint atual virar errada bem à noite no Brasil (21h–23h59), quando o
  // relógio UTC real já tinha virado o dia seguinte mas em São Paulo ainda
  // era o dia anterior.
  const today = todayUTC();
  const todayStr = todayDateString();
  // Etapa 62 — contexto temporal global da página: `?month=YYYY-MM` decide
  // o período de TUDO que é temporal (sprints, investimento, tarefas do
  // período, análises/otimizações/reuniões/entregas do Acompanhamento da
  // Conta) — reaproveita exatamente os mesmos helpers já usados por
  // Relatórios/Visão Geral/Sprints (`monthRangeFromParam`/`shiftMonthParam`),
  // nenhum parsing de mês novo. Informações cadastrais do cliente (nome,
  // status contratual, tempo de relacionamento, dados estruturais no fim da
  // página) continuam fora do filtro — não fazem sentido "por mês".
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;
  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const prevMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, 1)}`;

  // Etapa 50 (correção): a geração de sprints não roda mais durante o
  // carregamento da página — só via /api/cron/ensure-sprints.
  const [sprints, dailySpend, lastSync, plannedAllocations, budgetChanges, performanceTargetHistory] =
    await Promise.all([
      // Sobreposição com o mês (não "começa no mês") — uma sprint que
      // atravessa a fronteira (ex.: 27/jul-02/ago) precisa aparecer aqui
      // mesmo com start_date no mês anterior.
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
        supabase.from("daily_spend").select("date, spend").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "daily_spend",
      ),
      requireQuery<{ synced_at: string } | null>(
        supabase
          .from("daily_spend")
          .select("synced_at")
          .eq("client_id", id)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "daily_spend:last-sync",
      ),
      requireQuery(
        supabase
          .from("sprint_planned_allocations")
          .select("sprint_id, date, planned_amount")
          .eq("client_id", id)
          .gte("date", firstDay)
          .lte("date", lastDay),
        "sprint_planned_allocations",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select(
            "id, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
          )
          .eq("client_id", id)
          .eq("month", firstDay)
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:current-month",
      ),
      // Metas do planejamento mensal vigente (Etapa "Planejamento Mensal
      // 1.0") — deliberadamente `.lte` em vez de `.eq`: a versão vigente do
      // mês selecionado pode ter sido definida num mês anterior (ver
      // `resolveMonthlyPerformanceTargets`), diferente da consulta de
      // `budgetChanges` acima (que é só o HISTÓRICO deste mês específico).
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("month, changed_at, target_result_count, target_cost_per_result")
          .eq("client_id", id)
          .lte("month", firstDay)
          .order("month", { ascending: false })
          .order("changed_at", { ascending: false })
          .limit(1),
        "monthly_budget_changes:target-history",
      ),
    ]);

  // Etapa 71: registros de performance de todas as sprints do mês
  // selecionado — sempre por sprint (nenhum lançamento manual mensal
  // independente, ver migration), nunca uma query por sprint.
  const monthSprintIds = sprints.map((s) => s.id);
  const performanceRecordRows =
    monthSprintIds.length > 0
      ? await requireQuery(
          supabase
            .from("performance_records")
            .select("sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", monthSprintIds),
          "performance_records",
        )
      : [];
  const performanceRecords: PerformanceRecordRawRow[] = performanceRecordRows.map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  assertSingleCurrentSprint(sprints, today);
  const sprintFinancials = sprints.map((sprint) => {
    const actualSpend = computeSprintEffectiveSpend(sprint, dailySpend ?? []);
    return computeSprintFinancials(sprint, actualSpend, today, sprint.spend_source);
  });
  // Etapa 65: última edição do gasto manual, por sprint — `SprintFinancials`
  // não carrega esse campo (não é usado por ninguém além do card expandido),
  // então em vez de estender o tipo pros outros consumidores dela, um mapa à
  // parte a partir da própria linha crua já buscada acima.
  const manualSpendUpdatedAtBySprintId = new Map((sprints ?? []).map((s) => [s.id, s.manual_spend_updated_at]));

  // Etapa 70: `sprint_planned_allocations` deixou de alimentar o card da
  // sprint (o "planejamento histórico" virou o "planejamento original"
  // congelado, `sprint-recommendation.ts`) — continua existindo só como
  // fallback de `resolveMonthlyBudget`, abaixo.
  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Etapa 66: orçamento mensal VIGENTE — sempre o valor mais recente
  // configurado (`monthly_budget_changes.new_amount`), nunca a soma dos
  // planejamentos diários persistidos (que diverge do vigente assim que o
  // planejado histórico não bate com o realizado histórico — a regra, não a
  // exceção). `sumPlannedForMonth` só entra como fallback pra cliente que
  // nunca passou pelo editor de orçamento (sem nenhuma linha em
  // monthly_budget_changes ainda).
  const monthPlanned = resolveMonthlyBudget(
    (budgetChanges ?? []).map((c) => ({ newAmount: c.new_amount, changedAt: c.changed_at })),
    sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay }),
  );
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);
  // Etapa 73: a camada de planejamento/recomendação POR SPRINT saiu da
  // interface operacional (fica só no nível mensal) — `computeOriginalSprintPlans`/
  // `monthPlan.sprintPlans` deixaram de alimentar qualquer componente aqui.
  // `ensureClosedSprintSnapshots` continua rodando (preserva o congelamento
  // histórico em `sprints.original_planned_amount`/`final_recommended_amount`
  // pra uma eventual reativação futura), só o valor devolvido não é mais
  // lido por ninguém nesta página.
  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: { firstDay, lastDay },
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: (budgetChanges ?? []).map((c) => ({ newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: monthPlanned,
  });
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente,
  // independente de sprints/planejamentos antigos (mesma função central
  // usada em toda a Visão Geral/Sprints/Relatório — ver operation-data.ts).
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(
    monthPlanned,
    { firstDay, lastDay },
    todayStr,
  ).expectedToDate;
  // Ritmo do mês: realizado x esperado até hoje, nunca x 100% do planejado
  // antes do mês acabar (mesma regra agora usada em toda a Visão Geral/
  // Sprints — ver operation-data.ts).
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);
  const currentSprint = sprintFinancials.find((sprint) => sprint.temporalStatus === "atual") ?? null;
  // Etapa 61: única lista "Sprints de {mês}" (ver render abaixo) — mesma
  // ordem cronológica crescente por data de início já usada em todo o
  // resto do sistema, aqui explícita em vez de depender da ordem da query.
  const sortedSprints = [...sprintFinancials].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Etapa 71 — camada de PERFORMANCE: consome `monthActual`/`sprint.actualSpend`
  // já calculados acima, nunca uma segunda fonte de investimento. Consolidado
  // do mês é sempre a soma direta dos registros já escopados às sprints do
  // mês selecionado (nenhum lançamento manual mensal independente).
  const performanceGoal = client.performance_goal;
  // Etapa "Planejamento Mensal 1.0": meta de custo vigente vem do
  // planejamento mensal (com `clients.target_cost_per_result` como
  // fallback só pra quem nunca teve nenhuma versão de planejamento) —
  // nunca mais lido direto de `clients` sem passar por este resolvedor.
  const resolvedTargets = resolveMonthlyPerformanceTargets(
    (performanceTargetHistory ?? []).map((row) => ({
      month: row.month,
      changedAt: row.changed_at,
      targetResultCount: row.target_result_count,
      targetCostPerResult: row.target_cost_per_result,
    })),
    firstDay,
    client.target_cost_per_result,
  );
  const targetCostPerResult = resolvedTargets.targetCostPerResult;
  const targetResultCount = resolvedTargets.targetResultCount;
  const monthPerformanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult,
      })
    : null;
  const monthPerformanceChannelBreakdown = performanceGoal
    ? AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({
        channel,
        resultCount: aggregatePerformanceResults(performanceRecords, performanceGoal, channel).resultCount,
      })).filter((entry) => entry.resultCount > 0)
    : [];
  const sprintPerformanceBySprintId = new Map<string, SprintPerformanceProps>();
  for (const sprint of sprintFinancials) {
    const sprintRecords = performanceRecords.filter((r) => r.sprintId === sprint.sprintId);
    sprintPerformanceBySprintId.set(sprint.sprintId, {
      view: buildSprintPerformanceView({
        performanceGoal,
        isFuture: sprint.temporalStatus === "futura",
        records: sprintRecords,
        actualSpend: sprint.actualSpend,
        targetCostPerResult,
      }),
      editableChannels: performanceGoal ? buildEditableChannelValues(sprintRecords, performanceGoal, AVAILABLE_TRAFFIC_CHANNELS) : [],
      performanceGoal,
    });
  }

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate({ firstDay, lastDay }, todayStr);
  // Etapa 64: mês selecionado ainda não começou — usado só pra escolher o
  // texto da seção "Investimento do mês" (nunca uma segunda comparação de
  // datas: "não é o mês corrente" + "não está encerrado" já implica futuro,
  // dado que todo mês é ou passado, ou corrente, ou futuro).
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  // `budgetSprints` alimenta só `MonthInvestmentSummary` agora (Etapa 73) —
  // esta página não computa mais `computeMonthlyBudgetPlan` por conta própria
  // pra derivar planejamento por sprint; o componente mensal já calcula seu
  // próprio plano internamente a partir dos valores brutos recebidos.
  const budgetSprints = sprintFinancials.map((sprint) => ({
    sprintId: sprint.sprintId,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  }));
  const lastBudgetChange = budgetChanges[0] ?? null;
  const lastChange = lastBudgetChange
    ? {
        lastEffectiveDate: lastBudgetChange.effective_date,
        lastPreviousAmount: lastBudgetChange.previous_amount,
        lastNewAmount: lastBudgetChange.new_amount,
        changeCountThisMonth: budgetChanges.length,
      }
    : null;

  const sprintActivity = currentSprint
    ? await requireQuery<{ last_activity_at: string | null } | null>(
        supabase
          .from("sprint_last_operational_activity")
          .select("last_activity_at")
          .eq("sprint_id", currentSprint.sprintId)
          .maybeSingle(),
        "sprint_last_operational_activity",
      )
    : null;

  const tasks = await requireQuery(
    supabase
      .from("tasks")
      .select(
        "id, title, type, due_date, due_time, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
      )
      .eq("client_id", id)
      .order("due_date"),
    "tasks",
  );

  // Etapa 62: a janela fixa de 60 dias (Etapa 57) foi substituída por uma
  // busca sem filtro de data (as últimas 200 análises do cliente — teto
  // generoso, nunca deveria ser atingido na prática) porque agora o mesmo
  // conjunto precisa responder a DUAS perguntas diferentes: "qual a última
  // análise/otimização de verdade" (mês atual — pode estar em qualquer mês
  // passado) e "quais análises/otimizações aconteceram DENTRO do mês
  // selecionado" (mês anterior, Etapa 8) — uma janela fixa de 60 dias
  // quebraria a segunda pergunta pra qualquer mês mais antigo que isso.
  const [accountReviewRows, managers, clientUpdateRows] = await Promise.all([
    requireQuery(
      supabase
        .from("account_reviews")
        .select(
          "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
        )
        .eq("client_id", id)
        .order("reviewed_at", { ascending: false })
        .limit(200),
      "account_reviews",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Etapa 59 — Atualização para o Cliente: uma linha por análise (no
    // máximo), buscada junto com o resto da página; nenhuma query separada
    // por análise (nem pro indicador discreto nem pro conteúdo do drawer).
    requireQuery(
      supabase
        .from("client_updates")
        .select(
          "id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)",
        )
        .eq("client_id", id),
      "client_updates",
    ),
  ]);

  const clientUpdatesByReviewId = new Map(clientUpdateRows.map((row) => [row.account_review_id, row]));

  const accountReviews = accountReviewRows;
  const accountReviewSummaries = accountReviews.map((review) => {
    const update = clientUpdatesByReviewId.get(review.id) ?? null;
    return {
      id: review.id,
      sprintId: review.sprint_id,
      reviewedAt: review.reviewed_at,
      reason: review.reason,
      reasonOtherDescription: review.reason_other_description,
      outcome: review.outcome,
      managerName: review.team_member?.name ?? "Membro removido",
      optimizationCount: review.optimizations.length,
      issueDescription: review.issue_description,
      updateStatus: computeClientUpdateStatus(
        update ? { copiedAt: update.copied_at, sentAt: update.sent_at } : null,
      ),
    };
  });
  const accountReviewsBySprintId = groupAccountReviewsBySprintId(accountReviewSummaries);

  // Etapa 74 — "Última otimização": no mês atual é sempre o dado GLOBAL mais
  // recente (accountReviews já vem ordenado desc, então é só o primeiro
  // item); num mês anterior, é o mais recente DENTRO do mês selecionado.
  // Um único indicador pra qualquer resultado da revisão (alteração
  // realizada, sem alteração necessária, ou problema identificado) — nunca
  // dois indicadores separados pro mesmo evento.
  const reviewsInMonth = accountReviews.filter(
    (r) => r.reviewed_at >= `${firstDay}T00:00:00Z` && r.reviewed_at <= `${lastDay}T23:59:59.999Z`,
  );
  const reviewsForLastLookup = isCurrentMonth ? accountReviews : reviewsInMonth;

  const lastOptimizationSource = reviewsForLastLookup[0] ?? null;
  const lastOptimization: LastOptimizationInfo | null = lastOptimizationSource
    ? {
        reviewedAt: lastOptimizationSource.reviewed_at,
        managerName: lastOptimizationSource.team_member?.name ?? "Membro removido",
        outcome: lastOptimizationSource.outcome,
        optimizationTypes: lastOptimizationSource.optimizations.map((o) => o.optimization_type),
        issueDescription: lastOptimizationSource.issue_description,
      }
    : null;

  const [sprintComments, taskComments] = await Promise.all([
    fetchCommentsByType(
      supabase,
      "sprint",
      sprintFinancials.map((sprint) => sprint.sprintId),
    ),
    fetchCommentsByType(
      supabase,
      "task",
      (tasks ?? []).map((task) => task.id),
    ),
  ]);

  const sprintCommentsById = groupByCommentableId(sprintComments);
  const taskCommentsById = groupByCommentableId(taskComments);
  const { bySprintId: tasksBySprintId, unlinked: unlinkedTasksAllTime } = groupBySprintId(tasks ?? []);
  // Etapa 62, seção 6: "tarefas do período" respeitam o mês selecionado —
  // as vinculadas a uma sprint já ficam implicitamente restritas (cada
  // sprint só aparece se pertencer ao mês selecionado); só a lista solta
  // (sem sprint) precisava do filtro explícito aqui.
  const unlinkedTasks = unlinkedTasksAllTime.filter((task) => task.due_date >= firstDay && task.due_date <= lastDay);
  // "Próxima reunião/entrega" (Etapa 7) precisa olhar TODAS as tarefas do
  // cliente, não só as do mês selecionado — a próxima ocorrência pode estar
  // num mês futuro diferente do que está sendo visualizado.
  const operationalTracking = computeOperationalTracking(tasks ?? [], today);
  // "Reuniões/entregas de {mês}" (Etapa 8) já nasce escopado ao mês.
  const monthlyOccurrenceSummary = computeMonthlyOccurrenceSummary(tasks ?? [], { firstDay, lastDay }, today);

  // Etapa 62, seção 9 — histórico unificado do mês (análises + otimizações
  // + reuniões/entregas com desfecho), reaproveitando 100% operational_events
  // (ver lib/client-operational-history.ts). O card mostra só as 5 mais
  // recentes; "Ver todos de {mês}" abre a mesma consulta paginada (15 por
  // página, mesmo padrão de `fetchTeamMemberTimeline`).
  const historyPage = Math.max(0, Number(historyPageParam) || 0);
  const [{ rows: recentHistoryRows, hasMore: hasMoreHistory }, fullHistory] = await Promise.all([
    fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, 0, 5),
    reviewsHistory
      ? fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, historyPage)
      : Promise.resolve({ rows: [], hasMore: false }),
  ]);

  const sprintLastActivityDate = sprintActivity?.last_activity_at
    ? new Date(sprintActivity.last_activity_at)
    : null;
  const sprintExecutionAlert = currentSprint
    ? buildSprintExecutionAlert(currentSprint, sprintLastActivityDate, today)
    : null;
  const sprintExecutionLabel = currentSprint
    ? formatSprintExecutionLabel(sprintLastActivityDate, currentSprint.startDate, today)
    : null;

  const banners = [
    error && { tone: "red", text: error },
    taskError && { tone: "red", text: taskError },
    reviewError && { tone: "red", text: reviewError },
    clientUpdateError && { tone: "red", text: clientUpdateError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green"; text: string } => Boolean(banner));

  const returnTo = `/clients/${client.id}${monthQuery}`;
  const openReviewDetail = openReviewDetailId ? accountReviews.find((r) => r.id === openReviewDetailId) ?? null : null;
  const reviewDetail: AccountReviewDetail | null = openReviewDetail
    ? {
        id: openReviewDetail.id,
        reviewedAt: openReviewDetail.reviewed_at,
        managerName: openReviewDetail.team_member?.name ?? "Membro removido",
        reason: openReviewDetail.reason,
        reasonOtherDescription: openReviewDetail.reason_other_description,
        outcome: openReviewDetail.outcome,
        notes: openReviewDetail.notes,
        issueDescription: openReviewDetail.issue_description,
        issueCategory: openReviewDetail.issue_category,
        issueTaskTitle: openReviewDetail.issue_task?.title ?? null,
        secondsSincePreviousReview: openReviewDetail.seconds_since_previous_review,
        optimizations: openReviewDetail.optimizations.map((opt) => ({
          id: opt.id,
          type: opt.optimization_type,
          action: opt.optimization_action,
          description: opt.description,
          reason: opt.reason,
          expectedImpact: opt.expected_impact,
        })),
        clientUpdate: (() => {
          const update = clientUpdatesByReviewId.get(openReviewDetail.id);
          return update
            ? {
                id: update.id,
                content: update.content,
                sentAt: update.sent_at,
                sentByName: update.sent_by_profile?.name ?? null,
              }
            : null;
        })(),
      }
    : null;
  const historyDrawerHref = withParam(returnTo, "historicoOrcamento=1");
  const historyDrawerCloseHref = returnTo;
  const reviewsHistoryHref = withParam(returnTo, "reviewsHistory=1");
  const buildHistoryPageHref = (page: number) => withParam(withParam(returnTo, "reviewsHistory=1"), `historyPage=${page}`);
  const buildReviewDetailHref = (reviewId: string) => withParam(returnTo, `reviewDetail=${reviewId}`);
  const openTaskRow = openTaskId ? (tasks ?? []).find((t) => t.id === openTaskId) ?? null : null;
  const openTask: OperationTaskItem | null = openTaskRow
    ? {
        id: openTaskRow.id,
        title: openTaskRow.title,
        type: openTaskRow.type,
        due_date: openTaskRow.due_date,
        status: openTaskRow.status,
        assignee: openTaskRow.assignee,
        sprint_id: openTaskRow.sprint_id,
        notes: openTaskRow.notes,
      }
    : null;
  const openTaskSprint = openTaskRow?.sprint_id
    ? (sprintFinancials.find((s) => s.sprintId === openTaskRow.sprint_id) ?? null)
    : null;
  const openTaskSprintPeriodLabel = openTaskSprint
    ? formatSprintPeriodLabel(openTaskSprint.startDate, openTaskSprint.endDate)
    : null;

  // "Foco agora" (Etapa "MITZA Operational Workspace 1.0") — mesma
  // `computeNextAction` que já roda dentro do card da sprint atual, só
  // promovida pra fora dela: nenhum critério, tabela ou cálculo novo, apenas
  // avaliada aqui mais cedo pra alimentar `SprintFocusBar` (primeiro
  // conteúdo operacional da página, antes de qualquer bloco de consulta).
  const currentSprintTasksForFocus = currentSprint ? (tasksBySprintId.get(currentSprint.sprintId) ?? []) : [];
  const currentSprintOptimizationCountForFocus = currentSprint
    ? (accountReviewsBySprintId.get(currentSprint.sprintId) ?? []).length
    : null;
  const currentSprintPerformanceKindForFocus = currentSprint
    ? (sprintPerformanceBySprintId.get(currentSprint.sprintId)?.view.kind ?? null)
    : null;
  const nextAction = currentSprint
    ? computeNextAction({
        tasks: currentSprintTasksForFocus,
        today: todayStr,
        performanceViewKind: currentSprintPerformanceKindForFocus,
        performanceGoal,
        optimizationCount: currentSprintOptimizationCountForFocus,
        canConfigureObjective: isAdmin,
      })
    : null;
  const newReviewHref = withParam(returnTo, "review=new");
  let nextActionCtaHref: string | null = null;
  let nextActionCtaLabel: string | null = null;
  if (nextAction && currentSprint) {
    if (nextAction.taskId) {
      nextActionCtaHref = withParam(returnTo, `task=${nextAction.taskId}`);
      nextActionCtaLabel = "Abrir tarefa";
    } else if (nextAction.kind === "update_performance" || nextAction.kind === "configure_objective") {
      nextActionCtaHref = `#sprint-${currentSprint.sprintId}`;
      nextActionCtaLabel = "Ir para a sprint";
    } else if (nextAction.kind === "register_optimization") {
      nextActionCtaHref = newReviewHref;
      nextActionCtaLabel = "Registrar otimização";
    }
  }

  // Identificação do cliente (Etapa 74) — substitui o antigo ClientContextBar
  // (subheader sticky compartilhado por toda /clients/[id]/**, removido).
  // Status já aparece como badge ao lado do nome, por isso não se repete
  // na linha secundária abaixo.
  const reportHref = `/reports/${client.id}?month=${monthParam}`;
  const gestorLabel = client.primary_manager ? `Gestor: ${client.primary_manager.name}` : "Sem gestor atribuído";
  const relationshipLabel = formatRelationshipDuration(client.contract_start_date, today);
  const identitySecondaryLine = [
    gestorLabel,
    client.meta_ad_account_id ? `Conta Meta: ${client.meta_ad_account_id}` : null,
    relationshipLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <ScrollRestoreOnMount />

      {/* 1. Identificação do cliente — substitui o antigo ClientContextBar
          (subheader sticky compartilhado por toda /clients/[id]/**).
          Hierarquia inspirada no Relatório: nome em destaque + badge de
          status na mesma linha, contexto secundário (gestor/conta Meta/
          tempo de relacionamento) abaixo, ações agrupadas à direita.
          Nenhuma "Semana atual" aqui — já aparece no seletor de período,
          logo abaixo. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{client.name}</h1>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}
            >
              {CLIENT_STATUS_LABEL[client.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{identitySecondaryLine}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={reportHref}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Ver relatório
          </Link>
          {isAdmin && (
            <Link
              href={`/clients/${client.id}/edit`}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Editar
            </Link>
          )}
          <form action={syncClientMetaAction.bind(null, client.id)}>
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Atualizar Meta
            </button>
          </form>
        </div>
      </div>

      {/* Identificação mínima durante a rolagem — só nome + status, some
          sozinha ao voltar pro topo (ver client-identity-sticky.tsx). */}
      <ClientIdentitySticky
        clientName={client.name}
        statusLabel={CLIENT_STATUS_LABEL[client.status]}
        statusBadgeClass={CLIENT_STATUS_BADGE_CLASSES[client.status]}
      />

      {banners.length > 0 && (
        <div className="flex flex-col gap-2">
          {banners.map((banner, index) => (
            <p
              key={index}
              className={
                banner.tone === "red"
                  ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
              }
            >
              {banner.text}
            </p>
          ))}
        </div>
      )}

      {/* Etapa 59, seção 16: ação rápida depois de registrar uma análise —
          opcional, nunca gera a atualização automaticamente. */}
      {reviewSaved && !clientUpdatesByReviewId.has(reviewSaved) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-foreground">Revisão de conta registrada com sucesso.</span>
          <div className="flex items-center gap-2">
            <form action={generateClientUpdateAction.bind(null, reviewSaved, withParam(returnTo, `reviewDetail=${reviewSaved}`))}>
              <button
                type="submit"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                Gerar atualização
              </button>
            </form>
            <Link
              href={returnTo}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Fechar
            </Link>
          </div>
        </div>
      )}

      {/* 0. Seletor de mês (Etapa 62, seção 6) — contexto temporal de toda
          a página; mesmo padrão de navegação mensal já usado em
          Relatórios/Visão Geral/Sprints (`?month=YYYY-MM` + shiftMonthParam),
          nenhum componente novo de seletor. Etapa 75: removido o texto
          "Período em análise" — o próprio seletor já comunica o período,
          sem precisar de rótulo. */}
      <div className="mt-3 flex items-center justify-end gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 text-sm">
          <Link
            href={prevMonthHref}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Mês anterior"
          >
            &lsaquo;
          </Link>
          <span className="px-1.5 text-sm font-medium text-foreground">{monthLabel}</span>
          <Link
            href={nextMonthHref}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Próximo mês"
          >
            &rsaquo;
          </Link>
        </div>
      </div>

      {/* 2.5. Foco agora (Etapa "MITZA Operational Workspace 1.0") — antes de
          qualquer bloco de consulta: ritmo financeiro do mês + Próxima Ação
          da sprint atual, sem precisar rolar a página nem expandir nada. Só
          existe quando há sprint atual (mesmo mês selecionado que já
          controla o resto da página) — num mês passado/futuro não existe
          "próxima ação" por definição, igual ao critério já usado dentro do
          card da sprint. */}
      {currentSprint && nextAction && (
        <SprintFocusBar
          spendStatus={monthStatus}
          nextActionText={nextAction.text}
          ctaHref={nextActionCtaHref}
          ctaLabel={nextActionCtaLabel}
        />
      )}

      {/* 3. Acompanhamento da conta — depois do foco operacional imediato: a
          próxima pergunta é "essa conta está sendo acompanhada corretamente
          e o que foi feito recentemente?" */}
      <div className="mt-3">
        <AccountFollowUpPanel
          monthLabel={monthLabel}
          isCurrentMonth={isCurrentMonth}
          monthActual={monthActual}
          performanceGoal={performanceGoal}
          performanceSummary={monthPerformanceSummary}
          configureObjectiveHref={`/clients/${client.id}/edit`}
          lastOptimization={lastOptimization}
          tracking={operationalTracking}
          monthlySummary={monthlyOccurrenceSummary}
          historyRows={recentHistoryRows}
          hasMoreHistory={hasMoreHistory}
          historyHref={reviewsHistoryHref}
          buildReviewDetailHref={buildReviewDetailHref}
          clientId={client.id}
          returnTo={returnTo}
        />
      </div>

      {/* 4. Investimento do mês — resumo financeiro central + edição/histórico
          de orçamento, tudo num único bloco (Etapa 58: antes eram 2 cards
          separados repetindo o mesmo valor planejado). Nenhuma regra de
          cálculo, integração Meta ou fallback manual foi alterada — só a
          posição (agora depois de Acompanhamento da Conta). */}
      <div className="mt-3">
        <MonthInvestmentSummary
          planned={monthPlanned}
          actual={monthActual}
          expectedToDate={monthExpectedToDate}
          status={monthStatus}
          clientId={client.id}
          monthParam={monthParam}
          monthLabel={monthLabel}
          sprints={budgetSprints}
          monthRange={{ firstDay, lastDay }}
          effectiveDate={effectiveDate}
          isAdmin={isAdmin}
          isClosedMonth={isClosedMonth}
          isFutureMonth={isFutureMonth}
          lastChange={lastChange}
          historyHref={historyDrawerHref}
          performanceGoal={performanceGoal}
          targetResultCount={targetResultCount}
          targetCostPerResult={targetCostPerResult}
        />
      </div>

      {/* Performance do mês — só o SECUNDÁRIO (meta/comparação/canal); o
          resultado principal e o custo por resultado já apareceram em
          "Principais KPIs do mês", dentro do Acompanhamento da Conta (Etapa
          72) — nunca duplicados aqui. Retorna `null` quando não há nada
          secundário a mostrar. */}
      <PerformanceSummarySection
        goal={performanceGoal}
        targetCostPerResult={targetCostPerResult}
        summary={monthPerformanceSummary}
        channelBreakdown={monthPerformanceChannelBreakdown}
      />

      {/* 5. Sprints — uma única sequência cronológica (start_date ASC),
          sem separar "sprint atual" de "histórico": misturar concluídas e
          futuras sob "Histórico do mês" dava a impressão de que a atual
          acontecia antes das demais. A sprint atual continua destacada
          (borda azul + badge) e aberta por padrão — SprintCard já decide
          isso sozinho (`defaultOpen ?? isCurrent`) quando `defaultOpen` não
          é passado, por isso nenhuma sprint aqui recebe a prop. */}
      {/* Etapa 73: removido o tooltip "Como funciona?" desta seção — a
          redistribuição financeira semanal deixou de ser apresentada
          (nenhuma orientação de planejamento por sprint na interface, ver
          `sprint-card.tsx`); o componente `Section` em si é compartilhado e
          continua intacto para as demais telas. */}
      <Section title={`Sprints de ${monthLabel}`}>
        <div className="flex flex-col gap-2">
          {sortedSprints.length > 0 ? (
            sortedSprints.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={client.id}
                isAdmin={isAdmin}
                tasks={tasksBySprintId.get(sprint.sprintId) ?? []}
                executionLabel={sprint.temporalStatus === "atual" ? sprintExecutionLabel : null}
                executionSeverity={
                  sprint.temporalStatus === "atual" && sprintExecutionAlert?.severity !== "informativo"
                    ? (sprintExecutionAlert?.severity ?? null)
                    : null
                }
                accountReviews={accountReviewsBySprintId.get(sprint.sprintId) ?? []}
                newReviewHref={newReviewHref}
                buildReviewDetailHref={buildReviewDetailHref}
                manualSpendUpdatedAt={manualSpendUpdatedAtBySprintId.get(sprint.sprintId) ?? null}
                metaSyncedAt={lastSync?.synced_at ?? null}
                taskManagers={managers ?? []}
                defaultAssigneeName={client.primary_manager?.name ?? null}
                performance={sprintPerformanceBySprintId.get(sprint.sprintId)}
                returnTo={returnTo}
                hideNextAction={sprint.temporalStatus === "atual"}
              />
            ))
          ) : (
            <EmptyState>
              Nenhuma sprint encontrada para este período — verifique se as sprints do mês já foram geradas.
            </EmptyState>
          )}
        </div>
      </Section>

      <Section title="Outras tarefas">
        <p className="mb-3 text-xs text-zinc-500">
          Tarefas sem sprint vinculada — as de cada sprint aparecem no card dela, acima.
        </p>
        <TaskList tasks={unlinkedTasks} clientId={client.id} managers={managers ?? []} />
      </Section>

      <div className="mt-3">
        <EssentialInfoPanel
          mainObjective={client.main_objective}
          mainProductOrService={client.main_product_or_service}
          operationRegion={client.operation_region}
          primaryAudience={client.primary_audience}
          clientDifferentials={client.client_differentials}
          clientRestrictions={client.client_restrictions}
          importantSeasonalDates={client.important_seasonal_dates}
          operationalSummary={client.operational_summary}
          importantNotes={client.important_notes}
          isAdmin={isAdmin}
          editHref={`/clients/${client.id}/edit`}
        />
      </div>

      {openTask && (
        <TaskDrawerPanel
          task={openTask}
          clientId={client.id}
          clientName={client.name}
          sprintPeriodLabel={openTaskSprintPeriodLabel}
          comments={taskCommentsById.get(openTask.id) ?? []}
          closeHref={returnTo}
          returnTo={returnTo}
          isAdmin={isAdmin}
          managers={managers ?? []}
        />
      )}

      {isAdmin && historicoOrcamento && (
        <MonthlyBudgetHistoryDrawer
          monthLabel={monthLabel}
          changes={(budgetChanges ?? []).map((change) => ({
            id: change.id,
            effectiveDate: change.effective_date,
            changedAt: change.changed_at,
            changedByName: change.changed_by_profile?.name ?? null,
            previousAmount: change.previous_amount,
            newAmount: change.new_amount,
            consolidatedAmount: change.consolidated_amount,
            futureAmountDistributed: change.future_amount_distributed,
            resultingTotal: change.resulting_total,
            isBelowConsolidated: change.is_below_consolidated,
            reason: change.reason,
          }))}
          closeHref={historyDrawerCloseHref}
        />
      )}

      {reviewsHistory && (
        <ClientOperationalHistoryDrawer
          monthLabel={monthLabel}
          rows={fullHistory.rows}
          hasMore={fullHistory.hasMore}
          page={historyPage}
          buildPageHref={buildHistoryPageHref}
          buildReviewDetailHref={buildReviewDetailHref}
          closeHref={returnTo}
        />
      )}

      {/* Etapas 4/5 — agendar/editar/reagendar reunião ou entrega sem sair
          da página do cliente (drawer compacto sobre a própria URL). */}
      {(scheduleOccurrence === "reuniao" || scheduleOccurrence === "entrega_criativo") && (
        <ScheduleOccurrenceDrawer
          occurrenceType={scheduleOccurrence}
          clientId={client.id}
          returnTo={returnTo}
          closeHref={returnTo}
          editingTask={
            scheduleTaskId
              ? (() => {
                  const task = (tasks ?? []).find((t) => t.id === scheduleTaskId);
                  return task ? { id: task.id, dueDate: task.due_date, dueTime: task.due_time, notes: task.notes } : null;
                })()
              : null
          }
        />
      )}

      {openReview === "new" && (
        <RecordAccountReviewDrawer
          clientId={client.id}
          closeHref={returnTo}
          managers={managers ?? []}
          error={reviewError}
        />
      )}

      {reviewDetail && (
        <AccountReviewDetailDrawer review={reviewDetail} clientId={client.id} closeHref={returnTo} />
      )}
    </div>
  );
}
