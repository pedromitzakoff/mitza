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

/**
 * Linha densa de tarefa (padrão de lista de ferramentas de gestão de
 * trabalho) — status como um círculo clicável no início, título, responsável,
 * prazo e situação numa linha só, ações secundárias reveladas no hover (ou
 * foco, pra manter navegação por teclado). Reaproveitada em TaskList (tarefas
 * soltas) e SprintTaskList (tarefas da sprint) — nenhuma mudou de query nem
 * de regra de negócio, só a apresentação.
 */
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

  const dateClasses = isOverdue
    ? "font-medium text-red-600 dark:text-red-400"
    : isToday && !isDone
      ? "font-medium text-brand"
      : "text-muted-foreground";

  return (
    <li className="group/row border-b border-border/60 px-2 py-1.5 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <div className={`flex items-center gap-2.5 ${isFuture ? "opacity-70" : ""}`}>
        {isDone ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] leading-none text-green-700 dark:bg-green-950 dark:text-green-300">
            ✓
          </span>
        ) : (
          <form action={completeTaskAction.bind(null, task.id, clientId)}>
            <button
              type="submit"
              aria-label="Marcar como feito"
              title="Marcar como feito"
              className={`block h-4 w-4 shrink-0 rounded-full border-2 hover:border-brand hover:bg-brand/10 ${
                isOverdue
                  ? "border-red-400 dark:border-red-700"
                  : isToday
                    ? "border-brand"
                    : "border-zinc-300 dark:border-zinc-600"
              }`}
            />
          </form>
        )}

        <span className="min-w-0 flex-1 truncate">
          <span className={`text-sm ${isDone ? "text-muted-foreground line-through" : "font-medium text-foreground"}`}>
            {task.title}
          </span>
          <span className="ml-1.5 hidden text-xs text-muted-foreground lg:inline">{TASK_TYPE_LABEL[task.type]}</span>
        </span>

        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground md:block">
          {task.assignee?.name ?? "Sem responsável"}
        </span>

        <span className={`w-20 shrink-0 text-xs sm:w-28 ${dateClasses}`}>
          <span className="hidden sm:inline">{dueDate.long}</span>
          <span className="sm:hidden">{dueDate.short}</span>
        </span>

        <span className="hidden w-16 shrink-0 sm:block">
          {isToday && !isDone ? (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">Hoje</span>
          ) : (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[effectiveStatus]}`}
            >
              {TASK_STATUS_LABEL[effectiveStatus]}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2 opacity-100 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/row:opacity-100">
          <Link
            href={`/clients/${clientId}/tasks/${task.id}/edit`}
            className="text-xs text-muted-foreground hover:text-brand hover:underline"
          >
            Editar
          </Link>
        </span>
      </div>

      <details className="[&_summary]:cursor-pointer [&_summary]:list-none">
        <summary className="ml-[26px] mt-1 text-xs text-muted-foreground hover:text-brand">
          Comentários {comments.length > 0 ? `(${comments.length})` : ""}
        </summary>
        <div className="ml-[26px]">
          <CommentThread comments={comments} commentableType="task" commentableId={task.id} clientId={clientId} />
        </div>
      </details>
    </li>
  );
}
