import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { orderTasks } from "./task-list";
import { TaskRow, type TaskListItem } from "./task-row";

export function SprintTaskList({
  tasks,
  clientId,
  sprintId,
  buildTaskHref,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente (a
   * própria página do cliente vs. o painel Sprints, preservando filtros/mês/
   * modo) — por isso quem chama decide a URL. Omitir preserva o link direto
   * pra página do cliente, de sempre. */
  buildTaskHref?: (taskId: string) => string;
}) {
  const ordered = orderTasks(tasks);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = tasks.length > 0 ? (tasksDone / tasks.length) * 100 : 0;

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tarefas da sprint
        </p>
        <div className="flex shrink-0 items-center gap-2.5">
          {tasks.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {tasksDone} de {tasks.length} concluída{tasks.length !== 1 ? "s" : ""}
            </p>
          )}
          <Link
            href={`/clients/${clientId}/tasks/new?sprintId=${sprintId}`}
            className="text-xs text-zinc-500 hover:underline"
          >
            + Tarefa
          </Link>
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
          />
        </div>
      )}

      {ordered.length > 0 ? (
        <ul className="mt-2 overflow-hidden rounded-lg border border-border">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientId={clientId}
              detailsHref={buildTaskHref ? buildTaskHref(task.id) : `/clients/${clientId}?task=${task.id}`}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Nenhuma tarefa vinculada a esta sprint ainda.</p>
      )}
    </div>
  );
}
