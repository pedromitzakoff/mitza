import type { OperationClientCard } from "@/app/operation/operation-data";
import type { AccountHealth } from "@/lib/attention-alerts";
import { computeRelativeDeviation } from "@/lib/spend-status";
import {
  computeVariationFromTarget,
  isCostAboveTargetPriority,
  type PerformanceChannelScope,
  type PerformanceSummary,
} from "@/lib/performance";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { formatCurrency } from "@/lib/format";

/**
 * MVP Etapa "Reformular Prioridades na Visão Geral" — substitui inteiramente
 * o sistema anterior de 9 tiers (tarefa atrasada, sprint sem execução,
 * otimização vencida, entrega de criativo, inatividade, fallback genérico
 * etc.). A nova fila só existe pra 2 problemas — os únicos com uma decisão
 * de gestor clara e um número que sustenta a urgência:
 *
 *   1. `custo_acima_meta` — CPL/CPA realizado supera a meta em mais de 30%
 *      (`isCostAboveTargetPriority`, Etapa "Regras centrais de saúde da
 *      conta"). Nunca dispara sem meta configurada ou sem custo calculável.
 *   2. `ritmo_fora_esperado` — investimento do mês foge do esperado em mais
 *      de 20% pra qualquer direção (`card.monthStatus` acima/abaixo, mesma
 *      classificação central — `classifySpendStatus`/`SPEND_STATUS_MARGIN`).
 *
 * Um cliente pode ter as duas ao mesmo tempo — cada uma vira uma linha
 * própria na fila (nunca "esconde" uma atrás da outra escolhendo só "a
 * principal"): as duas são igualmente acionáveis e merecem aparecer.
 *
 * Removido de propósito (não substituído por nada): inatividade genérica,
 * sincronização do Meta desatualizada, "cliente sem análise", tarefa
 * atrasada, sprint sem execução, entrega de criativo — nenhum desses tem um
 * número que sustente urgência por si só nem uma ação de gestor inequívoca
 * do jeito que os dois tipos acima têm; continuam visíveis onde já
 * apareciam (alertas da sprint, badges de saúde da conta), só não mais
 * nesta fila.
 */
export type ClientPriorityKind = "custo_acima_meta" | "ritmo_fora_esperado";

export interface ClientPriorityItem {
  clientId: string;
  clientName: string;
  kind: ClientPriorityKind;
  /** Reaproveita `card.accountHealth` (já central, computado em
   * `computeAccountHealth`) só como critério de ordenação — nunca uma
   * severidade nova inventada pra esta fila. */
  severity: AccountHealth;
  /** Desvio absoluto (fração, ex.: 0.38 = 38%) — usado pra ordenar e pra
   * formatar o texto ("38%"). Sempre positivo. */
  deviationAbs: number;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

function buildCostPriorityItem(card: OperationClientCard, summary: PerformanceSummary | null): ClientPriorityItem | null {
  if (!card.performanceGoal || !summary) return null;
  if (!isCostAboveTargetPriority(summary.costPerResult, summary.targetCostPerResult, summary.resultCount)) return null;

  // `isCostAboveTargetPriority` já garante custo/meta disponíveis (nunca
  // `null` aqui) — a variação é recalculada só pra formatar o texto, nunca
  // uma segunda regra de decisão.
  const variation = computeVariationFromTarget(summary.costPerResult, summary.targetCostPerResult);
  if (variation === null || summary.costPerResult === null || summary.targetCostPerResult === null) return null;

  const shortLabel = PERFORMANCE_GOALS[card.performanceGoal].costMetricShortLabel;
  const pct = Math.round(variation * 100);

  return {
    clientId: card.clientId,
    clientName: card.clientName,
    kind: "custo_acima_meta",
    severity: card.accountHealth,
    deviationAbs: Math.abs(variation),
    title: `${shortLabel} ${pct}% acima da meta`,
    description: `${shortLabel} atual ${formatCurrency(summary.costPerResult)} · Meta ${formatCurrency(summary.targetCostPerResult)}`,
    actionLabel: "Abrir cliente",
    actionHref: `/clients/${card.clientId}`,
  };
}

function buildRitmoPriorityItem(card: OperationClientCard): ClientPriorityItem | null {
  if (card.monthStatus !== "acima" && card.monthStatus !== "abaixo") return null;
  const deviation = computeRelativeDeviation(card.monthActual, card.monthExpectedToDate);
  if (deviation === null) return null;

  const direction = card.monthStatus === "acima" ? "acima" : "abaixo";
  const pct = Math.round(Math.abs(deviation) * 100);

  return {
    clientId: card.clientId,
    clientName: card.clientName,
    kind: "ritmo_fora_esperado",
    severity: card.accountHealth,
    deviationAbs: Math.abs(deviation),
    title: `Investimento ${pct}% ${direction} do ritmo`,
    description: `Realizado ${formatCurrency(card.monthActual)} · Esperado ${formatCurrency(card.monthExpectedToDate)}`,
    actionLabel: "Abrir cliente",
    actionHref: `/clients/${card.clientId}`,
  };
}

/** Os itens de prioridade de UM cliente — 0, 1 ou 2 (nunca mais que isso,
 * já que só existem 2 tipos possíveis).
 *
 * `scope` (Etapa "Filtro de Plataforma na Visão Geral" + Regras centrais):
 * custo por resultado já tem uma fonte real por canal (`monthPerformanceSummaryByChannel`),
 * então continua disponível fora do Consolidado — usa o resumo do canal
 * selecionado em vez do consolidado. Ritmo financeiro continua uma exclusividade
 * do Consolidado (não existe orçamento configurado por canal ainda — mesma
 * decisão da Etapa de filtro de plataforma), por isso nunca aparece pra
 * `scope !== "consolidated"`. */
export function buildClientPriorityItems(
  card: OperationClientCard,
  scope: PerformanceChannelScope = "consolidated",
): ClientPriorityItem[] {
  const items: ClientPriorityItem[] = [];
  const summary = scope === "consolidated" ? card.monthPerformanceSummary : (card.monthPerformanceSummaryByChannel[scope] ?? null);
  const cost = buildCostPriorityItem(card, summary);
  if (cost) items.push(cost);
  if (scope === "consolidated") {
    const ritmo = buildRitmoPriorityItem(card);
    if (ritmo) items.push(ritmo);
  }
  return items;
}

const SEVERITY_RANK: Record<AccountHealth, number> = { critico: 0, atencao: 1, saudavel: 2 };

/** Ordenação da fila: severidade primeiro, depois o desvio (maior primeiro),
 * depois um desempate estável (nome, depois tipo) — sempre determinístico. */
export function sortClientPriorityItems(items: ClientPriorityItem[]): ClientPriorityItem[] {
  return [...items].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;

    const deviationDiff = b.deviationAbs - a.deviationAbs;
    if (deviationDiff !== 0) return deviationDiff;

    const nameDiff = a.clientName.localeCompare(b.clientName);
    if (nameDiff !== 0) return nameDiff;

    return a.kind.localeCompare(b.kind);
  });
}

/** Fila completa da agência — todos os clientes, ambos os tipos (ou só
 * custo por resultado, fora do Consolidado), já ordenada. "Saudável"/sem
 * nenhum problema simplesmente não gera item nenhum (nunca aparece como
 * "prioridade zero"). */
export function buildClientPriorityQueue(
  cards: OperationClientCard[],
  scope: PerformanceChannelScope = "consolidated",
): ClientPriorityItem[] {
  return sortClientPriorityItems(cards.flatMap((card) => buildClientPriorityItems(card, scope)));
}

/**
 * "Ordenar por prioridade" da tabela de clientes precisa de UM valor por
 * CLIENTE (não por item) — usa a severidade da conta (mesma de sempre) e o
 * MAIOR desvio entre os itens de prioridade que o cliente tiver (0 quando
 * não tem nenhum), pra clientes saudáveis caírem no fim da lista em vez de
 * numa ordem arbitrária.
 */
export function sortCardsByPriority(
  cards: OperationClientCard[],
  scope: PerformanceChannelScope = "consolidated",
): OperationClientCard[] {
  const deviationByClient = new Map(
    cards.map((card) => {
      const items = buildClientPriorityItems(card, scope);
      const deviationAbs = items.length > 0 ? Math.max(...items.map((i) => i.deviationAbs)) : 0;
      return [card.clientId, deviationAbs];
    }),
  );

  return [...cards].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.accountHealth] - SEVERITY_RANK[b.accountHealth];
    if (severityDiff !== 0) return severityDiff;

    const deviationDiff = (deviationByClient.get(b.clientId) ?? 0) - (deviationByClient.get(a.clientId) ?? 0);
    if (deviationDiff !== 0) return deviationDiff;

    return a.clientName.localeCompare(b.clientName);
  });
}
