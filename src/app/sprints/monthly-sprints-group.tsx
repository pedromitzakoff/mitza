import type { OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import { operationalSummary } from "@/lib/account-priority";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";
import { SprintCard } from "@/app/clients/sprint-card";
import { AccountCardSummary } from "./account-card-summary";

/**
 * Grupo por cliente na visão "Mensal > Por sprints" da tela Sprints (Etapa
 * 42/43, resumo simplificado na Etapa 44) — resumo fechado igual ao de
 * Mensal Consolidado (mesmo `AccountCardSummary`, mesmo período mensal:
 * "card fechado = decisão", nunca dados de uma sprint específica); ao
 * expandir, mostra as sprints reais do mês usando o mesmo `SprintCard` da
 * página individual do cliente, cada uma começando recolhida por sua vez
 * (dois níveis aqui fazem sentido: um controla "ver as sprints deste
 * cliente", outro controla "ver o detalhe desta sprint específica" — não é
 * a mesma informação duas vezes). Alertas só aparecem dentro do SprintCard
 * da sprint atual (quando ela está neste mês) — não duplicados aqui no
 * resumo, seguindo a mesma regra de "um local só" da visão Sprint atual.
 */
export function SprintMonthlyBySprintsGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
  isAdmin,
  returnTo,
  sprintCommentsById,
  monthTemporalStatus,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  isAdmin: boolean;
  returnTo: string;
  sprintCommentsById: Map<string, CommentItem[]>;
  monthTemporalStatus?: MonthTemporalStatus;
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const operational = operationalSummary(card, "month");

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
      />

      <div className="flex flex-col gap-2 border-t border-border p-3">
        {card.monthSprints.length > 0 ? (
          card.monthSprints.map((sprint) => {
            const isCurrent = sprint.temporalStatus === "atual";
            return (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                clientId={card.clientId}
                isAdmin={isAdmin}
                tasks={card.monthSprintTasks[sprint.sprintId] ?? []}
                executionLabel={isCurrent ? card.sprintExecutionLabel : null}
                executionSeverity={isCurrent ? (card.sprintExecutionInfo?.severity ?? null) : null}
                alerts={isCurrent ? card.alerts : undefined}
                defaultOpen={false}
                openClientHref={`/clients/${card.clientId}`}
                buildTaskHref={(taskId) => `${returnTo}&task=${taskId}`}
                remainingPlanned={card.monthSprintPlans?.[sprint.sprintId]?.remainingPlanned ?? 0}
                eligibleDaysCount={card.monthSprintPlans?.[sprint.sprintId]?.eligibleDaysCount ?? 0}
                metaSyncedAt={card.lastSyncedAt}
              />
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma sprint neste mês.</p>
        )}
      </div>
    </details>
  );
}
