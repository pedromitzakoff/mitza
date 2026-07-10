import type { OperationClientCard } from "@/app/operation/operation-data";

/**
 * Ordenação exclusiva do modo "Sprint atual" na tela Sprints — não usa
 * badge de saúde pra comunicar prioridade, usa direto os mesmos critérios
 * operacionais já calculados (sprintFilterBucket, tarefas de hoje). Não
 * mexe em `sortByPriority` (lib/priority-accounts.ts), que continua sendo a
 * ordenação da Visão Geral e não muda aqui.
 */
function urgencyTier(card: OperationClientCard, todayStr: string): number {
  if (card.sprintFilterBucket === "atrasadas") return 0;
  if (card.sprintFilterBucket === "sem_execucao") return 1;
  if (card.todayAndOverdueTasks.some((t) => t.due_date === todayStr)) return 2;
  return 3;
}

export function sortSprintClientsByUrgency(
  cards: OperationClientCard[],
  todayStr: string,
): OperationClientCard[] {
  return [...cards].sort((a, b) => {
    const diff = urgencyTier(a, todayStr) - urgencyTier(b, todayStr);
    if (diff !== 0) return diff;
    return a.clientName.localeCompare(b.clientName);
  });
}
