import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  assertSingleCurrentSprint,
  computeSprintEffectiveSpend,
  computeSprintFinancials,
  currentMonthRange,
  sumActualSpendForMonth,
  sumExpectedToDateForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { computeTaskCounts } from "@/lib/client-metrics";
import { classifySpendStatus } from "@/lib/spend-status";
import { buildAttentionAlerts } from "@/lib/attention-alerts";
import { buildSprintExecutionAlert, formatSprintExecutionLabel } from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import { resolveBudgetEffectiveDate } from "@/lib/monthly-budget";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { computeOperationalTracking } from "@/lib/operational-tracking";
import { computeAccountReviewCadenceStatus } from "@/lib/account-review-cadence";
import { computeClientUpdateStatus } from "@/lib/client-updates";
import { AttentionPanel } from "../attention-panel";
import { MonthInvestmentSummary } from "../month-investment-summary";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import { OperationalTrackingPanel } from "../operational-tracking-panel";
import { AccountFollowUpPanel, type AccountReviewPreviewItem } from "../account-follow-up-panel";
import { AccountReviewsHistoryDrawer } from "../account-reviews-history-drawer";
import { EssentialInfoPanel } from "../essential-info-panel";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";
import type { AccountReviewSummaryItem } from "../account-reviews-section";
import { RecordAccountReviewDrawer } from "../record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "../account-review-detail-drawer";
import { generateClientUpdateAction } from "../client-update-actions";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationTaskItem } from "@/app/operation/operation-data";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { MonthlyBudgetHistoryDrawer } from "../monthly-budget-history-drawer";

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
      "id, name, main_objective, main_product_or_service, operation_region, primary_audience, client_differentials, client_restrictions, important_seasonal_dates, operational_summary, important_notes",
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
  const { firstDay, lastDay } = currentMonthRange();
  const today = todayUTC();
  const todayStr = todayDateString();
  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);

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
      .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at")
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

  assertSingleCurrentSprint(sprints ?? [], today);
  const sprintFinancials = (sprints ?? []).map((sprint) => {
    const actualSpend = computeSprintEffectiveSpend(sprint, dailySpend ?? []);
    return computeSprintFinancials(sprint, actualSpend, today, sprint.spend_source);
  });

  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Soma direta das alocações diárias no intervalo do mês — desde a
  // correção da Etapa 50, nenhuma sprint atravessa mais a fronteira do mês,
  // então toda sprint pertence a exatamente um mês; ainda assim a soma por
  // interseção de data é a fonte única (mesma usada na Visão Geral/Sprints).
  const monthPlanned = sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);
  const monthExpectedToDate = sumExpectedToDateForMonth(monthPlannedAllocationRows, { firstDay, lastDay }, today);
  // Ritmo do mês: realizado x esperado até hoje, nunca x 100% do planejado
  // antes do mês acabar (mesma regra agora usada em toda a Visão Geral/
  // Sprints — ver operation-data.ts).
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);
  const currentSprint = sprintFinancials.find((sprint) => sprint.temporalStatus === "atual") ?? null;
  // Histórico do mês (Etapa 54): todas as sprints do mês exceto a atual,
  // já ordenadas cronologicamente (mesma ordem da query original).
  const otherSprints = sprintFinancials.filter((sprint) => sprint.temporalStatus !== "atual");

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate({ firstDay, lastDay }, todayStr);
  const budgetSprints = sprintFinancials.map((sprint) => ({
    sprintId: sprint.sprintId,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  }));
  const currentAllocations = (plannedAllocations ?? []).map((row) => ({
    date: row.date,
    amount: row.planned_amount,
  }));
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
      "id, title, type, due_date, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
    )
    .eq("client_id", id)
    .order("due_date");

  // Etapa 57 — Análises da Conta: janela de 60 dias é suficiente pra
  // cadência semanal/dias úteis; "análise anterior" completa já vem
  // calculada e gravada em cada linha (seconds_since_previous_review),
  // nunca recalculada aqui.
  const reviewWindowStart = new Date(today.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
  const [
    { data: accountReviewRows },
    { data: lastOptimizationRow },
    { data: cadenceConfig },
    { data: managers },
    { data: clientUpdateRows },
  ] = await Promise.all([
    supabase
      .from("account_reviews")
      .select(
        "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
      )
      .eq("client_id", id)
      .gte("reviewed_at", `${reviewWindowStart}T00:00:00Z`)
      .order("reviewed_at", { ascending: false }),
    supabase
      .from("account_optimizations")
      .select("optimization_type, created_at")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("account_review_cadences")
      .select("reviews_per_week, max_business_days_without_review, is_active")
      .eq("client_id", id)
      .maybeSingle(),
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

  const accountReviewCadenceStatus = computeAccountReviewCadenceStatus(
    accountReviews.map((r) => r.reviewed_at),
    cadenceConfig
      ? {
          reviewsPerWeek: cadenceConfig.reviews_per_week,
          maxBusinessDaysWithoutReview: cadenceConfig.max_business_days_without_review,
          isActive: cadenceConfig.is_active,
        }
      : null,
    today,
    lastOptimizationRow ? { type: lastOptimizationRow.optimization_type, occurredAt: lastOptimizationRow.created_at } : null,
  );

  // Etapa 58: preview de análises recentes no bloco "Acompanhamento da conta"
  // — reaproveita a mesma janela de 60 dias já buscada acima (accountReviews),
  // nenhuma query nova só pra mostrar as 2 mais recentes com detalhe de
  // otimização.
  const accountReviewPreviewItems: AccountReviewPreviewItem[] = accountReviews.map((review) => {
    const optimizationTypes = Array.from(new Set(review.optimizations.map((opt) => opt.optimization_type)));
    const summaryText =
      review.outcome === "OPTIMIZATION_PERFORMED"
        ? (review.optimizations[0]?.description ?? null)
        : review.outcome === "ISSUE_IDENTIFIED"
          ? review.issue_description
          : review.notes;
    const update = clientUpdatesByReviewId.get(review.id) ?? null;
    return {
      id: review.id,
      reviewedAt: review.reviewed_at,
      managerName: review.team_member?.name ?? "Membro removido",
      outcome: review.outcome,
      optimizationTypes,
      summaryText,
      updateStatus: computeClientUpdateStatus(
        update ? { copiedAt: update.copied_at, sentAt: update.sent_at } : null,
      ),
    };
  });
  const recentAccountReviews = accountReviewPreviewItems.slice(0, 2);
  const hasMoreAccountReviews = accountReviewPreviewItems.length > 2;

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
  const { bySprintId: tasksBySprintId, unlinked: unlinkedTasks } = groupBySprintId(tasks ?? []);
  const operationalTracking = computeOperationalTracking(tasks ?? [], today);

  const tasksThisMonth = (tasks ?? []).filter(
    (task) => task.due_date >= firstDay && task.due_date <= lastDay,
  );
  const taskCounts = computeTaskCounts(tasksThisMonth, today);

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

  const returnTo = `/clients/${client.id}`;
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
  const historyDrawerHref = `${returnTo}?historicoOrcamento=1`;
  const historyDrawerCloseHref = returnTo;
  const reviewsHistoryHref = `${returnTo}?reviewsHistory=1`;
  const buildReviewDetailHref = (reviewId: string) => `${returnTo}?reviewDetail=${reviewId}`;
  const cadenceConfigHref = `/clients/${client.id}/edit`;
  const hasCriticalAlert = alerts.some((alert) => alert.severity === "critico");
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
            <form action={generateClientUpdateAction.bind(null, reviewSaved, `${returnTo}?reviewDetail=${reviewSaved}`)}>
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

      {/* 1. Investimento do mês — resumo financeiro central + edição/histórico
          de orçamento, tudo num único bloco (Etapa 58: antes eram 2 cards
          separados repetindo o mesmo valor planejado). */}
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
          currentAllocations={currentAllocations}
          monthRange={{ firstDay, lastDay }}
          effectiveDate={effectiveDate}
          isAdmin={isAdmin}
          isClosedMonth={isClosedMonth}
          lastChange={lastChange}
          historyHref={historyDrawerHref}
        />
      </div>

      {/* Prioridades (Etapa 58, seção 16): quando existe alerta crítico, o
          bloco aparece logo aqui, ainda antes do Acompanhamento da Conta —
          quando não há crítico, ele volta pra posição padrão mais abaixo.
          Sem nenhum alerta, AttentionPanel retorna null e nada é renderizado. */}
      {alerts.length > 0 && hasCriticalAlert && (
        <div className="mt-3">
          <AttentionPanel alerts={alerts} />
        </div>
      )}

      {/* 2. Acompanhamento da conta — bloco operacional principal da página
          (Etapa 58): resumo de cadência + CTA de registrar análise + preview
          das 2 análises mais recentes, tudo num único bloco compacto. */}
      <div className="mt-3">
        <AccountFollowUpPanel
          status={accountReviewCadenceStatus}
          today={today}
          recentReviews={recentAccountReviews}
          hasMoreReviews={hasMoreAccountReviews}
          newReviewHref={`${returnTo}?review=new`}
          historyHref={reviewsHistoryHref}
          buildReviewDetailHref={buildReviewDetailHref}
          cadenceConfigHref={cadenceConfigHref}
          isAdmin={isAdmin}
        />
      </div>

      {/* 3. Rotinas do cliente (Etapa 58: antes "Acompanhamento operacional") */}
      <div className="mt-3">
        <OperationalTrackingPanel tracking={operationalTracking} today={today} />
      </div>

      {/* Prioridades — posição padrão, quando não há alerta crítico. */}
      {alerts.length > 0 && !hasCriticalAlert && (
        <div className="mt-3">
          <AttentionPanel alerts={alerts} />
        </div>
      )}

      {/* 4. Sprint atual — só a sprint classificada como atual pela regra
          temporal central (getSprintTemporalStatus); nunca escolhida
          arbitrariamente. Se nenhuma existir, estado claro em vez de
          silenciosamente não mostrar nada. */}
      <Section title="Sprint atual">
        {currentSprint ? (
          <SprintCard
            sprint={currentSprint}
            comments={sprintCommentsById.get(currentSprint.sprintId) ?? []}
            clientId={client.id}
            isAdmin={isAdmin}
            tasks={tasksBySprintId.get(currentSprint.sprintId) ?? []}
            executionLabel={sprintExecutionLabel}
            executionSeverity={
              sprintExecutionAlert?.severity !== "informativo" ? (sprintExecutionAlert?.severity ?? null) : null
            }
            accountReviews={accountReviewsBySprintId.get(currentSprint.sprintId) ?? []}
            newReviewHref={`${returnTo}?review=new`}
            buildReviewDetailHref={buildReviewDetailHref}
          />
        ) : (
          <p className="text-sm text-zinc-500">
            Nenhuma sprint atual encontrada para este período — verifique se as sprints do mês já foram geradas.
          </p>
        )}
      </Section>

      {/* 5. Histórico do mês — demais sprints do mês (concluídas e futuras),
          recolhidas por padrão; a sprint atual não se repete aqui. */}
      <Section title="Histórico do mês">
        <div className="flex flex-col gap-2">
          {otherSprints.length > 0 ? (
            otherSprints.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={client.id}
                isAdmin={isAdmin}
                tasks={tasksBySprintId.get(sprint.sprintId) ?? []}
                defaultOpen={false}
                accountReviews={accountReviewsBySprintId.get(sprint.sprintId) ?? []}
                newReviewHref={`${returnTo}?review=new`}
                buildReviewDetailHref={buildReviewDetailHref}
              />
            ))
          ) : (
            <p className="text-sm text-zinc-500">Nenhuma outra sprint neste mês.</p>
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
        <AccountReviewsHistoryDrawer
          reviews={accountReviewPreviewItems}
          buildReviewDetailHref={buildReviewDetailHref}
          closeHref={returnTo}
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
