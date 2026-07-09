import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { computeSprintFinancials, currentMonthRange } from "@/lib/sprint-financials";
import {
  classifySpendStatus,
  SPEND_STATUS_BADGE_CLASSES,
  SPEND_STATUS_LABEL,
} from "@/lib/spend-status";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { syncClientMetaAction } from "../meta-actions";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import { Section } from "../section";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";

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
  const supabase = await createSupabaseClient();

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { firstDay, lastDay } = currentMonthRange();

  const [{ data: sprints }, { data: dailySpend }, { data: lastSync }] = await Promise.all([
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
  ]);

  const sprintFinancials = (sprints ?? []).map((sprint) => {
    const actualSpend = (dailySpend ?? [])
      .filter((row) => row.date >= sprint.start_date && row.date <= sprint.end_date)
      .reduce((sum, row) => sum + row.spend, 0);

    return computeSprintFinancials(sprint, actualSpend);
  });

  const monthPlanned = sprintFinancials.reduce((sum, sprint) => sum + sprint.plannedSpend, 0);
  const monthActual = sprintFinancials.reduce((sum, sprint) => sum + sprint.actualSpend, 0);
  const monthStatus = classifySpendStatus(monthActual, monthPlanned);
  const monthPct = monthPlanned > 0 ? (monthActual / monthPlanned) * 100 : null;

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

  const banners = [
    error && { tone: "red", text: error },
    commentError && { tone: "red", text: commentError },
    taskError && { tone: "red", text: taskError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
  ].filter((banner): banner is { tone: "red" | "green"; text: string } => Boolean(banner));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            {client.name}
          </h1>
          <p className="font-mono text-sm text-zinc-500">{client.meta_ad_account_id}</p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {profile?.role === "admin" && (
              <Link
                href={`/clients/${client.id}/edit`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                Editar
              </Link>
            )}
            <form action={syncClientMetaAction.bind(null, client.id)}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                Atualizar dados do Meta
              </button>
            </form>
          </div>
          {lastSync && (
            <p className="text-xs text-zinc-400">
              Última sync: {formatDateTime(lastSync.synced_at)}
            </p>
          )}
        </div>
      </div>

      {banners.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
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

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Resumo do mês</p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            Planejado {formatCurrency(monthPlanned)} · Gasto {formatCurrency(monthActual)}
            {monthPct !== null && ` · ${monthPct.toFixed(0)}% atingido`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${SPEND_STATUS_BADGE_CLASSES[monthStatus]}`}
        >
          {SPEND_STATUS_LABEL[monthStatus]}
        </span>
      </div>

      <Section title="Financeiro por sprint">
        <div className="flex flex-col gap-4">
          {sprintFinancials.length > 0 ? (
            sprintFinancials.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={client.id}
                isAdmin={profile?.role === "admin"}
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
            className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
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
