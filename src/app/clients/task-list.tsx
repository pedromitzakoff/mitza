import { effectiveTaskStatus } from "@/lib/task-status";
import { TaskRow, type TaskListItem } from "./task-row";

export type { TaskListItem };

export function orderTasks(tasks: TaskListItem[]): TaskListItem[] {
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

  return [...pending, ...done];
}

export function TaskList({ tasks, clientId }: { tasks: TaskListItem[]; clientId: string }) {
  const ordered = orderTasks(tasks);

  if (ordered.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma tarefa ainda.</p>;
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-border">
      {ordered.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          clientId={clientId}
          detailsHref={`/clients/${clientId}?task=${task.id}`}
        />
      ))}
    </ul>
  );
}
