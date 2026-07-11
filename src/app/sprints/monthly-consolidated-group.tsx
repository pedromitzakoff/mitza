import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import { resolveMonthPeriodSummary, computeRitmoDiff, formatRitmoDiffText } from "@/lib/financial-period";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { orderTasks } from "@/app/clients/task-list";
import { TaskRow } from "@/app/clients/task-row";
import { AlertsSummaryLine } from "@/app/clients/sprint-card";

const ACTIVITY_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
};

/**
 * Grupo por cliente na visão "Mensal > Consolidado" da tela Sprints (Etapa
 * 43) — um único bloco representando o mês inteiro, sem nenhuma referência
 * a sprints individuais: nada de "Sprint 1", "Sprint 2" aqui (isso é
 * responsabilidade exclusiva de `monthly-sprints-group.tsx`, o outro modo
 * de agrupamento). Todo valor financeiro vem de `resolveMonthPeriodSummary`
 * (mês inteiro) — nunca o de uma sprint específica. Ao expandir, mostra
 * todas as tarefas do mês numa lista cronológica só, sem separar por
 * sprint (mesmo `orderTasks`/`TaskRow` de sempre, vínculo original de cada
 * tarefa preservado — só não agrupamos visualmente por sprint aqui).
 */
export function SprintMonthlyConsolidatedGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
  returnTo,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  returnTo: string;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const activityLabel = card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel;
  const orderedTasks = orderTasks(card.monthTasks);
  const topAlert = card.alerts[0];
  const remainingAlerts = card.alerts.length - 1;

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

          <p className="mt-0.5 text-xs text-muted-foreground">{monthLabel}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(summary.actual)} / {formatCurrency(summary.planned)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {summary.pct !== null ? `${Math.round(summary.pct)}% realizado no mês` : "Sem orçamento mensal"}
            </span>
            <span>
              {card.taskCounts.done}/{card.taskCounts.total} tarefas do mês
              {card.taskCounts.overdue > 0 && (
                <span className="font-medium text-red-600 dark:text-red-400">
                  {" "}
                  · {card.taskCounts.overdue} atrasada{card.taskCounts.overdue !== 1 ? "s" : ""}
                </span>
              )}
            </span>
            <span className={ACTIVITY_TEXT_CLASSES[card.activityStatus]}>Última atividade: {activityLabel}</span>
          </div>

          {summary.planned > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatRitmoDiffText(summary)}
              {" · "}
              Diferença pro ritmo esperado no mês: {formatCurrency(diff)}
            </p>
          )}

          {topAlert && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <AlertsSummaryLine topAlert={topAlert} remaining={remainingAlerts} />
            </div>
          )}
        </div>
      </summary>

      <div className="border-t border-border p-3">
        {summary.planned > 0 && (
          <div className="mb-3 rounded-lg border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40">
            <AgencyInvestmentBar
              planned={summary.planned}
              actual={summary.actual}
              expectedToDate={summary.expectedToDate}
            />
          </div>
        )}

        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tarefas do mês
        </p>
        {orderedTasks.length > 0 ? (
          <ul className="overflow-hidden rounded-lg border border-border">
            {orderedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                clientId={card.clientId}
                detailsHref={`${returnTo}&task=${task.id}`}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma tarefa neste mês.</p>
        )}

        <div className="mt-3 border-t border-border pt-2 text-xs">
          <Link href={`/clients/${card.clientId}`} className="text-muted-foreground hover:underline">
            Abrir cliente
          </Link>
        </div>
      </div>
    </details>
  );
}
