import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { formatWeekdayAndDate } from "@/lib/format";
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

export function formatDueDate(value: string): string {
  return dueDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function TaskRow({
  task,
  clientId,
  comments,
}: {
  task: TaskListItem;
  clientId: string;
  comments: CommentItem[];
}) {
  const effectiveStatus = effectiveTaskStatus(task);
  const isDone = effectiveStatus === "feito";
  const isOverdue = effectiveStatus === "atrasado";
  const isToday = task.due_date === todayDateString();
  const isFuture = effectiveStatus === "pendente" && !isToday && task.due_date > todayDateString();
  const dueDate = formatWeekdayAndDate(task.due_date);

  const borderClasses = isOverdue
    ? "border-red-200 dark:border-red-900"
    : isToday && !isDone
      ? "border-brand/40"
      : "border-zinc-200 dark:border-zinc-800";

  const dateClasses = isOverdue
    ? "text-red-600 dark:text-red-400"
    : isToday && !isDone
      ? "text-brand"
      : isDone
        ? "font-normal text-zinc-400 dark:text-zinc-600"
        : "text-foreground";

  return (
    <li className={`rounded-lg border p-3 ${borderClasses} ${isFuture ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-sm font-medium ${
              isDone ? "text-zinc-500 line-through dark:text-zinc-500" : "text-black dark:text-zinc-50"
            }`}
          >
            {isDone && <span className="mr-1 text-green-600 dark:text-green-400">✓</span>}
            {task.title}
          </p>
          <p className={`mt-0.5 text-sm font-semibold ${dateClasses}`}>
            <span className="hidden sm:inline">{dueDate.long}</span>
            <span className="sm:hidden">{dueDate.short}</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {TASK_TYPE_LABEL[task.type]} · {task.assignee?.name ?? "Sem responsável"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isToday && !isDone && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              Hoje
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[effectiveStatus]}`}
          >
            {TASK_STATUS_LABEL[effectiveStatus]}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs">
        <Link
          href={`/clients/${clientId}/tasks/${task.id}/edit`}
          className="text-zinc-500 hover:underline"
        >
          Editar
        </Link>
        {!isDone && (
          <form action={completeTaskAction.bind(null, task.id, clientId)}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Marcar como feito
            </button>
          </form>
        )}
      </div>

      <details className="mt-1.5 [&_summary]:cursor-pointer">
        <summary className="text-xs text-zinc-500 hover:underline">
          Comentários {comments.length > 0 ? `(${comments.length})` : ""}
        </summary>
        <CommentThread
          comments={comments}
          commentableType="task"
          commentableId={task.id}
          clientId={clientId}
        />
      </details>
    </li>
  );
}
