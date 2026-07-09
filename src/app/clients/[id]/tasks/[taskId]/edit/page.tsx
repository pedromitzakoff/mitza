import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { updateTaskAction } from "../../../../tasks-actions";
import { TASK_RECURRENCE_LABEL, TASK_TYPE_LABEL } from "../../../../task-labels";

export default async function EditTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; taskId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, taskId } = await params;
  const { error } = await searchParams;

  const supabase = await createSupabaseClient();

  // RLS garante que só quem tem acesso ao cliente (admin ou gestor
  // atribuído) recebe a tarefa; sem acesso, o select não retorna linha.
  const [{ data: task }, { data: managers }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, client_id, title, type, assignee_id, due_date, recurrence, notes")
      .eq("id", taskId)
      .eq("client_id", id)
      .single(),
    supabase
      .from("client_managers")
      .select("profiles(id, name)")
      .eq("client_id", id),
  ]);

  if (!task) notFound();

  const assignees = (managers ?? []).flatMap((m) => (m.profiles ? [m.profiles] : []));

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <Link href={`/clients/${id}`} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Editar tarefa
      </h1>

      <form
        action={updateTaskAction.bind(null, task.id, id)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Título
          <input
            name="title"
            required
            defaultValue={task.title}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Tipo
          <select
            name="type"
            defaultValue={task.type}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Responsável
          <select
            name="assignee_id"
            defaultValue={task.assignee_id ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">Sem responsável</option>
            {assignees.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Prazo
          <input
            name="due_date"
            type="date"
            required
            defaultValue={task.due_date}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Recorrência
          <select
            name="recurrence"
            defaultValue={task.recurrence}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {Object.entries(TASK_RECURRENCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Observações
          <textarea
            name="notes"
            rows={3}
            defaultValue={task.notes ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <button
          type="submit"
          className="mt-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Salvar
        </button>
      </form>
    </div>
  );
}
