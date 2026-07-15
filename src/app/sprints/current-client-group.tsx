import { buildSprintPerformanceProps, type OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import { SprintCardBody } from "@/app/clients/sprint-card";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
import { resolveSprintPeriodSummary } from "@/lib/financial-period";
import { operationalSummary } from "@/lib/account-priority";
import { effectiveTaskStatus } from "@/lib/task-status";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { AccountCardSummary } from "./account-card-summary";

/**
 * Card de conta na visão "Sprint atual" da tela Sprints (Etapa 44) — regra
 * "card fechado = decisão, card aberto = investigação": um único `<details>`
 * por cliente, com o mesmo resumo compacto (`AccountCardSummary`) usado
 * pelas visões Mensais, e o corpo investigativo reaproveitado de
 * `SprintCard` (`SprintCardBody` — mesmo financeiro/tarefas/comentários da
 * página do cliente, sem duplicar). Antes (Etapa 42) o próprio `SprintCard`
 * era o único nível de accordion aqui, sempre aberto por padrão; agora o
 * nível é este `<details>` externo, sempre fechado ao entrar na tela (regra
 * "cards iniciam fechados" — o gestor decide o que investigar).
 */
export function SprintCurrentClientGroup({
  card,
  returnTo,
  primaryManagerName,
  isAdmin,
  comments,
  accountReviews,
  managers,
}: {
  card: OperationClientCardData;
  returnTo: string;
  primaryManagerName: string | null;
  isAdmin: boolean;
  comments: CommentItem[];
  /** Otimizações (account_reviews) da sprint atual deste cliente — Sprint UX
   * 2.0. Vazio por padrão pra quem ainda não busca a query nova. */
  accountReviews?: AccountReviewSummaryItem[];
  /** Sprint UX 2.0 Fase 2 — habilita "+ Tarefa" inline (ver `SprintCardBody`). */
  managers?: { id: string; name: string }[];
}) {
  if (!card.sprint) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
        <span className="font-semibold text-foreground">{card.clientName}</span>
        <span className="text-xs text-muted-foreground">Sem sprint em andamento</span>
      </div>
    );
  }

  const summary = resolveSprintPeriodSummary(
    card.sprint,
    formatSprintPeriodLabel(card.sprint.startDate, card.sprint.endDate),
  );
  const operational = operationalSummary(card, "sprint");
  const reviews = accountReviews ?? [];
  const tasksDone = card.sprintTasks.filter((t) => effectiveTaskStatus(t) === "feito").length;

  return (
    <details className="group rounded-lg border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <AccountCardSummary
        clientId={card.clientId}
        clientName={card.clientName}
        managerName={primaryManagerName}
        periodLabel={summary.label}
        summary={summary}
        operational={operational}
        tasksDone={tasksDone}
        tasksTotal={card.sprintTasks.length}
        optimizationCount={reviews.length}
      />

      <SprintCardBody
        sprint={card.sprint}
        comments={comments}
        clientId={card.clientId}
        isAdmin={isAdmin}
        tasks={card.sprintTasks}
        executionLabel={card.sprintExecutionLabel}
        executionSeverity={card.sprintExecutionInfo?.severity ?? null}
        buildTaskHref={(taskId) => `${returnTo}&task=${taskId}`}
        metaSyncedAt={card.lastSyncedAt}
        performance={buildSprintPerformanceProps(card, card.sprint.sprintId)}
        returnTo={returnTo}
        accountReviews={reviews}
        newReviewHref={`${returnTo}&review=new&reviewClient=${card.clientId}`}
        buildReviewDetailHref={(reviewId) => `${returnTo}&reviewDetail=${reviewId}`}
        taskManagers={managers}
      />
    </details>
  );
}
