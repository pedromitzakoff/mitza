import { computeCostPerResult, computeRoas, safeDivide } from "./performance";
import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

/**
 * Núcleo puro da seção "Posicionamentos" do Relatório de Performance —
 * pedido explícito do usuário (comparar investimento/resultado por
 * posicionamento do anúncio: feed, stories, reels etc.). Lê
 * `campaign_placement_daily_metrics`, granularidade EXTRA em relação a
 * `campaign_daily_metrics` (que continua a fonte de verdade do total real
 * por campanha/dia, intocada por esta camada).
 *
 * MVP escopado pelo usuário: comparação no TOTAL DA CONTA — agrupa só por
 * `platformPosition` (soma todas as campanhas juntas), nunca por campanha
 * nesta primeira versão. A tabela guarda a granularidade de campanha (pra
 * uma versão futura por-campanha não exigir reprocessar nada), mas esta
 * camada de apresentação ignora `campaignName` de propósito.
 *
 * CPA/ROAS sempre via `computeCostPerResult`/`computeRoas`
 * (`lib/performance.ts`) — nunca uma segunda fórmula de divisão.
 */
export interface CampaignPlacementDailyMetricRow {
  date: string;
  channel: TrafficChannel;
  campaignName: string;
  platformPosition: string;
  spend: number;
  resultType: PerformanceGoal | null;
  resultCount: number | null;
  revenue: number | null;
}

export interface PlacementSummary {
  platformPosition: string;
  totalSpend: number;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
  cpa: number | null;
  roas: number | null;
  /** Fração 0-1 do investimento total (soma de todos os posicionamentos do
   * período) — nunca calculada contra um total de fora deste conjunto de
   * linhas. */
  spendShare: number;
  /** Fração 0-1 do resultado total — `null` quando nenhum posicionamento
   * tem resultado mapeado (nenhum `metric_mappings` de leads/vendas
   * aplicável), pra nunca fabricar uma participação sobre um total zero/
   * inexistente. */
  resultShare: number | null;
}

interface PlacementAccumulator {
  platformPosition: string;
  totalSpend: number;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function newAccumulator(platformPosition: string): PlacementAccumulator {
  return { platformPosition, totalSpend: 0, resultType: null, totalResultCount: null, totalRevenue: null };
}

/** `GROUP BY platform_position` em tempo de consulta — ordenado por
 * investimento decrescente, mesmo critério já usado por Campanhas/Públicos/
 * Criativos. */
export function buildPlacementSummaries(rows: CampaignPlacementDailyMetricRow[]): PlacementSummary[] {
  const byPlacement = new Map<string, PlacementAccumulator>();

  for (const row of rows) {
    const acc = byPlacement.get(row.platformPosition) ?? newAccumulator(row.platformPosition);
    acc.totalSpend += row.spend;
    acc.totalResultCount = sumNullable(acc.totalResultCount, row.resultCount);
    acc.totalRevenue = sumNullable(acc.totalRevenue, row.revenue);
    if (row.resultType) acc.resultType = row.resultType;
    byPlacement.set(row.platformPosition, acc);
  }

  const accumulators = Array.from(byPlacement.values());
  const grandTotalSpend = accumulators.reduce((sum, acc) => sum + acc.totalSpend, 0);
  const grandTotalResultCount = accumulators.reduce<number | null>((sum, acc) => sumNullable(sum, acc.totalResultCount), null);

  return accumulators
    .map((acc) => {
      const hasAnyRecord = acc.totalResultCount !== null;
      const cpa = computeCostPerResult(acc.totalSpend, acc.totalResultCount ?? 0, hasAnyRecord);
      const roas = computeRoas(acc.totalRevenue, acc.totalSpend);

      return {
        platformPosition: acc.platformPosition,
        totalSpend: acc.totalSpend,
        resultType: acc.resultType,
        totalResultCount: acc.totalResultCount,
        totalRevenue: acc.totalRevenue,
        cpa,
        roas,
        spendShare: safeDivide(acc.totalSpend, grandTotalSpend) ?? 0,
        resultShare:
          grandTotalResultCount && grandTotalResultCount > 0 ? safeDivide(acc.totalResultCount, grandTotalResultCount) : null,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
