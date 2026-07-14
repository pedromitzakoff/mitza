import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
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
import { computeTaskCounts } from "@/lib/client-metrics";
import { classifySpendStatus } from "@/lib/spend-status";
import { buildAttentionAlerts } from "@/lib/attention-alerts";
import { buildSprintExecutionAlert, formatSprintExecutionLabel } from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import {
  resolveBudgetEffectiveDate,
  resolveMonthlyBudget,
  computeMonthlyBudgetPlan,
  computeMonthlyExpectedToDateByCalendar,
} from "@/lib/monthly-budget";
import { computeOriginalSprintPlans } from "@/lib/sprint-recommendation";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { computeOperationalTracking, computeMonthlyOccurrenceSummary } from "@/lib/operational-tracking";
import { fetchClientOperationalHistory } from "@/lib/client-operational-history";
import { computeClientUpdateStatus } from "@/lib/client-updates";
import { AttentionPanel } from "../attention-panel";
import { MonthInvestmentSummary } from "../month-investment-summary";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import { AccountFollowUpPanel, type LastReviewInfo, type LastOptimizationInfo } from "../account-follow-up-panel";
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

const OPTIMIZATION_LOOKBACK_DAYS = 14;

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
    commentError?: string;
    task?: string;
    budgetSaved?: string;
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
    commentError,
    task: openTaskId,
    budgetSaved,
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
      "id, name, main_objective, main_product_or_service, operation_region, primary_audience, client_differentials, client_restrictions, important_seasonal_dates, operational_summary, important_notes, performance_goal, target_cost_per_result",
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
  const [
    { data: sprints },
    { data: dailySpend },
    { data: lastSync },
    { data: plannedAllocations },
    { data: budgetChanges },
  ] = await Promise.all([
    // Sobreposição com o mês (não "começa no mês") — uma sprint que
    // atravessa a fronteira (ex.: 27/jul-02/ago) precisa aparecer aqui
    // mesmo com start_date no mês anterior.
    supabase
      .from("sprints")
      .select(
        "id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
      )
      .eq("client_id", id)
      .lte("start_date", lastDay)
      .gte("end_date", firstDay)
      .order("start_date"),
    supabase
      .from("daily_spend")
      .select("date, spend")
      .eq("client_id", id)
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("daily_spend")
      .select("synced_at")
      .eq("client_id", id)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sprint_planned_allocations")
      .select("sprint_id, date, planned_amount")
      .eq("client_id", id)
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("monthly_budget_changes")
      .select(
        "id, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
      )
      .eq("client_id", id)
      .eq("month", firstDay)
      .order("changed_at", { ascending: false }),
  ]);

  const { data: clientActivity } = await supabase
    .from("client_last_operational_activity")
    .select("last_activity_at")
    .eq("client_id", id)
    .maybeSingle();

  // Etapa 71: registros de performance de todas as sprints do mês
  // selecionado — sempre por sprint (nenhum lançamento manual mensal
  // independente, ver migration), nunca uma query por sprint.
  const monthSprintIds = (sprints ?? []).map((s) => s.id);
  const { data: performanceRecordRows } =
    monthSprintIds.length > 0
      ? await supabase
          .from("performance_records")
          .select("sprint_id, channel, result_type, result_count, source, source_updated_at")
          .in("sprint_id", monthSprintIds)
      : { data: [] };
  const performanceRecords: PerformanceRecordRawRow[] = (performanceRecordRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  assertSingleCurrentSprint(sprints ?? [], today);
  const sprintFinancials = (sprints ?? []).map((sprint) => {
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
  // Etapa 70 — nova camada de recomendação por sprint: planejamento
  // original (todos os dias do mês, distribuído entre TODAS as sprints,
  // encerradas + atual + futuras) e congelamento (lazy, idempotente) do
  // histórico financeiro de cada sprint que já encerrou. Nunca altera a
  // lógica mensal acima (orçamento vigente, esperado até hoje, status) —
  // só consome `monthPlanned`/`sprints`/`dailySpend`/`budgetChanges` já
  // buscados, nenhuma query nova além da já existente.
  const originalPlans = computeOriginalSprintPlans(
    monthPlanned,
    { firstDay, lastDay },
    (sprints ?? []).map((s) => ({ sprintId: s.id, startDate: s.start_date, endDate: s.end_date })),
  );
  const closedSprintSnapshots = await ensureClosedSprintSnapshots(supabase, {
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
  const targetCostPerResult = client.target_cost_per_result;
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
    });
  }

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate({ firstDay, lastDay }, todayStr);
  // Etapa 64: mês selecionado ainda não começou — usado só pra escolher o
  // texto da seção "Investimento do mês" (nunca uma segunda comparação de
  // datas: "não é o mês corrente" + "não está encerrado" já implica futuro,
  // dado que todo mês é ou passado, ou corrente, ou futuro).
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  const budgetSprints = sprintFinancials.map((sprint) => ({
    sprintId: sprint.sprintId,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  }));
  // Etapa 66: única fonte de "quanto ainda pode ser investido este mês" e de
  // como isso se divide entre a sprint atual e as futuras — nunca mais lida
  // de `sprint_planned_allocations`. `null` só quando o mês está encerrado
  // (não existe "planejamento restante" pra um mês que já passou).
  const monthPlan = effectiveDate
    ? computeMonthlyBudgetPlan({
        monthlyBudget: monthPlanned,
        monthActual,
        monthRange: { firstDay, lastDay },
        effectiveDate,
        sprints: budgetSprints,
      })
    : null;
  const lastBudgetChange = (budgetChanges ?? [])[0] ?? null;
  const lastChange = lastBudgetChange
    ? {
        lastEffectiveDate: lastBudgetChange.effective_date,
        lastPreviousAmount: lastBudgetChange.previous_amount,
        lastNewAmount: lastBudgetChange.new_amount,
        changeCountThisMonth: (budgetChanges ?? []).length,
      }
    : null;

  const { data: sprintActivity } = currentSprint
    ? await supabase
        .from("sprint_last_operational_activity")
        .select("last_activity_at")
        .eq("sprint_id", currentSprint.sprintId)
        .maybeSingle()
    : { data: null };

  const clientLastActivityDate = clientActivity?.last_activity_at
    ? new Date(clientActivity.last_activity_at)
    : null;
  const clientInactivityBusinessDays = clientLastActivityDate
    ? businessDaysSince(clientLastActivityDate, today)
    : null;

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, type, due_date, due_time, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
    )
    .eq("client_id", id)
    .order("due_date");

  // Etapa 62: a janela fixa de 60 dias (Etapa 57) foi substituída por uma
  // busca sem filtro de data (as últimas 200 análises do cliente — teto
  // generoso, nunca deveria ser atingido na prática) porque agora o mesmo
  // conjunto precisa responder a DUAS perguntas diferentes: "qual a última
  // análise/otimização de verdade" (mês atual — pode estar em qualquer mês
  // passado) e "quais análises/otimizações aconteceram DENTRO do mês
  // selecionado" (mês anterior, Etapa 8) — uma janela fixa de 60 dias
  // quebraria a segunda pergunta pra qualquer mês mais antigo que isso.
  const [{ data: accountReviewRows }, { data: managers }, { data: clientUpdateRows }] = await Promise.all([
    supabase
      .from("account_reviews")
      .select(
        "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
      )
      .eq("client_id", id)
      .order("reviewed_at", { ascending: false })
      .limit(200),
    supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
    // Etapa 59 — Atualização para o Cliente: uma linha por análise (no
    // máximo), buscada junto com o resto da página; nenhuma query separada
    // por análise (nem pro indicador discreto nem pro conteúdo do drawer).
    supabase
      .from("client_updates")
      .select(
        "id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)",
      )
      .eq("client_id", id),
  ]);

  const clientUpdatesByReviewId = new Map((clientUpdateRows ?? []).map((row) => [row.account_review_id, row]));

  const accountReviews = accountReviewRows ?? [];
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

  // Etapa 62, seção 3/7/8 — "Última análise"/"Última otimização": no mês
  // atual é sempre o dado GLOBAL mais recente (accountReviews já vem
  // ordenado desc, então é só o primeiro item); num mês anterior, é o mais
  // recente DENTRO do mês selecionado. "Última otimização" é a otimização
  // da análise mais recente (nessa mesma lista) que de fato tem alguma —
  // nunca uma consulta paralela a account_optimizations (a única fonte é a
  // mesma lista de análises, com optimizations já aninhadas).
  const reviewsInMonth = accountReviews.filter(
    (r) => r.reviewed_at >= `${firstDay}T00:00:00Z` && r.reviewed_at <= `${lastDay}T23:59:59.999Z`,
  );
  const reviewsForLastLookup = isCurrentMonth ? accountReviews : reviewsInMonth;

  const lastReviewSource = reviewsForLastLookup[0] ?? null;
  const lastReview: LastReviewInfo | null = lastReviewSource
    ? { reviewedAt: lastReviewSource.reviewed_at, managerName: lastReviewSource.team_member?.name ?? "Membro removido" }
    : null;

  const lastOptimizationSource = reviewsForLastLookup.find((r) => r.optimizations.length > 0) ?? null;
  const lastOptimization: LastOptimizationInfo | null = lastOptimizationSource
    ? {
        type: lastOptimizationSource.optimizations[0].optimization_type,
        occurredAt: lastOptimizationSource.reviewed_at,
        managerName: lastOptimizationSource.team_member?.name ?? "Membro removido",
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

  const tasksThisMonth = (tasks ?? []).filter(
    (task) => task.due_date >= firstDay && task.due_date <= lastDay,
  );
  const taskCounts = computeTaskCounts(tasksThisMonth, today);

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

  // Etapa 57: o sinal de "otimização recente" agora vem de account_reviews
  // (Análise da Conta), não mais de tasks.type === 'otimizacao' — o template
  // que gerava essa tarefa foi desativado (seção 2 do pedido).
  const optimizationLookbackStart = new Date(today.getTime() - OPTIMIZATION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const optimizationRecentlyDone = accountReviews.some((review) => review.reviewed_at >= optimizationLookbackStart);

  const currentSprintTasks = currentSprint ? tasksBySprintId.get(currentSprint.sprintId) ?? [] : [];

  const baseAlerts = buildAttentionAlerts({
    monthStatus,
    overdueTasksCount: taskCounts.overdue,
    optimizationRecentlyDone,
    lastSyncedAt: lastSync?.synced_at ?? null,
    currentSprintPlannedSpend: currentSprint?.plannedSpend ?? null,
    currentSprintTaskCount: currentSprintTasks.length,
    currentSprintUnassignedCount: currentSprintTasks.filter((task) => !task.assignee).length,
    clientInactivityBusinessDays,
    now: today,
  });

  const sprintLastActivityDate = sprintActivity?.last_activity_at
    ? new Date(sprintActivity.last_activity_at)
    : null;
  const sprintExecutionAlert = currentSprint
    ? buildSprintExecutionAlert(currentSprint, sprintLastActivityDate, today)
    : null;
  const alerts = sprintExecutionAlert ? [...baseAlerts, sprintExecutionAlert] : baseAlerts;
  const sprintExecutionLabel = currentSprint
    ? formatSprintExecutionLabel(sprintLastActivityDate, currentSprint.startDate, today)
    : null;

  const banners = [
    error && { tone: "red", text: error },
    commentError && { tone: "red", text: commentError },
    taskError && { tone: "red", text: taskError },
    reviewError && { tone: "red", text: reviewError },
    clientUpdateError && { tone: "red", text: clientUpdateError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
    budgetSaved && { tone: "green", text: "Orçamento do mês atualizado." },
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <ScrollRestoreOnMount />

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
          <span className="text-foreground">Análise registrada com sucesso.</span>
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
          nenhum componente novo de seletor. */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Período em análise</p>
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

      {/* 1. Acompanhamento da conta — primeiro bloco principal da página:
          ao abrir um cliente, a primeira pergunta operacional é "essa conta
          está sendo acompanhada corretamente e o que foi feito recentemente?"
          (reordenação de hierarquia — antes vinha depois de Investimento e
          Prioridades). */}
      <div className="mt-3">
        <AccountFollowUpPanel
          monthLabel={monthLabel}
          isCurrentMonth={isCurrentMonth}
          lastReview={lastReview}
          lastOptimization={lastOptimization}
          tracking={operationalTracking}
          monthlySummary={monthlyOccurrenceSummary}
          historyRows={recentHistoryRows}
          hasMoreHistory={hasMoreHistory}
          historyHref={reviewsHistoryHref}
          newReviewHref={withParam(returnTo, "review=new")}
          buildReviewDetailHref={buildReviewDetailHref}
          clientId={client.id}
          returnTo={returnTo}
        />
      </div>

      {/* 2. Investimento do mês — resumo financeiro central + edição/histórico
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
        />
      </div>

      {/* 2b. Performance do mês — dimensão nova e SEPARADA do financeiro
          (Etapa 71): próxima do card de Investimento, nunca fundida com ele. */}
      <div className="mt-3">
        <PerformanceSummarySection
          goal={performanceGoal}
          targetCostPerResult={targetCostPerResult}
          summary={monthPerformanceSummary}
          channelBreakdown={monthPerformanceChannelBreakdown}
          editHref={`/clients/${client.id}/edit`}
        />
      </div>

      {/* 3. Prioridades — posição única e fixa (a promoção condicional pra
          antes do Acompanhamento da Conta em caso de alerta crítico, da
          Etapa 58, foi removida: a nova hierarquia pedida é sempre
          Acompanhamento → Investimento → Prioridades, independente de
          severidade). Motor de prioridades, critérios e cálculos
          inalterados — só a posição. Sem nenhum alerta, AttentionPanel
          retorna null e nada é renderizado. */}
      {alerts.length > 0 && (
        <div className="mt-3">
          <AttentionPanel alerts={alerts} />
        </div>
      )}

      {/* 4. Restante da página — mesma ordem relativa de sempre. */}

      {/* Sprints do mês — uma única sequência cronológica (start_date ASC),
          sem separar "sprint atual" de "histórico": misturar concluídas e
          futuras sob "Histórico do mês" dava a impressão de que a atual
          acontecia antes das demais. A sprint atual continua destacada
          (borda azul + badge) e aberta por padrão — SprintCard já decide
          isso sozinho (`defaultOpen ?? isCurrent`) quando `defaultOpen` não
          é passado, por isso nenhuma sprint aqui recebe a prop. */}
      <Section
        title={`Sprints de ${monthLabel}`}
        action={
          <span
            tabIndex={0}
            className="cursor-help text-xs text-muted-foreground underline decoration-dotted focus:outline-none focus:ring-1 focus:ring-brand"
            title="Os valores recomendados das sprints são recalculados conforme o investimento realizado, para que o orçamento mensal seja atingido ao final do mês."
          >
            Como funciona?
          </span>
        }
      >
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
                newReviewHref={withParam(returnTo, "review=new")}
                buildReviewDetailHref={buildReviewDetailHref}
                remainingPlanned={monthPlan?.sprintPlans.get(sprint.sprintId)?.remainingPlanned ?? 0}
                eligibleDaysCount={monthPlan?.sprintPlans.get(sprint.sprintId)?.eligibleDaysCount ?? 0}
                originalPlannedAmount={
                  closedSprintSnapshots.get(sprint.sprintId)?.originalPlannedAmount ??
                  originalPlans.get(sprint.sprintId)?.originalPlannedAmount ??
                  0
                }
                finalRecommendedAmount={closedSprintSnapshots.get(sprint.sprintId)?.finalRecommendedAmount ?? null}
                manualSpendUpdatedAt={manualSpendUpdatedAtBySprintId.get(sprint.sprintId) ?? null}
                metaSyncedAt={lastSync?.synced_at ?? null}
                performance={sprintPerformanceBySprintId.get(sprint.sprintId)}
              />
            ))
          ) : (
            <p className="text-sm text-zinc-500">
              Nenhuma sprint encontrada para este período — verifique se as sprints do mês já foram geradas.
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Outras tarefas"
        action={
          <Link
            href={`/clients/${client.id}/tasks/new`}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            + Nova tarefa
          </Link>
        }
      >
        <p className="mb-3 text-xs text-zinc-500">
          Tarefas sem sprint vinculada — as de cada sprint aparecem no card dela, acima.
        </p>
        <TaskList tasks={unlinkedTasks} clientId={client.id} />
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
