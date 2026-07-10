import type { OperationClientCard } from "@/app/operation/operation-data";
import { businessDaysSince } from "./business-days";
import { formatCurrency, formatShortDate } from "./format";

/**
 * "comentarios" fica reservada aqui (arquitetura preparada), mas nenhuma
 * função deste arquivo ainda emite itens dessa categoria — `comments` não
 * tem hoje nenhum campo de pendência/resolução (só id, commentable_*,
 * author_id, content, created_at), e inventar uma heurística baseada só em
 * "comentário mais recente" seria uma regra nova não pedida. Assim que essa
 * coluna existir, a categoria entra aqui sem mudar a arquitetura.
 */
export type AttentionCenterCategory = "sem_execucao" | "tarefas_criticas" | "investimento" | "comentarios";

export interface AttentionCenterItem {
  clientId: string;
  clientName: string;
  category: AttentionCenterCategory;
  title: string;
  description: string;
  context: string;
  actionLabel: string;
  actionHref: string;
  /** Só pra ordenação — nunca exibido na interface. */
  score: number;
}

const TASK_OVERDUE_DAYS_THRESHOLD = 2;
const TASK_OVERDUE_COUNT_THRESHOLD = 3;

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Monta os itens de atenção a partir dos cards já calculados (nenhuma
 * query nova, nenhuma regra financeira ou de sprint nova — só combina o
 * que `buildOperationClientCard` já expõe). Retorna TODOS os itens que se
 * qualificam, já ordenados por score (maior primeiro); truncar/paginar é
 * responsabilidade de quem chama (`selectTopAttentionItems`).
 */
export function buildAttentionCenterItems(cards: OperationClientCard[], today: Date): AttentionCenterItem[] {
  const items: AttentionCenterItem[] = [];

  for (const card of cards) {
    if (card.sprintExecutionInfo && card.sprint) {
      const { businessDays, referenceDate } = card.sprintExecutionInfo;
      items.push({
        clientId: card.clientId,
        clientName: card.clientName,
        category: "sem_execucao",
        title: "Sem execução",
        description: `Há ${businessDays} dia${businessDays !== 1 ? "s" : ""} úteis sem execução.`,
        context: `Última atividade: ${formatShortDate(referenceDate)}`,
        actionLabel: "Abrir sprint",
        actionHref: `/clients/${card.clientId}#sprint-${card.sprint.sprintId}`,
        score: businessDays * 2,
      });
    }

    const overdueCount = card.overdueTasks.length;
    if (overdueCount > 0) {
      const oldestDays = Math.max(
        ...card.overdueTasks.map((t) => businessDaysSince(parseDateUTC(t.due_date), today)),
      );
      const qualifies = oldestDays >= TASK_OVERDUE_DAYS_THRESHOLD || overdueCount >= TASK_OVERDUE_COUNT_THRESHOLD;

      if (qualifies) {
        items.push({
          clientId: card.clientId,
          clientName: card.clientName,
          category: "tarefas_criticas",
          title: "Tarefas críticas",
          description: `${overdueCount} tarefa${overdueCount !== 1 ? "s" : ""} atrasada${overdueCount !== 1 ? "s" : ""}.`,
          context: `A mais antiga está atrasada há ${oldestDays} dia${oldestDays !== 1 ? "s" : ""} úteis.`,
          actionLabel: "Abrir sprint",
          actionHref: card.sprint
            ? `/clients/${card.clientId}#sprint-${card.sprint.sprintId}`
            : `/clients/${card.clientId}`,
          score: overdueCount * 4 + oldestDays,
        });
      }
    }

    if (card.monthStatus === "abaixo" || card.monthStatus === "acima") {
      const pctRealizado = card.monthPlanned > 0 ? (card.monthActual / card.monthPlanned) * 100 : 0;
      const pctEsperado = card.monthPlanned > 0 ? (card.monthExpectedToDate / card.monthPlanned) * 100 : 0;
      const diffValue = card.monthActual - card.monthExpectedToDate;
      const isAbaixo = card.monthStatus === "abaixo";

      items.push({
        clientId: card.clientId,
        clientName: card.clientName,
        category: "investimento",
        title: isAbaixo ? "Investimento abaixo do ritmo esperado" : "Investimento acima do ritmo esperado",
        description: `Realizado: ${Math.round(pctRealizado)}%`,
        context: `Esperado até hoje: ${Math.round(pctEsperado)}% · Diferença: ${diffValue >= 0 ? "+" : ""}${formatCurrency(diffValue)}`,
        actionLabel: "Abrir cliente",
        actionHref: `/clients/${card.clientId}`,
        score: Math.abs(pctRealizado - pctEsperado) / 10,
      });
    }
  }

  return items.sort((a, b) => b.score - a.score);
}

/**
 * Fila priorizada da Visão Geral: no máximo `maxTotal` itens, no máximo
 * `maxPerClient` do mesmo cliente — pra um cliente com muitos problemas não
 * dominar a lista principal. "Ver tudo" usa a lista completa, sem esse corte.
 */
export function selectTopAttentionItems(
  items: AttentionCenterItem[],
  maxTotal: number,
  maxPerClient: number,
): AttentionCenterItem[] {
  const perClientCount = new Map<string, number>();
  const result: AttentionCenterItem[] = [];

  for (const item of items) {
    if (result.length >= maxTotal) break;
    const count = perClientCount.get(item.clientId) ?? 0;
    if (count >= maxPerClient) continue;
    result.push(item);
    perClientCount.set(item.clientId, count + 1);
  }

  return result;
}

export interface AttentionCenterCounts {
  tarefasCriticas: number;
  semExecucao: number;
  investimento: number;
}

/** Contagem por categoria (clientes distintos — cada categoria só gera no
 * máximo um item por cliente) pra faixa de resumo do topo. Sempre sobre a
 * lista completa, não sobre o corte de 5 itens. */
export function computeAttentionCenterCounts(items: AttentionCenterItem[]): AttentionCenterCounts {
  return {
    tarefasCriticas: items.filter((i) => i.category === "tarefas_criticas").length,
    semExecucao: items.filter((i) => i.category === "sem_execucao").length,
    investimento: items.filter((i) => i.category === "investimento").length,
  };
}
