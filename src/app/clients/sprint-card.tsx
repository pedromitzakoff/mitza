import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency, formatDateRange, formatWeekdayAndDayMonth } from "@/lib/format";
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
  dentro: "text-foreground",
  acima: "text-red-600 dark:text-red-400",
  abaixo: "text-amber-600 dark:text-amber-400",
  sem_meta: "text-foreground",
} as const;

const EXECUTION_LABEL_CLASSES: Record<"atencao" | "critico" | "neutro", string> = {
  neutro: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  critico: "text-red-600 dark:text-red-400",
};

export function SprintCard({
  sprint,
  sprintNumber,
  comments,
  clientId,
  isAdmin,
  tasks,
  commentsByTaskId,
  executionLabel,
  executionSeverity,
}: {
  sprint: SprintFinancials;
  sprintNumber: number;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  commentsByTaskId: Map<string, CommentItem[]>;
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
}) {
  const difference = sprint.actualSpend - sprint.plannedSpend;
  const barWidth = Math.min(Math.max(sprint.progressPct, 0), 100);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;

  const isCurrent = sprint.temporalStatus === "atual";
  const editToggleId = `edit-planned-${sprint.sprintId}`;

  return (
    <details
      id={`sprint-${sprint.sprintId}`}
      open={isCurrent}
      className={`group scroll-mt-4 rounded-lg border bg-card [&_summary::-webkit-details-marker]:hidden ${
        isCurrent ? "border-l-4 border-l-brand border-y-border border-r-border" : "border-border"
      }`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="shrink-0 text-sm font-semibold text-foreground">Sprint {sprintNumber}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDateRange(sprint.startDate, sprint.endDate)}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TEMPORAL_BADGE_CLASSES[sprint.temporalStatus]}`}
        >
          {TEMPORAL_LABEL[sprint.temporalStatus]}
        </span>

        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {formatCurrency(sprint.actualSpend)} / {formatCurrency(sprint.plannedSpend)}
          </span>
          <span className="hidden tabular-nums sm:inline">{Math.round(sprint.progressPct)}%</span>
          <span className="hidden sm:inline">
            {tasksDone}/{tasks.length} tarefas
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[sprint.status]}`}
          >
            {SPEND_STATUS_LABEL[sprint.status]}
          </span>
        </span>
      </summary>

      <div className="border-t border-border p-3">
        {isCurrent && (
          <div className="mb-3 inline-flex flex-col rounded-md border border-brand/30 bg-brand/5 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-brand">Hoje</span>
            <span className="text-sm font-medium text-brand">{formatWeekdayAndDayMonth(todayUTC())}</span>
          </div>
        )}
        {isCurrent && executionLabel && (
          <p className={`mb-3 text-xs ${EXECUTION_LABEL_CLASSES[executionSeverity ?? "neutro"]}`}>
            Última execução da sprint: {executionLabel}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Planejado
            </p>
            {isAdmin ? (
              <>
                <input type="checkbox" id={editToggleId} className="peer hidden" />
                <div className="mt-0.5 flex items-center gap-1.5 peer-checked:hidden">
                  <p className="text-base font-semibold text-foreground">
                    {formatCurrency(sprint.plannedSpend)}
                  </p>
                  <label
                    htmlFor={editToggleId}
                    className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                  >
                    Editar
                  </label>
                </div>
                <form
                  action={updateSprintPlannedSpendAction.bind(null, sprint.sprintId, clientId)}
                  className="mt-1 hidden items-center gap-1.5 peer-checked:flex"
                >
                  <input
                    name="planned_spend"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={sprint.plannedSpend}
                    className="w-24 rounded-md border border-border px-2 py-1 text-xs text-foreground outline-none focus:border-zinc-500 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Salvar
                  </button>
                  <label
                    htmlFor={editToggleId}
                    className="cursor-pointer text-[11px] text-muted-foreground hover:underline"
                  >
                    Cancelar
                  </label>
                </form>
              </>
            ) : (
              <p className="mt-0.5 text-base font-semibold text-foreground">
                {formatCurrency(sprint.plannedSpend)}
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Gasto real
            </p>
            <p className="mt-0.5 text-base font-semibold text-foreground">
              {formatCurrency(sprint.actualSpend)}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Diferença
            </p>
            <p className={`mt-0.5 text-base font-semibold ${DIFFERENCE_TEXT_CLASSES[sprint.status]}`}>
              {difference > 0 ? "+" : ""}
              {formatCurrency(difference)}
            </p>
          </div>
        </div>

        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${PROGRESS_BAR_CLASSES[sprint.status]}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

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
