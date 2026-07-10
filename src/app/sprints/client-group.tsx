import Link from "next/link";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import {
  OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES,
  OPERATIONAL_ACTIVITY_STATUS_LABEL,
} from "@/lib/operational-activity";
import { TaskRow } from "@/app/clients/task-row";
import { orderTasks } from "@/app/clients/task-list";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { OperationClientCard as OperationClientCardData, OperationMode } from "@/app/operation/operation-data";

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

/**
 * Grupo colapsável por cliente na tela Sprints — resumo de uma linha
 * (cliente, status, financeiro da sprint) sempre visível; as tarefas (via
 * TaskRow, a mesma linha densa da página do cliente) só aparecem expandidas.
 * Reaproveita buildOperationClientCard — nenhuma query nova por cliente.
 */
export function SprintClientGroup({
  card,
  mode,
  returnTo,
}: {
  card: OperationClientCardData;
  mode: OperationMode;
  returnTo: string;
}) {
  const tasksToShow = orderTasks(mode === "hoje" ? card.todayAndOverdueTasks : mode === "sprint" ? card.sprintTasks : []);
  const needsAttention =
    card.accountHealth !== "saudavel" ||
    card.activityStatus !== "ativo" ||
    card.sprintFilterBucket === "atrasadas" ||
    card.sprintFilterBucket === "sem_execucao";
  const defaultOpen = mode !== "todos" || needsAttention;

  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-90">▸</span>

        <Link href={`/clients/${card.clientId}`} className="shrink-0 font-medium text-brand hover:underline">
          {card.clientName}
        </Link>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${HEALTH_BADGE_CLASSES[card.accountHealth]}`}>
          {HEALTH_LABEL[card.accountHealth]}
        </span>
        <span
          className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block ${OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES[card.activityStatus]}`}
        >
          {OPERATIONAL_ACTIVITY_STATUS_LABEL[card.activityStatus]}
        </span>

        <span className="hidden shrink-0 truncate text-xs text-muted-foreground md:inline">
          {card.sprint
            ? `Sprint ${card.sprintNumber} · ${formatDateRange(card.sprint.startDate, card.sprint.endDate)}`
            : "Sem sprint em andamento"}
        </span>

        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {card.sprint && (
            <>
              <span className="tabular-nums">
                {formatCurrency(card.sprint.actualSpend)} / {formatCurrency(card.sprint.plannedSpend)}
                {card.sprint.plannedSpend > 0 && ` · ${Math.round(card.sprint.progressPct)}%`}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[card.sprint.status]}`}
              >
                {SPEND_STATUS_LABEL[card.sprint.status]}
              </span>
            </>
          )}
          {mode === "todos" && (
            <span>
              {card.taskCounts.done}/{card.taskCounts.total} tarefas
              {card.taskCounts.overdue > 0 && (
                <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                  · {card.taskCounts.overdue} atrasada{card.taskCounts.overdue !== 1 ? "s" : ""}
                </span>
              )}
            </span>
          )}
        </span>
      </summary>

      <div className="border-t border-border p-3">
        {card.alerts.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1">
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

        {mode !== "todos" &&
          (tasksToShow.length > 0 ? (
            <ul className="overflow-hidden rounded-lg border border-border">
              {tasksToShow.map((task) => (
                <TaskRow key={task.id} task={task} clientId={card.clientId} detailsHref={`${returnTo}&task=${task.id}`} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {mode === "hoje" ? "Nada pendente pra hoje." : "Sem tarefas na sprint atual."}
            </p>
          ))}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <Link
            href={`/clients/${card.clientId}/tasks/new${card.sprint ? `?sprintId=${card.sprint.sprintId}` : ""}`}
            className="font-medium text-brand hover:underline"
          >
            + Nova tarefa
          </Link>
          {card.sprint && (
            <Link
              href={`/clients/${card.clientId}#sprint-${card.sprint.sprintId}`}
              className="text-muted-foreground hover:underline"
            >
              Abrir sprint
            </Link>
          )}
          <Link href={`/clients/${card.clientId}`} className="text-muted-foreground hover:underline">
            Abrir cliente
          </Link>
        </div>
      </div>
    </details>
  );
}
