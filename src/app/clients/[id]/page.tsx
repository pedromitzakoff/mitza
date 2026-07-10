import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { computeSprintFinancials, currentMonthRange, resolveSprintActualSpend } from "@/lib/sprint-financials";
import { computeCumulativeSpendSeries } from "@/lib/spend-chart-data";
import { computeMonthProjection, computeTaskCounts } from "@/lib/client-metrics";
import { classifySpendStatus } from "@/lib/spend-status";
import { buildAttentionAlerts } from "@/lib/attention-alerts";
import { buildSprintExecutionAlert } from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import { classifyOperationalActivityStatus, formatLastActivityLabel } from "@/lib/operational-activity";
import { effectiveTaskStatus } from "@/lib/task-status";
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
  }>;
}) {
  const { id } = await params;
  const { error, synced, saved, taskError, commentError, task: openTaskId } = await searchParams;
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

  const [{ data: sprints }, { data: dailySpend }, { data: lastSync }] = await Promise.all([
    supabase
      .from("sprints")
      .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
      .eq("client_id", id)
      .gte("start_date", firstDay)
      .lte("start_date", lastDay)
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
  ]);

  const { data: clientActivity } = await supabase
    .from("client_last_operational_activity")
    .select("last_activity_at")
    .eq("client_id", id)
    .maybeSingle();

  const sprintFinancials = (sprints ?? []).map((sprint) => {
    const metaSpendSum = (dailySpend ?? [])
      .filter((row) => row.date >= sprint.start_date && row.date <= sprint.end_date)
      .reduce((sum, row) => sum + row.spend, 0);
    const actualSpend = resolveSprintActualSpend(sprint, metaSpendSum);

    return computeSprintFinancials(sprint, actualSpend, today, sprint.spend_source);
  });

  const monthPlanned = sprintFinancials.reduce((sum, sprint) => sum + sprint.plannedSpend, 0);
  const monthActual = sprintFinancials.reduce((sum, sprint) => sum + sprint.actualSpend, 0);
  const monthStatus = classifySpendStatus(monthActual, monthPlanned, monthPlanned);
  const projection = computeMonthProjection(monthPlanned, monthActual, today);
  const currentSprint = sprintFinancials.find((sprint) => sprint.temporalStatus === "atual") ?? null;

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
    ? formatLastActivityLabel(sprintLastActivityDate ?? new Date(`${currentSprint.startDate}T00:00:00Z`), today)
    : null;

  const chartPoints = computeCumulativeSpendSeries(
    sprints ?? [],
    dailySpend ?? [],
    { firstDay, lastDay },
    today,
  );

  const banners = [
    error && { tone: "red", text: error },
    commentError && { tone: "red", text: commentError },
    taskError && { tone: "red", text: taskError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green"; text: string } => Boolean(banner));

  const returnTo = `/clients/${client.id}`;
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
  const openTaskSprintNumber = openTaskRow?.sprint_id
    ? sprintFinancials.findIndex((s) => s.sprintId === openTaskRow.sprint_id) + 1 || null
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

      <Section title="Sprints do mês">
        <div className="flex flex-col gap-2">
          {sprintFinancials.length > 0 ? (
            sprintFinancials.map((sprint, index) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                sprintNumber={index + 1}
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
          sprintNumber={openTaskSprintNumber}
          comments={taskCommentsById.get(openTask.id) ?? []}
          closeHref={returnTo}
          returnTo={returnTo}
        />
      )}
    </div>
  );
}
