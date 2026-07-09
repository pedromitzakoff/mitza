import { effectiveTaskStatus } from "@/lib/task-status";
import type { TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from "./task-labels";
import { completeTaskAction } from "./tasks-actions";
import { CommentThread, type CommentItem } from "./comment-thread";

export interface TaskListItem {
  id: string;
  title: string;
  type: TaskType;
  due_date: string;
  status: TaskStatus;
  assignee: { name: string } | null;
}

const dueDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function formatDueDate(value: string): string {
  return dueDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function TaskList({
  tasks,
  clientId,
  commentsByTaskId,
}: {
  tasks: TaskListItem[];
  clientId: string;
  commentsByTaskId: Map<string, CommentItem[]>;
}) {
  const withStatus = tasks.map((task) => ({
    ...task,
    effectiveStatus: effectiveTaskStatus(task),
  }));

  const pending = withStatus
    .filter((task) => task.effectiveStatus !== "feito")
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const done = withStatus
    .filter((task) => task.effectiveStatus === "feito")
    .sort((a, b) => b.due_date.localeCompare(a.due_date));

  const ordered = [...pending, ...done];

  if (ordered.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma tarefa ainda.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((task) => {
        const taskComments = commentsByTaskId.get(task.id) ?? [];

        return (
          <li
            key={task.id}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-black dark:text-zinc-50">{task.title}</p>
                <p className="text-xs text-zinc-500">
                  {TASK_TYPE_LABEL[task.type]} · Prazo {formatDueDate(task.due_date)} ·{" "}
                  {task.assignee?.name ?? "Sem responsável"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${TASK_STATUS_BADGE_CLASSES[task.effectiveStatus]}`}
                >
                  {TASK_STATUS_LABEL[task.effectiveStatus]}
                </span>
                {task.effectiveStatus !== "feito" && (
                  <form action={completeTaskAction.bind(null, task.id, clientId)}>
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
                    >
                      Marcar como feito
                    </button>
                  </form>
                )}
              </div>
            </div>

            <details className="mt-2 [&_summary]:cursor-pointer">
              <summary className="text-xs text-zinc-500 hover:underline">
                Comentários {taskComments.length > 0 ? `(${taskComments.length})` : ""}
              </summary>
              <CommentThread
                comments={taskComments}
                commentableType="task"
                commentableId={task.id}
                clientId={clientId}
              />
            </details>
          </li>
        );
      })}
    </ul>
  );
}
