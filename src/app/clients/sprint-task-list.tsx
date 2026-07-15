import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { orderTasks } from "./task-list";
import { TaskRow, type TaskListItem } from "./task-row";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";

export function SprintTaskList({
  tasks,
  clientId,
  sprintId,
  buildTaskHref,
  managers,
  returnTo,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente (a
   * própria página do cliente vs. o painel Sprints, preservando filtros/mês/
   * modo) — por isso quem chama decide a URL. Omitir preserva o link direto
   * pra página do cliente, de sempre. */
  buildTaskHref?: (taskId: string) => string;
  /** Sprint UX 2.0 Fase 2 — quando informado (só a tela Sprints passa),
   * "+ Tarefa" vira um formulário inline (sem navegar pra `/tasks/new`). A
   * página do cliente não passa isto, então continua com o link de sempre. */
  managers?: InlineTaskManagerOption[];
  returnTo?: string;
}) {
  const ordered = orderTasks(tasks);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = tasks.length > 0 ? (tasksDone / tasks.length) * 100 : 0;
  const canCreateInline = managers !== undefined && returnTo !== undefined;

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tarefas da sprint
        </p>
        <div className="flex flex-wrap shrink-0 items-center gap-2.5">
          {tasks.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {tasksDone} de {tasks.length} concluída{tasks.length !== 1 ? "s" : ""}
            </p>
          )}
          {canCreateInline ? (
            <InlineCreateTaskForm
              clientId={clientId}
              sprintId={sprintId}
              managers={managers}
              returnTo={returnTo}
              toggleId={`new-task-${sprintId}`}
              defaultDueDate={todayDateString()}
            />
          ) : (
            <Link
              href={`/clients/${clientId}/tasks/new?sprintId=${sprintId}`}
              className="text-xs text-zinc-500 hover:underline"
            >
              + Tarefa
            </Link>
          )}
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
        <EmptyState size="xs" className="mt-2">Nenhuma tarefa vinculada a esta sprint ainda.</EmptyState>
      )}
    </div>
  );
}
