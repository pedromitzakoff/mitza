import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { orderTasks } from "./task-list";
import { TaskRow, type TaskListItem } from "./task-row";
import type { CommentItem } from "./comment-thread";

export function SprintTaskList({
  tasks,
  clientId,
  sprintId,
  commentsByTaskId,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  commentsByTaskId: Map<string, CommentItem[]>;
}) {
  const ordered = orderTasks(tasks);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = tasks.length > 0 ? (tasksDone / tasks.length) * 100 : 0;

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Tarefas da sprint
        </p>
        <Link
          href={`/clients/${clientId}/tasks/new?sprintId=${sprintId}`}
          className="text-xs text-zinc-500 hover:underline"
        >
          + Adicionar tarefa na sprint
        </Link>
      </div>

      {tasks.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
            />
          </div>
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {tasksDone} de {tasks.length} concluída{tasks.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {ordered.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientId={clientId}
              comments={commentsByTaskId.get(task.id) ?? []}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Nenhuma tarefa vinculada a esta sprint ainda.</p>
      )}
    </div>
  );
}
