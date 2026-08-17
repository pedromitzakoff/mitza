import Link from "next/link";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import { resolveMonthPeriodSummary, computeRitmoDiff } from "@/lib/financial-period";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";
import { operationalSummary } from "@/lib/account-priority";
import { effectiveTaskStatus } from "@/lib/task-status";
import { orderTasks } from "@/app/clients/task-order";
import { TaskRow } from "@/app/clients/task-row";
import { AccountCardSummary } from "./account-card-summary";

/**
 * Grupo por cliente na visão "Mensal > Consolidado" da tela Sprints (Etapa
 * 43, resumo simplificado na Etapa 44) — um único bloco representando o mês
 * inteiro, sem nenhuma referência a sprints individuais: nada de "Sprint 1",
 * "Sprint 2" aqui (isso é responsabilidade exclusiva de
 * `monthly-sprints-group.tsx`, o outro modo de agrupamento). Todo valor
 * financeiro vem de `resolveMonthPeriodSummary` (mês inteiro) — nunca o de
 * uma sprint específica. Resumo fechado usa o mesmo `AccountCardSummary` da
 * visão Sprint atual (regra "card fechado = decisão"); ao expandir, mostra
 * todas as tarefas do mês numa lista cronológica só, sem separar por sprint,
 * mais o detalhe financeiro (diferença em R$, atividade) que não cabe no
 * resumo fechado.
 */
export function SprintMonthlyConsolidatedGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
  returnTo,
  monthTemporalStatus,
  isAdmin,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  returnTo: string;
  monthTemporalStatus?: MonthTemporalStatus;
  /** Etapa "Sprint Workspace Polish 1.0" — habilita "Excluir tarefa" no menu
   * "•••" de cada linha (ver `TaskRow`). */
  isAdmin?: boolean;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const operational = operationalSummary(card, "month");
  const orderedTasks = orderTasks(card.monthTasks);
  const tasksDone = card.monthTasks.filter((t) => effectiveTaskStatus(t) === "feito").length;

  return (
    <details
      id={`client-${card.clientId}`}
      className="group rounded-lg border border-overview-border bg-overview-surface [&_summary::-webkit-details-marker]:hidden"
    >
      <AccountCardSummary
        clientId={card.clientId}
        clientName={card.clientName}
        managerName={primaryManagerName}
        summary={summary}
        operational={operational}
        monthTemporalStatus={monthTemporalStatus}
        tasksDone={tasksDone}
        tasksTotal={card.monthTasks.length}
      />

      <div className="border-t border-overview-border p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-overview-text-secondary">
          {summary.planned > 0 && <span>Diferença pro ritmo esperado: {formatCurrency(diff)}</span>}
          <span>Última atividade: {card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel}</span>
        </div>

        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-overview-text-muted">
          Tarefas do mês
        </p>
        {orderedTasks.length > 0 ? (
          <ul className="rounded-lg border border-overview-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
            {orderedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                clientId={card.clientId}
                detailsHref={`${returnTo}&task=${task.id}`}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        ) : (
          <EmptyStateRow>Nenhuma tarefa neste mês.</EmptyStateRow>
        )}

        <div className="mt-1 border-t border-overview-border pt-1 text-xs">
          <Link
            href={`/clients/${card.clientId}`}
            className="mitza-pressable inline-block rounded text-overview-text-secondary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Abrir cliente
          </Link>
        </div>
      </div>
    </details>
  );
}
