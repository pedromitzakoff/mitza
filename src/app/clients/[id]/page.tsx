import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { computeSprintFinancials, currentMonthRange } from "@/lib/sprint-financials";
import { syncClientMetaAction } from "../meta-actions";
import { SprintCard } from "../sprint-card";
import { TaskList } from "../task-list";
import type { CommentItem } from "../comment-thread";

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

  const [{ data: sprints }, { data: dailySpend }] = await Promise.all([
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
  ]);

  const sprintFinancials = (sprints ?? []).map((sprint) => {
    const actualSpend = (dailySpend ?? [])
      .filter((row) => row.date >= sprint.start_date && row.date <= sprint.end_date)
      .reduce((sum, row) => sum + row.spend, 0);

    return computeSprintFinancials(sprint, actualSpend);
  });

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, type, due_date, status, assignee:profiles!tasks_assignee_id_fkey(name)")
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            {client.name}
          </h1>
          <p className="font-mono text-sm text-zinc-500">{client.meta_ad_account_id}</p>
        </div>

        {profile?.role === "admin" && (
          <Link
            href={`/clients/${client.id}/edit`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Editar
          </Link>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {synced && (
        <p className="mt-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {synced} dia(s) de spend sincronizado(s) com o Meta.
        </p>
      )}
      {commentError && (
        <p className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {commentError}
        </p>
      )}

      <form action={syncClientMetaAction.bind(null, client.id)} className="mt-6">
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Atualizar dados do Meta
        </button>
      </form>

      <section className="mt-8">
        <h2 className="text-lg font-medium text-black dark:text-zinc-50">
          Financeiro por sprint
        </h2>

        <div className="mt-4 flex flex-col gap-4">
          {sprintFinancials.length > 0 ? (
            sprintFinancials.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={client.id}
              />
            ))
          ) : (
            <p className="text-sm text-zinc-500">Nenhuma sprint neste mês ainda.</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-black dark:text-zinc-50">Tarefas</h2>
          <Link
            href={`/clients/${client.id}/tasks/new`}
            className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            + Nova tarefa
          </Link>
        </div>

        {taskError && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {taskError}
          </p>
        )}

        <div className="mt-4">
          <TaskList tasks={tasks ?? []} clientId={client.id} commentsByTaskId={taskCommentsById} />
        </div>
      </section>
    </div>
  );
}
