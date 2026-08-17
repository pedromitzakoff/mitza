import { buildSprintPerformanceProps, type OperationClientCard as OperationClientCardData } from "@/app/operation/operation-data";
import type { CommentItem } from "@/app/clients/comment-thread";
import { SprintCardBody } from "@/app/clients/sprint-card";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
import type { RecurringTaskListItem } from "@/lib/recurring-task-data";
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
 * página do cliente, sem duplicar).
 *
 * Etapa "Evolução visual de /sprints": esta visão existe especificamente
 * pra responder "qual sprint está ativa e como ela está indo" — por isso o
 * card abre expandido por padrão (nunca precisa de clique pra ver o
 * essencial) e ganha a mesma borda de destaque (`border-l-4 border-l-brand`)
 * já usada pro card da sprint atual na página do cliente — mesmo padrão
 * visual reaproveitado, nunca um novo. `SprintsContextMemory` continua
 * lembrando se o gestor fechar manualmente (mesmo mecanismo de sempre, só o
 * estado inicial mudou).
 */
export function SprintCurrentClientGroup({
  card,
  returnTo,
  primaryManagerName,
  isAdmin,
  comments,
  accountReviews,
  recurringTasks,
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
  /** Reformulação do sistema de tarefas (28/07) — ver doc de `recurringTasks`
   * em `ActivitySection`. Vazio por padrão, mesmo motivo de `accountReviews`. */
  recurringTasks?: RecurringTaskListItem[];
  /** Gestores ativos — ver doc de `SprintCardBody` (expansão inline de
   * tarefa dentro de Atividades). */
  managers?: { id: string; name: string }[];
}) {
  if (!card.sprint) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-overview-border bg-overview-surface px-3 py-2.5 text-sm">
        <span className="font-semibold text-overview-text-primary">{card.clientName}</span>
        <span className="text-xs text-overview-text-secondary">Sem sprint em andamento</span>
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
  const sprintId = card.sprint.sprintId;

  return (
    <details
      id={`client-${card.clientId}`}
      open
      className="group rounded-lg border-l-4 border-l-brand border-y border-r border-overview-border bg-overview-surface [&_summary::-webkit-details-marker]:hidden"
    >
      <AccountCardSummary
        clientId={card.clientId}
        clientName={card.clientName}
        managerName={primaryManagerName}
        summary={summary}
        operational={operational}
        tasksDone={tasksDone}
        tasksTotal={card.sprintTasks.length}
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
        taskManagers={managers}
        defaultAssigneeName={primaryManagerName}
        performance={buildSprintPerformanceProps(card, card.sprint.sprintId)}
        returnTo={returnTo}
        accountReviews={reviews}
        recurringTasks={recurringTasks}
        buildRecurringTaskHref={(recurringTaskId) =>
          `${returnTo}&recurringTaskDetail=${recurringTaskId}&recurringTaskClient=${card.clientId}&recurringTaskSprint=${sprintId}`
        }
        newReviewHref={`${returnTo}&review=new&reviewClient=${card.clientId}`}
        buildReviewDetailHref={(reviewId) => `${returnTo}&reviewDetail=${reviewId}`}
      />
    </details>
  );
}
