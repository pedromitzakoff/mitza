import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { CommentThread, type CommentItem } from "./comment-thread";
import { SprintTaskList } from "./sprint-task-list";
import type { TaskListItem } from "./task-row";
import { updateSprintPlannedSpendAction } from "./sprint-actions";

const STATUS_LABEL = {
  dentro: "Dentro do esperado",
  acima: "Acima do esperado",
  abaixo: "Abaixo do esperado",
} as const;

const STATUS_BADGE_CLASSES = {
  dentro: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
} as const;

const PROGRESS_BAR_CLASSES = {
  dentro: "bg-zinc-500",
  acima: "bg-red-500",
  abaixo: "bg-amber-500",
} as const;

const DIFFERENCE_TEXT_CLASSES = {
  dentro: "",
  acima: "text-red-600 dark:text-red-400",
  abaixo: "text-amber-600 dark:text-amber-400",
} as const;

export function SprintCard({
  sprint,
  comments,
  clientId,
  isAdmin,
  tasks,
  commentsByTaskId,
}: {
  sprint: SprintFinancials;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  commentsByTaskId: Map<string, CommentItem[]>;
}) {
  const difference = sprint.actualSpend - sprint.plannedSpend;
  const barWidth = Math.min(Math.max(sprint.progressPct, 0), 100);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-black dark:text-zinc-50">
          {formatDateRange(sprint.startDate, sprint.endDate)}
        </p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[sprint.status]}`}
        >
          {STATUS_LABEL[sprint.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <form
            action={updateSprintPlannedSpendAction.bind(null, sprint.sprintId, clientId)}
            className="flex items-center gap-2 text-xs text-zinc-500"
          >
            <label className="flex items-center gap-1.5" htmlFor={`planned-${sprint.sprintId}`}>
              Planejado
              <input
                id={`planned-${sprint.sprintId}`}
                name="planned_spend"
                type="number"
                step="0.01"
                min="0"
                defaultValue={sprint.plannedSpend}
                className="w-28 rounded-md border border-zinc-300 px-2 py-1 text-xs text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2 py-1 font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Salvar
            </button>
          </form>
        ) : (
          <p className="text-xs text-zinc-500">Planejado {formatCurrency(sprint.plannedSpend)}</p>
        )}
        <p className="text-xs text-zinc-500">Gasto até agora {formatCurrency(sprint.actualSpend)}</p>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${PROGRESS_BAR_CLASSES[sprint.status]}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Diferença:{" "}
        <span className={DIFFERENCE_TEXT_CLASSES[sprint.status]}>
          {difference > 0 ? "+" : ""}
          {formatCurrency(difference)}
        </span>
      </p>

      <SprintTaskList
        tasks={tasks}
        clientId={clientId}
        sprintId={sprint.sprintId}
        commentsByTaskId={commentsByTaskId}
      />

      <CommentThread
        comments={comments}
        commentableType="sprint"
        commentableId={sprint.sprintId}
        clientId={clientId}
      />
    </div>
  );
}
