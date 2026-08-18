import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createTaskAction } from "../../../tasks-actions";
import { TASK_RECURRENCE_LABEL, TASK_TYPE_LABEL } from "../../../task-labels";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { SubmitButton } from "@/app/submit-button";

export default async function NewTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sprintId?: string; type?: string; return_to?: string }>;
}) {
  const { id } = await params;
  const { error, sprintId, type: typeParam, return_to: returnTo } = await searchParams;
  const defaultType = typeParam && typeParam in TASK_TYPE_LABEL ? typeParam : "outro";

  const supabase = await createSupabaseClient();

  // RLS garante que só quem tem acesso ao cliente (admin ou gestor
  // atribuído) chega até aqui; sem acesso, o select não retorna linha.
  const [{ data: client }, { data: managers }, { data: sprint }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("id", id).single(),
    supabase
      .from("client_managers")
      .select("team_members(id, name)")
      .eq("client_id", id),
    sprintId
      ? supabase
          .from("sprints")
          .select("id, start_date, end_date")
          .eq("id", sprintId)
          .eq("client_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!client) notFound();

  const assignees = (managers ?? []).flatMap((m) => (m.team_members ? [m.team_members] : []));

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <Link href={`/clients/${id}`} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Nova tarefa · {client.name}
      </h1>
      {sprint && (
        <p className="text-sm text-zinc-500">
          Vinculada à semana {formatSprintPeriodLabel(sprint.start_date, sprint.end_date)}
        </p>
      )}

      <form
        action={createTaskAction.bind(null, id)}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {sprint && <input type="hidden" name="sprint_id" value={sprint.id} />}
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Título
          <input
            name="title"
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Tipo
          <select
            name="type"
            defaultValue={defaultType}
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
            defaultValue=""
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
            defaultValue={sprint?.start_date}
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Horário <span className="text-xs text-zinc-400">(opcional)</span>
          <input
            name="due_time"
            type="time"
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Recorrência
          <select
            name="recurrence"
            defaultValue="nenhuma"
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>

        <SubmitButton
          pendingChildren="Criando..."
          className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Criar tarefa
        </SubmitButton>
      </form>
    </div>
  );
}
