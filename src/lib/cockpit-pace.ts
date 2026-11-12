import type { SpendStatus } from "@/lib/spend-status";
import type { MetricTone } from "@/lib/metric-diagnostics";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente). Núcleo puro só de
 * APRESENTAÇÃO para os 3 cards de "Meta & Ritmo" (Resultado/Custo/
 * Orçamento) — nunca uma segunda classificação: `SpendStatus` continua
 * vindo de `classifySpendStatus` (`lib/spend-status.ts`) e `MetricTone`
 * continua vindo de `evaluateCpaDiagnostic`/`evaluateInvestmentDiagnostic`
 * (`lib/metric-diagnostics.ts`) — este arquivo só traduz os MESMOS valores
 * pro vocabulário mais enfático que o cockpit pede ("RITMO ABAIXO" em vez
 * de "Abaixo", `SPEND_STATUS_REGISTRY` continua servindo badges compactos
 * em outras telas, nunca substituído).
 */

export type CockpitPaceTone = "success" | "warning" | "danger" | "neutral";

/** Rótulo do veredito de ritmo (cards Resultado/Orçamento) — mesma fonte
 * (`SpendStatus`) que já alimenta `SPEND_STATUS_LABEL`, só um texto mais
 * assertivo pro cabeçalho do card. */
export const PACE_VERDICT_LABEL: Record<SpendStatus, string> = {
  dentro: "NO RITMO",
  acima: "RITMO ACIMA",
  abaixo: "RITMO ABAIXO",
  sem_meta: "SEM PLANEJAMENTO",
  nao_iniciado: "AINDA NÃO INICIADO",
  em_andamento: "EM ANDAMENTO",
};

/** Cards onde "ritmo" é DINHEIRO (Orçamento) — gastar ACIMA do esperado é
 * risco real de estourar o mês, por isso "acima" é `danger`. Nunca usado
 * pelo card de Resultado (ver `RESULT_PACE_VERDICT_TONE` — ali "acima" é o
 * oposto: mais Leads/Vendas que o esperado é bom, não um alerta). */
export const PACE_VERDICT_TONE: Record<SpendStatus, CockpitPaceTone> = {
  dentro: "success",
  acima: "danger",
  abaixo: "warning",
  sem_meta: "neutral",
  nao_iniciado: "neutral",
  em_andamento: "neutral",
};

/**
 * KOFF Analytics — correção de UX (pedido explícito do usuário, achado
 * real: Helping Hand com Leads "RITMO ACIMA" aparecendo em vermelho —
 * "gerar mais lead não é ruim"): card de RESULTADO (Leads/Vendas/
 * Seguidores...) nunca reaproveita `PACE_VERDICT_TONE` — lá "acima" é
 * DINHEIRO gasto além do esperado (risco), aqui é RESULTADO entregue além
 * do esperado (ótimo). Mesma label (`PACE_VERDICT_LABEL`, "RITMO ACIMA"
 * continua descrevendo o fato), só a cor muda pra refletir que mais
 * resultado nunca é um alerta. "abaixo" continua `warning` — menos
 * resultado que o esperado é, sim, motivo de atenção.
 */
export const RESULT_PACE_VERDICT_TONE: Record<SpendStatus, CockpitPaceTone> = {
  dentro: "success",
  acima: "success",
  abaixo: "warning",
  sem_meta: "neutral",
  nao_iniciado: "neutral",
  em_andamento: "neutral",
};

/** Rótulo do veredito de custo por resultado (card Custo) — binário de
 * propósito (a régua de 3 níveis de `MetricTone` continua decidindo a COR,
 * nunca o texto): "fora da meta" é fora da meta, não importa se é atenção
 * ou crítico; a cor (`COST_VERDICT_TONE`) é que comunica a gravidade. */
export function costVerdictLabel(tone: MetricTone): string {
  return tone === "normal" ? "DENTRO DA META" : "FORA DA META";
}

export const COST_VERDICT_TONE: Record<MetricTone, CockpitPaceTone> = {
  normal: "success",
  attention: "warning",
  critical: "danger",
};

/**
 * KOFF Analytics — "Refinamento de UX e filtros globais do Cockpit" (pedido
 * explícito do usuário: "remover fundos vermelhos e verdes muito fortes.
 * Utilizar cores apenas em estados e pequenos indicadores"). O card INTEIRO
 * nunca mais herda a cor do estado — fica sempre neutro
 * (`COCKPIT_CARD_CLASSES`, um valor fixo, não mais um Record por tom).
 * A cor do estado continua existindo, só migrou pra um indicador pequeno
 * (ponto colorido, `COCKPIT_TONE_DOT_CLASSES`) ao lado do rótulo de
 * veredito — nunca mais a moldura inteira do card.
 */
export const COCKPIT_CARD_CLASSES = "border-overview-border bg-overview-surface";

export const COCKPIT_TONE_BADGE_CLASSES: Record<CockpitPaceTone, string> = {
  success: "text-green-700 dark:text-green-300",
  warning: "text-amber-800 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
  neutral: "text-overview-text-secondary",
};

/** Ponto colorido (8px) — o único lugar onde a cor do estado aparece fora
 * do próprio texto do veredito. Nunca um fundo/moldura. */
export const COCKPIT_TONE_DOT_CLASSES: Record<CockpitPaceTone, string> = {
  success: "bg-green-500 dark:bg-green-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-red-500 dark:bg-red-400",
  neutral: "bg-overview-text-muted",
};
