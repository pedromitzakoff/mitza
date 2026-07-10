import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency, formatDateRange, formatFullDate } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayUTC } from "@/lib/today";
import { CommentThread, type CommentItem } from "./comment-thread";
import { SprintTaskList } from "./sprint-task-list";
import type { TaskListItem } from "./task-row";
import { updateSprintPlannedSpendAction } from "./sprint-actions";

const TEMPORAL_LABEL = {
  futura: "Futura",
  atual: "Sprint atual",
  concluida: "Concluída",
} as const;

const TEMPORAL_BADGE_CLASSES = {
  futura: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  atual: "bg-brand/10 text-brand",
  concluida: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
} as const;

const PROGRESS_BAR_CLASSES = {
  dentro: "bg-green-500",
  acima: "bg-red-500",
  abaixo: "bg-amber-500",
  sem_meta: "bg-zinc-300 dark:bg-zinc-700",
} as const;

const DIFFERENCE_TEXT_CLASSES = {
  dentro: "",
  acima: "text-red-600 dark:text-red-400",
  abaixo: "text-amber-600 dark:text-amber-400",
  sem_meta: "",
} as const;

export function SprintCard({
  sprint,
  sprintNumber,
  comments,
  clientId,
  isAdmin,
  tasks,
  commentsByTaskId,
  executionLabel,
}: {
  sprint: SprintFinancials;
  sprintNumber: number;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  commentsByTaskId: Map<string, CommentItem[]>;
  executionLabel?: string | null;
}) {
  const difference = sprint.actualSpend - sprint.plannedSpend;
  const barWidth = Math.min(Math.max(sprint.progressPct, 0), 100);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;

  const isCurrent = sprint.temporalStatus === "atual";

  return (
    <details
      id={`sprint-${sprint.sprintId}`}
      open={isCurrent}
      className={`group scroll-mt-4 rounded-lg border bg-card [&_summary::-webkit-details-marker]:hidden ${
        isCurrent ? "border-l-4 border-l-brand border-y-border border-r-border" : "border-border"
      }`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">
            ▸
          </span>
          <p className="text-sm font-medium text-foreground">
            Sprint {sprintNumber} · {formatDateRange(sprint.startDate, sprint.endDate)}
          </p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
          >
            {TEMPORAL_LABEL[sprint.temporalStatus]}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[sprint.status]}`}
          >
            {SPEND_STATUS_LABEL[sprint.status]}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {formatCurrency(sprint.actualSpend)} / {formatCurrency(sprint.plannedSpend)}
          </span>
          <span>
            {tasksDone}/{tasks.length} tarefas
          </span>
        </div>
      </summary>

      <div className="border-t border-border p-4">
        {isCurrent && (
          <p className="mb-1 text-xs font-medium text-brand">
            Hoje: {formatFullDate(todayUTC())}
          </p>
        )}
        {isCurrent && executionLabel && (
          <p className="mb-3 text-xs text-muted-foreground">
            Última execução da sprint: {executionLabel}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {isAdmin ? (
            <form
              action={updateSprintPlannedSpendAction.bind(null, sprint.sprintId, clientId)}
              className="flex items-center gap-2 text-xs text-muted-foreground"
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
                  className="w-28 rounded-md border border-border px-2 py-1 text-xs text-foreground outline-none focus:border-zinc-500 dark:bg-zinc-900"
                />
              </label>
              <button
                type="submit"
                className="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Salvar
              </button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              Planejado {formatCurrency(sprint.plannedSpend)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Gasto até agora {formatCurrency(sprint.actualSpend)}
          </p>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${PROGRESS_BAR_CLASSES[sprint.status]}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
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
    </details>
  );
}
