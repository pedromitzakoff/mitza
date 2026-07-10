import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency, formatDateRange, formatWeekdayAndDayMonth } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayUTC } from "@/lib/today";
import { CommentThread, type CommentItem } from "./comment-thread";
import { SprintTaskList } from "./sprint-task-list";
import type { TaskListItem } from "./task-row";
import {
  resetSprintSpendSourceAction,
  updateSprintActualSpendAction,
  updateSprintPlannedSpendAction,
} from "./sprint-actions";
import { MoneyInput } from "./money-input";
import { SprintFinancialBar } from "./sprint-financial-bar";

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
  executionLabel,
  executionSeverity,
}: {
  sprint: SprintFinancials;
  sprintNumber: number;
  comments: CommentItem[];
  clientId: string;
  isAdmin: boolean;
  tasks: TaskListItem[];
  executionLabel?: string | null;
  executionSeverity?: "atencao" | "critico" | null;
}) {
  const saldo = sprint.plannedSpend - sprint.actualSpend;
  const saldoText =
    saldo > 0
      ? `${formatCurrency(saldo)} restantes`
      : saldo === 0
        ? "Planejamento atingido"
        : `${formatCurrency(Math.abs(saldo))} acima do planejado`;
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;

  const isCurrent = sprint.temporalStatus === "atual";
  const editPlannedToggleId = `edit-planned-${sprint.sprintId}`;
  const editActualToggleId = `edit-actual-${sprint.sprintId}`;
  const revertSourceToggleId = `revert-source-${sprint.sprintId}`;
  const isManualSource = sprint.spendSource === "manual";

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

        <div className="rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Investimento planejado
              </p>
              {isAdmin ? (
                <>
                  <input type="checkbox" id={editPlannedToggleId} className="peer hidden" />
                  <div className="mt-0.5 flex items-center gap-1.5 peer-checked:hidden">
                    <p className="text-base font-semibold text-foreground">
                      {formatCurrency(sprint.plannedSpend)}
                    </p>
                    <label
                      htmlFor={editPlannedToggleId}
                      className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                    >
                      Editar
                    </label>
                  </div>
                  <form
                    action={updateSprintPlannedSpendAction.bind(null, sprint.sprintId, clientId)}
                    className="mt-1 hidden flex-wrap items-center gap-1.5 peer-checked:flex"
                  >
                    <MoneyInput name="planned_spend" defaultValue={sprint.plannedSpend} autoFocus />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Salvar
                    </button>
                    <label
                      htmlFor={editPlannedToggleId}
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
              {isAdmin ? (
                <>
                  <input type="checkbox" id={editActualToggleId} className="peer hidden" />
                  <div className="mt-0.5 flex items-center gap-1.5 peer-checked:hidden">
                    <p className="text-base font-semibold text-foreground">
                      {formatCurrency(sprint.actualSpend)}
                    </p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 peer-checked:hidden">
                    <label
                      htmlFor={editActualToggleId}
                      className="cursor-pointer text-[11px] font-medium text-brand hover:underline"
                    >
                      Editar
                    </label>
                    <span
                      className="text-[11px] text-muted-foreground"
                      title={isManualSource ? "Valor digitado manualmente" : "Valor sincronizado do Meta"}
                    >
                      · {isManualSource ? "Manual" : "Meta"}
                    </span>
                  </div>
                  {isManualSource && (
                    <div className="mt-0.5 peer-checked:hidden">
                      <input type="checkbox" id={revertSourceToggleId} className="peer/revert hidden" />
                      <label
                        htmlFor={revertSourceToggleId}
                        className="cursor-pointer text-[11px] text-muted-foreground hover:underline peer-checked/revert:hidden"
                      >
                        Usar dado do Meta
                      </label>
                      <div className="hidden items-center gap-1.5 peer-checked/revert:flex">
                        <span className="text-[11px] text-muted-foreground">Substituir valor manual pelo do Meta?</span>
                        <form action={resetSprintSpendSourceAction.bind(null, sprint.sprintId, clientId)}>
                          <button
                            type="submit"
                            className="text-[11px] font-medium text-brand hover:underline"
                          >
                            Confirmar
                          </button>
                        </form>
                        <label
                          htmlFor={revertSourceToggleId}
                          className="cursor-pointer text-[11px] text-muted-foreground hover:underline"
                        >
                          Cancelar
                        </label>
                      </div>
                    </div>
                  )}
                  <form
                    action={updateSprintActualSpendAction.bind(null, sprint.sprintId, clientId)}
                    className="mt-1 hidden flex-wrap items-center gap-1.5 peer-checked:flex"
                  >
                    <MoneyInput name="actual_spend" defaultValue={sprint.actualSpend} autoFocus />
                    <button
                      type="submit"
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Salvar
                    </button>
                    <label
                      htmlFor={editActualToggleId}
                      className="cursor-pointer text-[11px] text-muted-foreground hover:underline"
                    >
                      Cancelar
                    </label>
                  </form>
                </>
              ) : (
                <>
                  <p className="mt-0.5 text-base font-semibold text-foreground">
                    {formatCurrency(sprint.actualSpend)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{isManualSource ? "Manual" : "Meta"}</p>
                </>
              )}
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Saldo do planejamento
              </p>
              <p className={`mt-0.5 text-base font-semibold ${DIFFERENCE_TEXT_CLASSES[sprint.status]}`}>
                {saldoText}
              </p>
            </div>
          </div>

          <div className="mt-2">
            <SprintFinancialBar actualSpend={sprint.actualSpend} plannedSpend={sprint.plannedSpend} />
            {sprint.plannedSpend > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {Math.round(sprint.progressPct)}% utilizado
              </p>
            )}
          </div>
        </div>

        <SprintTaskList tasks={tasks} clientId={clientId} sprintId={sprint.sprintId} />

        <details className="mt-3 border-t border-border pt-2 [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="text-xs font-medium text-muted-foreground hover:text-brand">
            Ver detalhes da sprint {comments.length > 0 ? `(${comments.length} comentário${comments.length !== 1 ? "s" : ""})` : ""}
          </summary>
          <div className="mt-2">
            <CommentThread
              comments={comments}
              commentableType="sprint"
              commentableId={sprint.sprintId}
              clientId={clientId}
            />
          </div>
        </details>
      </div>
    </details>
  );
}
