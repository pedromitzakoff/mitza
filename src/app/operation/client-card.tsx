import Link from "next/link";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import {
  OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES,
  OPERATIONAL_ACTIVITY_STATUS_LABEL,
} from "@/lib/operational-activity";
import { effectiveTaskStatus } from "@/lib/task-status";
import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABEL } from "@/app/clients/task-labels";
import { completeTaskAction } from "@/app/clients/tasks-actions";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { OperationClientCard as OperationClientCardData, OperationMode } from "./operation-data";

const HEALTH_LABEL: Record<AccountHealth, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critico: "Crítico",
};

const HEALTH_BADGE_CLASSES: Record<AccountHealth, string> = {
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function OperationClientCard({
  card,
  mode,
  returnTo,
}: {
  card: OperationClientCardData;
  mode: OperationMode;
  returnTo: string;
}) {
  const tasksToShow = mode === "hoje" ? card.todayAndOverdueTasks : mode === "sprint" ? card.sprintTasks : [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clients/${card.clientId}`} className="font-medium text-brand hover:underline">
              {card.clientName}
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${HEALTH_BADGE_CLASSES[card.accountHealth]}`}>
              {HEALTH_LABEL[card.accountHealth]}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES[card.activityStatus]}`}
            >
              {OPERATIONAL_ACTIVITY_STATUS_LABEL[card.activityStatus]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {card.sprint
              ? `Sprint ${card.sprintNumber} · ${formatDateRange(card.sprint.startDate, card.sprint.endDate)}`
              : "Sem sprint em andamento"}
            {" · Última atividade: "}
            {card.activityLabel}
          </p>
        </div>

        {card.sprint && (
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <p>
              {formatCurrency(card.sprint.actualSpend)} / {formatCurrency(card.sprint.plannedSpend)}
            </p>
            <span
              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[card.sprint.status]}`}
            >
              {SPEND_STATUS_LABEL[card.sprint.status]}
            </span>
          </div>
        )}
      </div>

      {card.alerts.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {card.alerts.map((alert, index) => (
            <li
              key={index}
              className={`text-xs ${
                alert.severity === "critico"
                  ? "text-red-600 dark:text-red-400"
                  : alert.severity === "atencao"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
              }`}
            >
              {alert.message}
            </li>
          ))}
        </ul>
      )}

      {mode !== "todos" ? (
        tasksToShow.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
            {tasksToShow.map((task) => {
              const status = effectiveTaskStatus(task);
              return (
                <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link
                    href={`${returnTo}&task=${task.id}`}
                    className="min-w-0 truncate text-foreground hover:underline"
                  >
                    {task.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[status]}`}
                    >
                      {TASK_STATUS_LABEL[status]}
                    </span>
                    {status !== "feito" && (
                      <form action={completeTaskAction.bind(null, task.id, card.clientId)}>
                        <input type="hidden" name="return_to" value={returnTo} />
                        <button
                          type="submit"
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          Concluir
                        </button>
                      </form>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {mode === "hoje" ? "Nada pendente pra hoje." : "Sem tarefas na sprint atual."}
          </p>
        )
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {card.taskCounts.done}/{card.taskCounts.total} tarefas concluídas
          {card.taskCounts.overdue > 0 && (
            <span className="ml-1 font-medium text-red-600 dark:text-red-400">
              · {card.taskCounts.overdue} atrasada{card.taskCounts.overdue !== 1 ? "s" : ""}
            </span>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link
          href={`/clients/${card.clientId}/tasks/new${card.sprint ? `?sprintId=${card.sprint.sprintId}` : ""}`}
          className="font-medium text-brand hover:underline"
        >
          + Nova tarefa
        </Link>
        {card.sprint && (
          <Link href={`/clients/${card.clientId}#sprint-${card.sprint.sprintId}`} className="text-muted-foreground hover:underline">
            Abrir sprint
          </Link>
        )}
        <Link href={`/clients/${card.clientId}`} className="text-muted-foreground hover:underline">
          Abrir cliente
        </Link>
      </div>
    </div>
  );
}
