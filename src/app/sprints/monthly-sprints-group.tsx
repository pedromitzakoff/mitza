import { EmptyState } from "@/components/ui/empty-state";
import { buildSprintPerformanceProps, type OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import { operationalSummary } from "@/lib/account-priority";
import { effectiveTaskStatus } from "@/lib/task-status";
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
 * a mesma informação duas vezes). Etapa "Simplificação da Área Operacional
 * da Sprint": `SprintCard` não exibe mais alertas em lugar nenhum (a Sprint
 * é área de execução, não painel de alertas) — o cálculo continua intacto,
 * só a apresentação saiu daqui.
 */
export function SprintMonthlyBySprintsGroup({
  card,
  monthLabel,
  monthRange,
  primaryManagerName,
  isAdmin,
  returnTo,
  sprintCommentsById,
  accountReviewsBySprintId,
  monthTemporalStatus,
  managers,
}: {
  card: OperationClientCardData;
  monthLabel: string;
  monthRange: { firstDay: string; lastDay: string };
  primaryManagerName: string | null;
  isAdmin: boolean;
  returnTo: string;
  sprintCommentsById: Map<string, CommentItem[]>;
  /** Otimizações (account_reviews) de todas as sprints do mês, por sprint —
   * Sprint UX 2.0. Opcional só por retrocompatibilidade de tipo. */
  accountReviewsBySprintId?: Map<string, AccountReviewSummaryItem[]>;
  monthTemporalStatus?: MonthTemporalStatus;
  /** Gestores ativos — ver doc de `SprintCardBody` (expansão inline de
   * tarefa dentro de Atividades). */
  managers?: { id: string; name: string }[];
}) {
  const summary = resolveMonthPeriodSummary(card, monthLabel, monthRange);
  const operational = operationalSummary(card, "month");
  const tasksDone = card.monthTasks.filter((t) => effectiveTaskStatus(t) === "feito").length;
  const optimizationCount = card.monthSprints.reduce(
    (sum, sprint) => sum + (accountReviewsBySprintId?.get(sprint.sprintId)?.length ?? 0),
    0,
  );
  const newReviewHref = `${returnTo}&review=new&reviewClient=${card.clientId}`;
  const buildReviewDetailHref = (reviewId: string) => `${returnTo}&reviewDetail=${reviewId}`;

  return (
    <details
      id={`client-${card.clientId}`}
      className="group rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden"
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
        optimizationCount={optimizationCount}
      />

      {/* Sprint UX 2.0 Fase 2 (Decisão 011): sprints como filhos visuais do
          cliente — indentação + divisória à esquerda (border-l), nunca mais
          uma pilha de cards independentes (gap-2 entre cards soltos). Cada
          SprintCard entra em modo `flat` (sem moldura própria). */}
      <div className="border-t border-border pl-3">
        {card.monthSprints.length > 0 ? (
          <div className="border-l border-border/60 pl-2">
            {card.monthSprints.map((sprint, index) => {
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
                  defaultOpen={false}
                  openClientHref={`/clients/${card.clientId}`}
                  buildTaskHref={(taskId) => `${returnTo}&task=${taskId}`}
                  metaSyncedAt={card.lastSyncedAt}
                  taskManagers={managers}
                  performance={buildSprintPerformanceProps(card, sprint.sprintId)}
                  returnTo={returnTo}
                  accountReviews={accountReviewsBySprintId?.get(sprint.sprintId) ?? []}
                  newReviewHref={newReviewHref}
                  buildReviewDetailHref={buildReviewDetailHref}
                  flat
                  // Interaction Physics 1.0 — protótipo ISOLADO (ver doc da
                  // prop em `sprint-card.tsx`): só a primeira sprint deste
                  // grupo testa a técnica, nunca todas.
                  accordionRowsPrototype={index === 0}
                />
              );
            })}
          </div>
        ) : (
          <EmptyState size="xs" className="p-3">Nenhuma sprint neste mês.</EmptyState>
        )}
      </div>
    </details>
  );
}
