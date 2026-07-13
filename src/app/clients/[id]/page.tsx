import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  computeSprintEffectiveSpend,
  computeSprintFinancials,
  currentMonthRange,
  sumActualSpendForMonth,
  sumExpectedToDateForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { computeCumulativeSpendSeries } from "@/lib/spend-chart-data";
import { computeMonthProjection, computeTaskCounts } from "@/lib/client-metrics";
import { classifySpendStatus } from "@/lib/spend-status";
import { buildAttentionAlerts } from "@/lib/attention-alerts";
import { buildSprintExecutionAlert, formatSprintExecutionLabel } from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import { classifyOperationalActivityStatus, formatLastActivityLabel } from "@/lib/operational-activity";
import { effectiveTaskStatus } from "@/lib/task-status";
import { resolveBudgetEffectiveDate } from "@/lib/monthly-budget";
import { todayDateString } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { ClientMetricsCards } from "../client-metrics-cards";
import { AttentionPanel } from "../attention-panel";
import { SpendChart } from "../spend-chart";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationTaskItem } from "@/app/operation/operation-data";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { MonthlyBudgetPanel } from "../monthly-budget-panel";
import { MonthlyBudgetHistoryDrawer } from "../monthly-budget-history-drawer";

const OPTIMIZATION_LOOKBACK_DAYS = 14;

async function fetchCommentsByType(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  type: "sprint" | "task",
  ids: string[],
): Promise<CommentItem[]> {
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("comments")
    .select("id, commentable_id, content, created_at, author:profiles!comments_author_id_fkey(name)")
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
  } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!client) notFound();

  const { firstDay, lastDay } = currentMonthRange();
  const today = new Date();
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
        "id, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, changed_by_profile:profiles!monthly_budget_changes_changed_by_fkey(name)",
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
  const projection = computeMonthProjection(monthPlanned, monthActual, today);
  const currentSprint = sprintFinancials.find((sprint) => sprint.temporalStatus === "atual") ?? null;

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
  const activityStatus = classifyOperationalActivityStatus(clientInactivityBusinessDays);
  const activityLabel = formatLastActivityLabel(clientLastActivityDate, today);

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, type, due_date, status, sprint_id, notes, assignee:profiles!tasks_assignee_id_fkey(name)",
    )
    .eq("client_id", id)
    .order("due_date");

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

  const tasksThisMonth = (tasks ?? []).filter(
    (task) => task.due_date >= firstDay && task.due_date <= lastDay,
  );
  const taskCounts = computeTaskCounts(tasksThisMonth, today);

  const lookbackStart = new Date(today.getTime() - OPTIMIZATION_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recentOptimizationTasks = (tasks ?? []).filter(
    (task) =>
      task.type === "otimizacao" &&
      task.due_date >= lookbackStart &&
      task.due_date <= today.toISOString().slice(0, 10),
  );
  const optimizationRecentlyDone =
    recentOptimizationTasks.length === 0 ||
    recentOptimizationTasks.some((task) => effectiveTaskStatus(task, today) === "feito");

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

  const chartPoints = computeCumulativeSpendSeries(
    sprints ?? [],
    dailySpend ?? [],
    plannedAllocations ?? [],
    { firstDay, lastDay },
    today,
  );

  const banners = [
    error && { tone: "red", text: error },
    commentError && { tone: "red", text: commentError },
    taskError && { tone: "red", text: taskError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
    budgetSaved && { tone: "green", text: "Orçamento do mês atualizado." },
  ].filter((banner): banner is { tone: "red" | "green"; text: string } => Boolean(banner));

  const returnTo = `/clients/${client.id}`;
  const historyDrawerHref = `${returnTo}?historicoOrcamento=1`;
  const historyDrawerCloseHref = returnTo;
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

      <div className="mt-3">
        <ClientMetricsCards
          monthPlanned={monthPlanned}
          monthActual={monthActual}
          projection={projection}
          taskCounts={taskCounts}
          activityStatus={activityStatus}
          activityLabel={activityLabel}
        />
      </div>

      <div className="mt-3">
        <AttentionPanel alerts={alerts} />
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-medium text-foreground">
          Planejado acumulado x gasto real acumulado
        </h2>
        <div className="mt-2">
          <SpendChart points={chartPoints} />
        </div>
      </div>

      <div className="mt-3">
        <MonthlyBudgetPanel
          clientId={client.id}
          monthParam={monthParam}
          monthLabel={monthLabel}
          totalPlanned={monthPlanned}
          sprintCount={sprintFinancials.length}
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

      <Section title="Sprints do mês">
        <div className="flex flex-col gap-2">
          {sprintFinancials.length > 0 ? (
            sprintFinancials.map((sprint) => (
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
              />
            ))
          ) : (
            <p className="text-sm text-zinc-500">Nenhuma sprint neste mês ainda.</p>
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

      {openTask && (
        <TaskDrawerPanel
          task={openTask}
          clientId={client.id}
          clientName={client.name}
          sprintPeriodLabel={openTaskSprintPeriodLabel}
          comments={taskCommentsById.get(openTask.id) ?? []}
          closeHref={returnTo}
          returnTo={returnTo}
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
    </div>
  );
}
