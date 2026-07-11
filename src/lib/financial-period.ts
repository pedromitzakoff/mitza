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

/** % do esperado até hoje sobre o planejado do período — só pra exibição
 * (o valor em R$ que importa pro cálculo já está em `expectedToDate`). */
export function computeExpectedPct(summary: FinancialPeriodSummary): number {
  return summary.planned > 0 ? (summary.expectedToDate / summary.planned) * 100 : 0;
}

/** Texto de ritmo ("N p.p. acima/abaixo do ritmo" ou "Dentro do ritmo
 * esperado") — mesma frase em qualquer período (sprint ou mês), reaplicada
 * por quem já usa `SprintFinancialBar`/`AgencyInvestmentBar` como legenda
 * textual equivalente pros resumos que não têm uma barra com tooltip. */
export function formatRitmoDiffText(summary: FinancialPeriodSummary): string | null {
  const expectedPct = computeExpectedPct(summary);
  const diffPct = Math.round(Math.abs((summary.pct ?? 0) - expectedPct));
  if (summary.status === "acima") return `${diffPct} p.p. acima do ritmo`;
  if (summary.status === "abaixo") return `${diffPct} p.p. abaixo do ritmo`;
  if (summary.status === "dentro") return "Dentro do ritmo esperado";
  return null;
}
