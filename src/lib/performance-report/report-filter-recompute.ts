import { computeCostPerResult, computeRoas, computeAverageTicket, compareCostToTarget, getCostPerResultUnavailableReason, type PerformanceSummary } from "@/lib/performance";
import { listDatesInclusive } from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { PerformanceReportDailyRow } from "./report-data";

/**
 * Etapa "Filtro no topo afeta o dashboard inteiro" — núcleo puro
 * reaproveitado pelo client-side `ReportFilterableTables` (React) pra
 * recalcular "Resultado Diário" e o Resumo do período só pra quem bate no
 * filtro ativo (Campanha/Público/Criativo), sem NENHUMA consulta nova: as
 * linhas brutas (`campaignDailyRows`/`adSetDailyRows`/`creativeDailyRows`,
 * `PerformanceReportDocument`) já vêm do servidor com investimento/
 * resultado/receita por dia, por entidade — só falta filtrar por nome e
 * reagrupar, e as fórmulas usadas aqui são as MESMAS de sempre
 * (`computeCostPerResult`/`computeRoas`/`computeAverageTicket`/
 * `compareCostToTarget`, `lib/performance.ts`), nunca uma segunda versão.
 *
 * Sem meta pra comparar (`compareCostToTarget(cost, null)`) de propósito:
 * o subconjunto filtrado nunca é comparado contra a meta da carteira
 * inteira — isso seria comparar coisas de tamanho diferente e induzir uma
 * leitura errada.
 */

export type NameFilterMode = "contains" | "not_contains";

/** Comparação simples, sem acento-insensibilidade (mesma convenção de
 * busca por texto já usada em outras telas da MITZA). Texto vazio = nenhum
 * filtro. Única definição deste comportamento — reaproveitada tanto pra
 * recalcular quanto pra decidir se um filtro está "ativo". */
export function matchesNameFilter(name: string, mode: NameFilterMode, normalizedText: string): boolean {
  if (normalizedText === "") return true;
  const nameContains = name.toLowerCase().includes(normalizedText);
  return mode === "contains" ? nameContains : !nameContains;
}

/** Forma comum de uma linha bruta diária, seja de campanha, público ou
 * criativo — só os campos que o recálculo precisa. */
export interface FilterableDailyRow {
  date: string;
  name: string;
  spend: number;
  resultCount: number | null;
  revenue: number | null;
}

export function recomputeDailyRows(
  period: { start: string; end: string },
  rows: FilterableDailyRow[],
  mode: NameFilterMode,
  normalizedText: string,
): PerformanceReportDailyRow[] {
  const matching = rows.filter((row) => matchesNameFilter(row.name, mode, normalizedText));

  const byDate = new Map<string, { spend: number | null; resultCount: number | null; revenue: number | null }>();
  for (const row of matching) {
    const current = byDate.get(row.date) ?? { spend: null, resultCount: null, revenue: null };
    current.spend = (current.spend ?? 0) + row.spend;
    current.resultCount = row.resultCount === null ? current.resultCount : (current.resultCount ?? 0) + row.resultCount;
    current.revenue = row.revenue === null ? current.revenue : (current.revenue ?? 0) + row.revenue;
    byDate.set(row.date, current);
  }

  return listDatesInclusive(period.start, period.end).map((date): PerformanceReportDailyRow => {
    const entry = byDate.get(date);
    const spend = entry?.spend ?? null;
    const resultCount = entry?.resultCount ?? null;
    const revenue = entry?.revenue ?? null;
    const hasAnyRecord = resultCount !== null;

    return {
      date,
      spend,
      resultCount,
      revenue,
      costPerResult: computeCostPerResult(spend, resultCount ?? 0, hasAnyRecord),
      roas: computeRoas(revenue, spend),
    };
  });
}

/** Totais do subconjunto filtrado, já no formato de `PerformanceSummary`
 * (mesma interface do Resumo do período de sempre) — pra
 * `buildAnalyticsKpiCards`/`ReportKpiGrid` poderem renderizar sem NENHUMA
 * lógica própria pro caso filtrado, exatamente como já renderizam o
 * Resumo real. */
export function recomputeFilteredSummary(goal: PerformanceGoal, rows: FilterableDailyRow[], mode: NameFilterMode, normalizedText: string): PerformanceSummary {
  const matching = rows.filter((row) => matchesNameFilter(row.name, mode, normalizedText));

  let spend = 0;
  let resultCount: number | null = null;
  let revenue: number | null = null;
  for (const row of matching) {
    spend += row.spend;
    if (row.resultCount !== null) resultCount = (resultCount ?? 0) + row.resultCount;
    if (row.revenue !== null) revenue = (revenue ?? 0) + row.revenue;
  }
  const hasAnyRecord = matching.some((row) => row.resultCount !== null);
  const costPerResult = computeCostPerResult(spend, resultCount ?? 0, hasAnyRecord);

  return {
    scope: "consolidated",
    resultType: goal,
    resultCount: resultCount ?? 0,
    hasAnyRecord,
    actualSpend: spend,
    costPerResult,
    costUnavailableReason: getCostPerResultUnavailableReason(spend, resultCount ?? 0, hasAnyRecord),
    // Nunca compara o subconjunto filtrado contra a meta da carteira
    // inteira (ver comentário do topo do arquivo).
    targetCostPerResult: null,
    comparison: compareCostToTarget(costPerResult, null),
    revenue,
    roas: computeRoas(revenue, spend),
    averageTicket: computeAverageTicket(revenue, resultCount ?? 0),
    latestSource: null,
    latestUpdatedAt: null,
  };
}
