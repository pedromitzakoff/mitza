import type { PerformanceGoal } from "./performance-goals";
import type { AdCreativeDailyMetricRow } from "./creative-analytics";
import { computePercentChange } from "./period-comparison";

/**
 * Núcleo puro da seção "Campanhas" do hub de Analytics — mesma fonte de
 * dados de `lib/creative-analytics.ts` (`ad_creative_daily_metrics`), só que
 * consolidada por `campaign_name` em vez de `creative_name`. Nenhuma tabela
 * nova, nenhuma regra de importação nova — pura reorganização de leitura,
 * exatamente como o resto do módulo de Criativos: `GROUP BY client_id,
 * campaign_name` em tempo de consulta, nunca pré-computado/armazenado.
 *
 * CPA/CTR/ROAS sempre recalculados a partir de TOTAIS (nunca média simples),
 * mesmo princípio já estabelecido pro módulo de Criativos.
 */

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export interface CampaignSummary {
  campaignName: string;
  creativeCount: number;
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
  cpa: number | null;
  cpc: number | null;
  ctr: number | null;
  roas: number | null;
  /** Variação % do resultado principal (ou, sem resultado mapeado,
   * do investimento) em relação ao período anterior de mesma duração —
   * `null` sem base anterior confiável (nunca fabricado). */
  percentChange: number | null;
}

interface CampaignAccumulator {
  campaignName: string;
  creativeNames: Set<string>;
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
}

function newAccumulator(campaignName: string): CampaignAccumulator {
  return {
    campaignName,
    creativeNames: new Set(),
    totalSpend: 0,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
  };
}

function accumulateRow(acc: CampaignAccumulator, row: AdCreativeDailyMetricRow): void {
  acc.creativeNames.add(row.creativeName);
  acc.totalSpend += row.spend;
  acc.totalImpressions = sumNullable(acc.totalImpressions, row.impressions);
  acc.totalReach = sumNullable(acc.totalReach, row.reach);
  acc.totalClicks = sumNullable(acc.totalClicks, row.clicks);
  acc.totalResultCount = sumNullable(acc.totalResultCount, row.resultCount);
  acc.totalRevenue = sumNullable(acc.totalRevenue, row.revenue);
  if (row.resultType) acc.resultType = row.resultType;
}

function summarizeByCampaign(rows: AdCreativeDailyMetricRow[]): Map<string, CampaignAccumulator> {
  const byCampaign = new Map<string, CampaignAccumulator>();
  for (const row of rows) {
    const acc = byCampaign.get(row.campaignName) ?? newAccumulator(row.campaignName);
    accumulateRow(acc, row);
    byCampaign.set(row.campaignName, acc);
  }
  return byCampaign;
}

/**
 * `GROUP BY client_id, campaign_name` em tempo de consulta — `previousRows`
 * é opcional (linhas do período anterior de mesma duração, já filtradas por
 * cliente); sem ele, `percentChange` vem sempre `null` (nunca comparação
 * fabricada). Ordenado por investimento decrescente, mesmo critério já
 * usado pra Criativos.
 */
export function buildCampaignSummaries(rows: AdCreativeDailyMetricRow[], previousRows?: AdCreativeDailyMetricRow[]): CampaignSummary[] {
  const current = summarizeByCampaign(rows);
  const previous = previousRows ? summarizeByCampaign(previousRows) : null;

  return Array.from(current.values())
    .map((acc) => {
      const totalResultCount = acc.totalResultCount;
      const previousAcc = previous?.get(acc.campaignName) ?? null;

      // Prioriza comparar o resultado principal (mais significativo pro
      // gestor); sem resultado mapeado pra essa fonte, cai pra investimento
      // — nunca deixa de mostrar uma tendência só porque o objetivo não tem
      // metric_mappings configurado.
      const percentChange =
        totalResultCount !== null
          ? computePercentChange(totalResultCount, previousAcc?.totalResultCount ?? null)
          : computePercentChange(acc.totalSpend, previousAcc?.totalSpend ?? null);

      return {
        campaignName: acc.campaignName,
        creativeCount: acc.creativeNames.size,
        totalSpend: acc.totalSpend,
        totalImpressions: acc.totalImpressions,
        totalReach: acc.totalReach,
        totalClicks: acc.totalClicks,
        resultType: acc.resultType,
        totalResultCount,
        totalRevenue: acc.totalRevenue,
        cpa: totalResultCount && totalResultCount > 0 ? acc.totalSpend / totalResultCount : null,
        cpc: acc.totalClicks && acc.totalClicks > 0 ? acc.totalSpend / acc.totalClicks : null,
        ctr: acc.totalClicks !== null && acc.totalImpressions && acc.totalImpressions > 0 ? acc.totalClicks / acc.totalImpressions : null,
        roas: acc.totalRevenue !== null && acc.totalSpend > 0 ? acc.totalRevenue / acc.totalSpend : null,
        percentChange,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
