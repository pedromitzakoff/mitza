import type { OperationClientCard } from "@/app/operation/operation-data";

const HEALTH_ORDER: Record<OperationClientCard["accountHealth"], number> = {
  critico: 0,
  atencao: 1,
  saudavel: 2,
};

function criticalAlertCount(card: OperationClientCard): number {
  return card.alerts.filter((a) => a.severity === "critico").length;
}

function spendDeviation(card: OperationClientCard): number {
  if (!card.sprint) return 0;
  return Math.abs(card.sprint.actualSpend - card.sprint.expectedToDate);
}

/**
 * Ordena contas por prioridade de intervenção, sem inventar um "health
 * score" numérico — cada critério é uma regra já existente (saúde da
 * conta, alertas críticos, inatividade, sprint sem execução, tarefas
 * atrasadas, desvio de investimento), aplicada em sequência.
 */
export function sortByPriority(cards: OperationClientCard[]): OperationClientCard[] {
  return [...cards].sort((a, b) => {
    if (HEALTH_ORDER[a.accountHealth] !== HEALTH_ORDER[b.accountHealth]) {
      return HEALTH_ORDER[a.accountHealth] - HEALTH_ORDER[b.accountHealth];
    }

    const criticalDiff = criticalAlertCount(b) - criticalAlertCount(a);
    if (criticalDiff !== 0) return criticalDiff;

    const aInactive = a.activityStatus === "inativo" ? 1 : 0;
    const bInactive = b.activityStatus === "inativo" ? 1 : 0;
    if (aInactive !== bInactive) return bInactive - aInactive;

    const aNoExecution = a.sprintFilterBucket === "sem_execucao" ? 1 : 0;
    const bNoExecution = b.sprintFilterBucket === "sem_execucao" ? 1 : 0;
    if (aNoExecution !== bNoExecution) return bNoExecution - aNoExecution;

    if (a.taskCounts.overdue !== b.taskCounts.overdue) {
      return b.taskCounts.overdue - a.taskCounts.overdue;
    }

    return spendDeviation(b) - spendDeviation(a);
  });
}

/** Texto transparente do principal motivo de atenção — o mesmo critério
 * usado pra ordenar, não um valor inventado à parte. */
export function mainAttentionReason(card: OperationClientCard): string {
  if (card.accountHealth === "critico" && card.alerts.length > 0) {
    const critical = card.alerts.find((a) => a.severity === "critico");
    return critical?.message ?? card.alerts[0].message;
  }
  if (card.activityStatus === "inativo") return `Sem atividade — ${card.activityLabel.toLowerCase()}`;
  if (card.sprintFilterBucket === "sem_execucao") return "Sprint sem execução";
  if (card.taskCounts.overdue > 0) {
    return `${card.taskCounts.overdue} tarefa${card.taskCounts.overdue !== 1 ? "s" : ""} atrasada${card.taskCounts.overdue !== 1 ? "s" : ""}`;
  }
  if (card.alerts.length > 0) return card.alerts[0].message;
  return "Em dia";
}
