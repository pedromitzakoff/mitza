import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

/**
 * Núcleo puro da seção "Públicos" (Ad Set Analytics) — arquitetura aprovada
 * após inspeção somente leitura de uma fonte real (Ateliê): a extração já
 * traz `insights_adset_name` no grão dia×campanha×ad set×anúncio, então
 * `ad_set_daily_metrics` (ver `lib/import-sources.ts`) já chega aqui SOMADA
 * por dia+canal+campanha+ad set (nunca por anúncio). Consolidação por
 * PÚBLICO (somando todas as campanhas) acontece aqui, em tempo de consulta —
 * mesma disciplina de `lib/creative-analytics.ts`.
 *
 * Identidade de público = `(channel, adSetName)` — NUNCA `campaignName` +
 * `adSetName`: o mesmo público (ex.: "00 - Seguidores Entourage") pode rodar
 * em mais de uma campanha ao longo do período, e o gestor quer ver ESSE
 * público como uma linha só, com `campaignNames` listando onde ele apareceu
 * (mesmo padrão de `CreativeSummary.campaignNames`). Canal entra na
 * identidade pelo mesmo motivo de campanha (`campaign-analytics.ts`): Meta e
 * Google podem ter públicos com o mesmo nome, nunca somados juntos.
 *
 * Sem `ad_set_id` — hoje só existe o nome no Stract (ver auditoria), nunca
 * fabricado. CPA/CPC/CTR/ROAS sempre recalculados a partir de TOTAIS (nunca
 * média simples).
 */
export interface AdSetDailyMetricRow {
  date: string;
  channel: TrafficChannel;
  campaignName: string;
  adSetName: string;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  resultType: PerformanceGoal | null;
  resultCount: number | null;
  revenue: number | null;
}

export interface AdSetSummary {
  adSetName: string;
  channel: TrafficChannel;
  campaignNames: string[];
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
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

interface AdSetAccumulator {
  adSetName: string;
  channel: TrafficChannel;
  campaignNames: Set<string>;
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
}

function newAccumulator(channel: TrafficChannel, adSetName: string): AdSetAccumulator {
  return {
    adSetName,
    channel,
    campaignNames: new Set(),
    totalSpend: 0,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
  };
}

function accumulateRow(acc: AdSetAccumulator, row: AdSetDailyMetricRow): void {
  acc.campaignNames.add(row.campaignName);
  acc.totalSpend += row.spend;
  acc.totalImpressions = sumNullable(acc.totalImpressions, row.impressions);
  acc.totalReach = sumNullable(acc.totalReach, row.reach);
  acc.totalClicks = sumNullable(acc.totalClicks, row.clicks);
  acc.totalResultCount = sumNullable(acc.totalResultCount, row.resultCount);
  acc.totalRevenue = sumNullable(acc.totalRevenue, row.revenue);
  if (row.resultType) acc.resultType = row.resultType;
}

/** Normalização MÍNIMA do nome — só remove espaços acidentais no início/fim
 * (nunca fuzzy match, nunca mudança de caixa): "Público A" e " Público A "
 * são o MESMO público (espaçamento acidental na origem), mas "Público A" e
 * "Público A - Variante" continuam sendo públicos diferentes. O nome
 * normalizado também é o nome exibido — determinístico por construção,
 * nunca depende de qual linha chegou primeiro (todo registro do mesmo
 * grupo, por definição, produz o mesmo nome normalizado). */
function normalizeAdSetName(adSetName: string): string {
  return adSetName.trim();
}

/** Chave de agrupamento = canal + nome do ad set (já normalizado) — nunca
 * campanha (ver comentário do arquivo: um público pode rodar em várias
 * campanhas). */
function adSetGroupKey(channel: TrafficChannel, normalizedAdSetName: string): string {
  return `${channel}::${normalizedAdSetName}`;
}

/** `GROUP BY client_id, channel, TRIM(ad_set_name)` em tempo de consulta —
 * ordenado por investimento decrescente, mesmo critério de Campanhas/
 * Criativos. */
export function buildAdSetSummaries(rows: AdSetDailyMetricRow[]): AdSetSummary[] {
  const byAdSet = new Map<string, AdSetAccumulator>();

  for (const row of rows) {
    const adSetName = normalizeAdSetName(row.adSetName);
    const key = adSetGroupKey(row.channel, adSetName);
    const acc = byAdSet.get(key) ?? newAccumulator(row.channel, adSetName);
    accumulateRow(acc, row);
    byAdSet.set(key, acc);
  }

  return Array.from(byAdSet.values())
    .map((acc): AdSetSummary => {
      const totalResultCount = acc.totalResultCount;
      return {
        adSetName: acc.adSetName,
        channel: acc.channel,
        campaignNames: Array.from(acc.campaignNames).sort(),
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
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}
