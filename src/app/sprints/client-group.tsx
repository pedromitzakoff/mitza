import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { effectiveTaskStatus } from "@/lib/task-status";
import { TaskRow } from "@/app/clients/task-row";
import { orderTasks } from "@/app/clients/task-list";
import type { AttentionAlert } from "@/lib/attention-alerts";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import type { OperationClientCard as OperationClientCardData, OperationMode } from "@/app/operation/operation-data";
import { SprintFinancialBar } from "@/app/clients/sprint-financial-bar";

/** Cor discreta (texto, não badge) pro rótulo de última atividade — só
 * chama atenção quando ultrapassa a regra de inatividade já existente. */
const ACTIVITY_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
};

/** Linha compacta de alertas — 1 ícone + o alerta mais prioritário (os
 * alertas já vêm ordenados por severidade de buildAttentionAlerts, então
 * `alerts[0]` já é o mais prioritário sem recalcular nada) + quantos
 * restam. Vermelho só quando esse alerta é crítico (seção 9: não competir
 * com várias cores). Reaproveitada no resumo (sempre visível, sem clique)
 * e no toggle "Ver alertas" dentro do corpo expandido. */
function AlertsSummaryLine({ topAlert, remaining }: { topAlert: AttentionAlert; remaining: number }) {
  const isCritical = topAlert.severity === "critico";
  return (
    <>
      <TriangleAlert
        className={`h-3 w-3 shrink-0 ${isCritical ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className={isCritical ? "font-medium text-red-600 dark:text-red-400" : ""}>{topAlert.message}</span>
      {remaining > 0 && <span>· +{remaining} alerta{remaining !== 1 ? "s" : ""}</span>}
    </>
  );
}

/**
 * Grupo colapsável por cliente na tela Sprints — cabeçalho compacto
 * (identidade, gestor principal, sprint, financeiro, progresso, última
 * atividade, resumo de alertas), sem badge de saúde ao lado do nome: a
 * prioridade já aparece na ordenação (sortSprintClientsByUrgency). Inicia
 * sempre recolhido — o foco é deixar o usuário escanear a carteira e
 * escolher o que expandir, não abrir tudo por padrão. Os alertas ficam
 * resumidos numa linha (ícone + alerta mais prioritário + "+N"); a lista
 * completa só aparece se o usuário clicar "Ver alertas", num <details>
 * aninhado independente da expansão do cliente. Reaproveita
 * buildOperationClientCard — nenhuma query nova por cliente.
 */
export function SprintClientGroup({
  card,
  mode,
  returnTo,
  primaryManagerName,
}: {
  card: OperationClientCardData;
  mode: OperationMode;
  returnTo: string;
  primaryManagerName: string | null;
}) {
  const tasksToShow = orderTasks(mode === "hoje" ? card.todayAndOverdueTasks : mode === "sprint" ? card.sprintTasks : []);

  const sprintTasksDone = card.sprintTasks.filter((t) => effectiveTaskStatus(t) === "feito").length;
  const sprintTasksOverdue = card.sprintTasks.filter((t) => effectiveTaskStatus(t) === "atrasado").length;

  const topAlert = card.alerts[0];
  const remainingAlerts = card.alerts.length - 1;
  const activityLabel = card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel;

  return (
    <details className="group/client rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground transition-transform group-open/client:rotate-90">
          ▸
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <Link href={`/clients/${card.clientId}`} className="font-bold text-foreground hover:underline">
              {card.clientName}
            </Link>
            {primaryManagerName && (
              <span className="shrink-0 text-xs text-muted-foreground">{primaryManagerName}</span>
            )}
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {card.sprint
              ? `Sprint ${card.sprintNumber} · ${formatDateRange(card.sprint.startDate, card.sprint.endDate)}`
              : "Sem sprint em andamento"}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {card.sprint && (
              <span className="tabular-nums">
                {formatCurrency(card.sprint.actualSpend)} / {formatCurrency(card.sprint.plannedSpend)}
                {card.sprint.plannedSpend > 0 && ` · ${Math.round(card.sprint.progressPct)}%`}
              </span>
            )}
            {card.sprint && (
              <span>
                {sprintTasksDone}/{card.sprintTasks.length} tarefas
                {sprintTasksOverdue > 0 && (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {" "}
                    · {sprintTasksOverdue} atrasada{sprintTasksOverdue !== 1 ? "s" : ""}
                  </span>
                )}
              </span>
            )}
            <span className={ACTIVITY_TEXT_CLASSES[card.activityStatus]}>Última atividade: {activityLabel}</span>
          </div>

          {card.sprint && (
            <div className="mt-1">
              <SprintFinancialBar sprint={card.sprint} />
            </div>
          )}

          {topAlert && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
            </div>
          )}
        </div>
      </summary>

      <div className="border-t border-border p-3">
        {topAlert && (
          <details className="group/alerts mb-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
              <span className="ml-auto shrink-0 font-medium text-brand">
                <span className="group-open/alerts:hidden">{card.alerts.length > 1 ? "Ver todos" : "Ver detalhe"}</span>
                <span className="hidden group-open/alerts:inline">Ocultar alertas</span>
              </span>
            </summary>
            <ul className="mt-1.5 flex flex-col gap-0.5 border-l-2 border-border pl-2">
              {card.alerts.map((alert, index) => (
                <li
                  key={index}
                  className={`text-xs leading-tight ${
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
          </details>
        )}

        {mode !== "todos" &&
          (tasksToShow.length > 0 ? (
            <ul className="overflow-hidden rounded-lg border border-border">
              {tasksToShow.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  clientId={card.clientId}
                  detailsHref={`${returnTo}&task=${task.id}`}
                  hideAssigneeIfName={primaryManagerName ?? undefined}
                />
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
