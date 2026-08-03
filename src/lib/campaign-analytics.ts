import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

/**
 * Núcleo puro da seção "Campanhas" do hub de Analytics — camada
 * INDEPENDENTE de Criativos (achado da auditoria da integração Google Ads:
 * a versão anterior reaproveitava `ad_creative_daily_metrics`, Meta-only,
 * só agrupando por `campaign_name` em vez de `creative_name` — o que
 * tornava Campanhas Google impossível sem fabricar criativo). Lê
 * `campaign_daily_metrics`, channel-aware desde a origem (populada sempre
 * que `campaign_name_column` existir na fonte, independente de
 * `ad_name_column` — ver `lib/stract-sync.ts`) — nenhuma tabela de criativo
 * envolvida aqui.
 *
 * Identidade analítica de campanha = `(channel, campaignName)` — NUNCA só
 * `campaignName`: Meta e Google podem ter campanhas com o mesmo nome, e
 * nunca devem ser somadas juntas.
 *
 * CPA/CTR/ROAS sempre recalculados a partir de TOTAIS (nunca média simples).
 * Etapa "Resumo Executivo": deliberadamente SEM variação percentual vs.
 * período anterior — pedido explícito do usuário ("essa informação gera
 * mais dúvida do que valor... não quero esse tipo de comparação aqui").
 */

export interface CampaignDailyMetricRow {
  date: string;
  channel: TrafficChannel;
  campaignName: string;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  resultType: PerformanceGoal | null;
  resultCount: number | null;
  revenue: number | null;
}

export interface CampaignSummary {
  campaignName: string;
  channel: TrafficChannel;
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

interface CampaignAccumulator {
  campaignName: string;
  channel: TrafficChannel;
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
}

function newAccumulator(channel: TrafficChannel, campaignName: string): CampaignAccumulator {
  return {
    campaignName,
    channel,
    totalSpend: 0,
    totalImpressions: null,
    totalReach: null,
    totalClicks: null,
    resultType: null,
    totalResultCount: null,
    totalRevenue: null,
  };
}

function accumulateRow(acc: CampaignAccumulator, row: CampaignDailyMetricRow): void {
  acc.totalSpend += row.spend;
  acc.totalImpressions = sumNullable(acc.totalImpressions, row.impressions);
  acc.totalReach = sumNullable(acc.totalReach, row.reach);
  acc.totalClicks = sumNullable(acc.totalClicks, row.clicks);
  acc.totalResultCount = sumNullable(acc.totalResultCount, row.resultCount);
  acc.totalRevenue = sumNullable(acc.totalRevenue, row.revenue);
  if (row.resultType) acc.resultType = row.resultType;
}

/** Chave de agrupamento = canal + nome — nunca só o nome (ver comentário do
 * arquivo: Meta e Google podem ter campanhas homônimas). */
function campaignGroupKey(channel: TrafficChannel, campaignName: string): string {
  return `${channel}::${campaignName}`;
}

function summarizeByCampaign(rows: CampaignDailyMetricRow[]): Map<string, CampaignAccumulator> {
  const byCampaign = new Map<string, CampaignAccumulator>();
  for (const row of rows) {
    const key = campaignGroupKey(row.channel, row.campaignName);
    const acc = byCampaign.get(key) ?? newAccumulator(row.channel, row.campaignName);
    accumulateRow(acc, row);
    byCampaign.set(key, acc);
  }
  return byCampaign;
}

/**
 * `GROUP BY client_id, channel, campaign_name` em tempo de consulta —
 * ordenado por investimento decrescente, mesmo critério já usado pra
 * Criativos.
 */
export function buildCampaignSummaries(rows: CampaignDailyMetricRow[]): CampaignSummary[] {
  const current = summarizeByCampaign(rows);

  return Array.from(current.values())
    .map((acc) => {
      const totalResultCount = acc.totalResultCount;

      return {
        campaignName: acc.campaignName,
        channel: acc.channel,
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
