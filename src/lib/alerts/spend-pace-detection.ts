import type { AlertCandidate, AlertReferenceSource } from "@/lib/alerts/alert-types";
import { DEFAULT_SPEND_PACE_THRESHOLDS, type SpendPaceThresholds } from "@/lib/alerts/spend-pace-thresholds";

/**
 * Referência diária de gasto pra um cliente+canal — NÃO existe orçamento
 * diário cadastrado no sistema (confirmado na pesquisa: `monthly_budget_changes`
 * só tem granularidade mensal), então esta função resolve a melhor estimativa
 * disponível, em duas camadas (pedido, seção 2.1):
 *
 * 1. Orçamento mensal vigente ÷ dias do mês — só quando há um valor > 0.
 * 2. Histórico recente (média dos últimos N dias com dado) — só quando (1)
 *    não existe.
 *
 * Ambas as camadas são SEMPRE marcadas `isEstimate: true` — o pedido exige
 * deixar isso explícito em ambos os casos, nunca só num deles.
 */
export interface DailyReferenceInput {
  /** Orçamento mensal consolidado vigente pro canal/mês avaliado —
   * `resolveConsolidatedMonthlyPlanned`/`resolveClientMonthlyPlan`
   * (`lib/client-plan.ts`), nunca uma soma local reimplementada. `null`/`0`
   * = sem orçamento configurado pra este mês. */
  monthlyBudget: number | null;
  /** Dias de calendário do mês do dia avaliado (`endOfMonth`/`startOfMonth`,
   * `lib/date-range.ts`) — nunca hardcoded 30. */
  daysInMonth: number;
  /** Gasto diário real dos últimos dias disponíveis (até
   * `SPEND_PACE_HISTORY_WINDOW_DAYS`), SEM incluir o dia avaliado — ordem
   * irrelevante, só a média importa. */
  historicalDailySpends: number[];
}

export interface DailyReferenceResult {
  dailyReference: number | null;
  isEstimate: boolean;
  source: AlertReferenceSource | null;
}

export function resolveDailySpendReference(input: DailyReferenceInput): DailyReferenceResult {
  const { monthlyBudget, daysInMonth, historicalDailySpends } = input;

  if (monthlyBudget !== null && monthlyBudget > 0 && daysInMonth > 0) {
    return { dailyReference: monthlyBudget / daysInMonth, isEstimate: true, source: "monthly_budget" };
  }

  if (historicalDailySpends.length > 0) {
    const average = historicalDailySpends.reduce((sum, value) => sum + value, 0) / historicalDailySpends.length;
    // Histórico só de dias com gasto zero (conta nunca rodou de fato) não é
    // uma referência utilizável — "sem dados suficientes" (pedido, seção 5),
    // nunca comparado contra 0.
    if (average > 0) return { dailyReference: average, isEstimate: true, source: "historical_average" };
  }

  return { dailyReference: null, isEstimate: true, source: null };
}

export type SpendPaceDirection = "acima" | "abaixo";

/**
 * Núcleo puro do alerta "Gasto acima ou abaixo do previsto" — compara o
 * gasto observado (dia completo de ontem, ou acumulado de hoje em
 * andamento) com a referência diária resolvida acima.
 *
 * `isPeriodInProgress: true` (seção 4 do pedido — "Monitoramento do dia
 * atual") NUNCA produz um alerta de "abaixo": comparar gasto parcial de um
 * dia incompleto com a referência do dia inteiro sempre pareceria "abaixo",
 * o que não tem nenhum significado operacional.
 */
export function detectSpendPaceAlert(input: {
  actualSpend: number;
  periodStart: string;
  periodEnd: string;
  dailyReference: DailyReferenceResult;
  isPeriodInProgress: boolean;
  thresholds?: SpendPaceThresholds;
}): AlertCandidate | null {
  const thresholds = input.thresholds ?? DEFAULT_SPEND_PACE_THRESHOLDS;
  const { actualSpend, periodStart, periodEnd, dailyReference, isPeriodInProgress } = input;

  if (dailyReference.dailyReference === null || dailyReference.dailyReference <= 0) return null;
  const reference = dailyReference.dailyReference;

  const diffReais = actualSpend - reference;
  if (Math.abs(diffReais) < thresholds.minDiffReais) return null;

  const ratio = actualSpend / reference;
  const diffPercent = (ratio - 1) * 100;

  let severity: "critico" | "atencao" | null = null;
  let direction: SpendPaceDirection | null = null;

  if (ratio > 1 + thresholds.criticalOverRatio) {
    severity = "critico";
    direction = "acima";
  } else if (ratio > 1 + thresholds.attentionOverRatio) {
    severity = "atencao";
    direction = "acima";
  } else if (!isPeriodInProgress && ratio < thresholds.attentionUnderRatio) {
    severity = "atencao";
    direction = "abaixo";
  }

  if (!severity || !direction) return null;

  const referenceLabel = dailyReference.source === "monthly_budget" ? "orçamento mensal dividido pelos dias do mês" : "média do histórico recente";
  const dayLabel = isPeriodInProgress ? "hoje (dia em andamento)" : "o dia completo";

  const explanation =
    direction === "acima"
      ? `Gasto ${Math.round(diffPercent)}% acima do previsto em ${dayLabel} — referência: ${referenceLabel}.`
      : `Gasto ${Math.round(Math.abs(diffPercent))}% abaixo do previsto em ${dayLabel} — referência: ${referenceLabel}.`;

  return {
    severity,
    periodStart,
    periodEnd,
    observedValue: actualSpend,
    referenceValue: reference,
    diffPercent,
    referenceIsEstimate: dailyReference.isEstimate,
    referenceSource: dailyReference.source,
    explanation,
    detail: {
      direction,
      ratio,
      diffReais,
      isPeriodInProgress,
      thresholds,
    },
  };
}
