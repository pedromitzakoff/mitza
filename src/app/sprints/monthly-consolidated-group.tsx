import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import { resolveMonthPeriodSummary, computeRitmoDiff } from "@/lib/financial-period";
import { operationalSummary } from "@/lib/account-priority";
import { orderTasks } from "@/app/clients/task-list";
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
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  returnTo: string;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const diff = computeRitmoDiff(summary);
  const operational = operationalSummary(card, "month");
  const orderedTasks = orderTasks(card.monthTasks);

  return (
    <details className="group rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <AccountCardSummary
        clientId={card.clientId}
        clientName={card.clientName}
        managerName={primaryManagerName}
        periodLabel={monthLabel}
        summary={summary}
        operational={operational}
      />

      <div className="border-t border-border p-3">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
