import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import { resolveMonthPeriodSummary, computeRitmoDiff } from "@/lib/financial-period";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";
import { operationalSummary } from "@/lib/account-priority";
import { effectiveTaskStatus } from "@/lib/task-status";
import { orderTasks } from "@/app/clients/task-list";
import { TaskRow } from "@/app/clients/task-row";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
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
  accountReviewsBySprintId,
  monthTemporalStatus,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  returnTo: string;
  /** Otimizações (account_reviews) de todas as sprints do mês, por sprint —
   * Sprint UX 2.0. Opcional só por retrocompatibilidade de tipo. */
  accountReviewsBySprintId?: Map<string, AccountReviewSummaryItem[]>;
  monthTemporalStatus?: MonthTemporalStatus;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const operational = operationalSummary(card, "month");
  const orderedTasks = orderTasks(card.monthTasks);
  const tasksDone = card.monthTasks.filter((t) => effectiveTaskStatus(t) === "feito").length;
  const optimizationCount = card.monthSprints.reduce(
    (sum, sprint) => sum + (accountReviewsBySprintId?.get(sprint.sprintId)?.length ?? 0),
    0,
  );

  return (
    <details className="group rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <AccountCardSummary
        clientId={card.clientId}
        clientName={card.clientName}
        managerName={primaryManagerName}
        periodLabel={monthLabel}
        summary={summary}
        operational={operational}
        monthTemporalStatus={monthTemporalStatus}
        tasksDone={tasksDone}
        tasksTotal={card.monthTasks.length}
        optimizationCount={optimizationCount}
      />

      <div className="border-t border-border p-2.5">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {summary.planned > 0 && <span>Diferença pro ritmo esperado: {formatCurrency(diff)}</span>}
          <span>Última atividade: {card.activityLabel === "Nunca houve atividade" ? "Nunca" : card.activityLabel}</span>
        </div>

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
          <EmptyState size="xs">Nenhuma tarefa neste mês.</EmptyState>
        )}

        <div className="mt-2 border-t border-border pt-2 text-xs">
          <Link href={`/clients/${card.clientId}`} className="text-muted-foreground hover:underline">
            Abrir cliente
          </Link>
        </div>
      </div>
    </details>
  );
}
