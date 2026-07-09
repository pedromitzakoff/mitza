import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { computeSprintFinancials, currentMonthRange } from "@/lib/sprint-financials";
import { computeCumulativeSpendSeries } from "@/lib/spend-chart-data";
import { computeMonthProjection, computeTaskCounts } from "@/lib/client-metrics";
import { classifySpendStatus } from "@/lib/spend-status";
import { buildAttentionAlerts, computeAccountHealth } from "@/lib/attention-alerts";
import { effectiveTaskStatus } from "@/lib/task-status";
import { ClientHeader } from "../client-header";
import { ClientMetricsCards } from "../client-metrics-cards";
import { AttentionPanel } from "../attention-panel";
import { SpendChart } from "../spend-chart";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";

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
    taskError?: string;
    commentError?: string;
  }>;
}) {
  const { id } = await params;
  const { error, synced, taskError, commentError } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!client) notFound();

  const { firstDay, lastDay } = currentMonthRange();
  const today = new Date();

  const [{ data: sprints }, { data: dailySpend }, { data: lastSync }, { data: managers }] =
    await Promise.all([
      supabase
        .from("sprints")
        .select("id, start_date, end_date, planned_spend")
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
      supabase.from("client_managers").select("profiles(name)").eq("client_id", id),
    ]);

  const sprintFinancials = (sprints ?? []).map((sprint) => {
    const actualSpend = (dailySpend ?? [])
      .filter((row) => row.date >= sprint.start_date && row.date <= sprint.end_date)
      .reduce((sum, row) => sum + row.spend, 0);

    return computeSprintFinancials(sprint, actualSpend, today);
  });

  const monthPlanned = sprintFinancials.reduce((sum, sprint) => sum + sprint.plannedSpend, 0);
  const monthActual = sprintFinancials.reduce((sum, sprint) => sum + sprint.actualSpend, 0);
  const monthStatus = classifySpendStatus(monthActual, monthPlanned, monthPlanned);
  const projection = computeMonthProjection(monthPlanned, monthActual, today);
  const currentSprint = sprintFinancials.find((sprint) => sprint.temporalStatus === "atual") ?? null;

  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, type, due_date, status, sprint_id, assignee:profiles!tasks_assignee_id_fkey(name)",
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

  const alerts = buildAttentionAlerts({
    monthStatus,
    overdueTasksCount: taskCounts.overdue,
    optimizationRecentlyDone,
    lastSyncedAt: lastSync?.synced_at ?? null,
    currentSprintPlannedSpend: currentSprint?.plannedSpend ?? null,
    currentSprintTaskCount: currentSprintTasks.length,
    currentSprintUnassignedCount: currentSprintTasks.filter((task) => !task.assignee).length,
    now: today,
  });
  const accountHealth = computeAccountHealth(alerts);

  const chartPoints = computeCumulativeSpendSeries(
    sprints ?? [],
    dailySpend ?? [],
    { firstDay, lastDay },
    today,
  );

  const managerNames = (managers ?? []).flatMap((m) => (m.profiles ? [m.profiles.name] : []));

  const banners = [
    error && { tone: "red", text: error },
    commentError && { tone: "red", text: commentError },
    taskError && { tone: "red", text: taskError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
  ].filter((banner): banner is { tone: "red" | "green"; text: string } => Boolean(banner));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <div className="mt-3">
        <ClientHeader
          clientId={client.id}
          clientName={client.name}
          metaAdAccountId={client.meta_ad_account_id}
          managerNames={managerNames}
          health={accountHealth}
          lastSyncedAt={lastSync?.synced_at ?? null}
          isAdmin={isAdmin}
        />
      </div>

      {banners.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
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

      <div className="mt-4">
        <ClientMetricsCards
          monthPlanned={monthPlanned}
          monthActual={monthActual}
          projection={projection}
          taskCounts={taskCounts}
          health={accountHealth}
        />
      </div>

      <div className="mt-4">
        <AttentionPanel alerts={alerts} />
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">
          Planejado acumulado x gasto real acumulado
        </h2>
        <div className="mt-3">
          <SpendChart points={chartPoints} />
        </div>
      </div>

      <Section title="Sprints do mês">
        <div className="flex flex-col gap-3">
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
                commentsByTaskId={taskCommentsById}
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
        <TaskList tasks={unlinkedTasks} clientId={client.id} commentsByTaskId={taskCommentsById} />
      </Section>
    </div>
  );
}
