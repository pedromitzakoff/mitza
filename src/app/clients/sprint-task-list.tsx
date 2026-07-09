import Link from "next/link";
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
