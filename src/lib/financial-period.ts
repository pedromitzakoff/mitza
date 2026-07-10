import type { SprintFinancials } from "./sprint-financials";
import type { SpendStatus } from "./spend-status";

export type FinancialPeriodKind = "sprint" | "month";

/**
 * Formato único de resumo financeiro, qualquer que seja o período — sprint
 * ou mês. Não recalcula nada: só empacota valores que já vêm de
 * `computeSprintFinancials` (sprint) ou dos campos `month*` do card
 * operacional (mês), que por sua vez já usam `sumEffectiveSpend`/
 * `sumExpectedToDate`/`classifySpendStatus`. Existe pra as telas pararem de
 * ler `card.sprint.plannedSpend` num lugar e `card.monthPlanned` em outro
 * com nomes diferentes — um único formato, o período sempre explícito.
 */
export interface FinancialPeriodSummary {
  kind: FinancialPeriodKind;
  label: string;
  startDate: string;
  endDate: string;
  planned: number;
  actual: number;
  expectedToDate: number;
  /** null quando não há planejado configurado (nunca 0%/NaN/Infinity). */
  pct: number | null;
  status: SpendStatus;
}

function computePct(actual: number, planned: number): number | null {
  return planned > 0 ? (actual / planned) * 100 : null;
}

/** Resumo da sprint atual — período = start_date..end_date da própria sprint. */
export function resolveSprintPeriodSummary(sprint: SprintFinancials, label: string): FinancialPeriodSummary {
  return {
    kind: "sprint",
    label,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    planned: sprint.plannedSpend,
    actual: sprint.actualSpend,
    expectedToDate: sprint.expectedToDate,
    pct: computePct(sprint.actualSpend, sprint.plannedSpend),
    status: sprint.status,
  };
}

/** Resumo do mês selecionado — período = primeiro..último dia do mês. */
export function resolveMonthPeriodSummary(
  month: {
    monthPlanned: number;
    monthActual: number;
    monthExpectedToDate: number;
    monthStatus: SpendStatus;
  },
  label: string,
  monthRange: { firstDay: string; lastDay: string },
): FinancialPeriodSummary {
  return {
    kind: "month",
    label,
    startDate: monthRange.firstDay,
    endDate: monthRange.lastDay,
    planned: month.monthPlanned,
    actual: month.monthActual,
    expectedToDate: month.monthExpectedToDate,
    pct: computePct(month.monthActual, month.monthPlanned),
    status: month.monthStatus,
  };
}

/** Diferença pro ritmo esperado — sempre realizado vs. esperado até a data
 * observada do PRÓPRIO período (nunca 100% do total antes do período acabar). */
export function computeRitmoDiff(summary: FinancialPeriodSummary): number {
  return summary.actual - summary.expectedToDate;
}
