import type { PerformanceGoal } from "./performance-goals";

/**
 * Núcleo puro do Módulo de Criativos (Creative Analytics — arquitetura
 * aprovada pelo usuário). Nunca conhece Supabase — só recebe linhas já
 * lidas de `ad_creative_daily_metrics` e devolve agregados prontos pra UI.
 *
 * Identidade do criativo é SEMPRE `creativeName` (= `ad_name` do Meta,
 * nunca `ad_id`/`creative_id`/`video_id`/`image_hash` — esses ids não são
 * estáveis entre edições/reuploads). Toda consolidação por criativo
 * (somando todas as campanhas/dias) acontece aqui, em tempo de consulta —
 * nunca pré-computada/armazenada. CPA/CPC/CTR/ROAS são sempre recalculados
 * a partir de TOTAIS (nunca média simples de valores diários).
 *
 * Degradação graciosa: qualquer indicador cuja coluna de origem nunca foi
 * configurada chega aqui como `null` (nunca `0` fabricado) e continua
 * `null` na saída — a UI decide, olhando pra esse `null`, se mostra ou
 * omite aquele indicador. Nenhuma regra por cliente aqui.
 */
export interface AdCreativeDailyMetricRow {
  date: string;
  campaignName: string;
  creativeName: string;
  creativePermalinkUrl: string | null;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  resultType: PerformanceGoal | null;
  resultCount: number | null;
  revenue: number | null;
}

/** Soma dois valores nullable — `null` só quando os DOIS forem `null`
 * (indicador nunca configurado em nenhuma das linhas somadas); qualquer
 * outra combinação vira soma real, nunca fabricando um `0` pra um lado que
 * de fato tinha valor. */
function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export interface CreativeSummary {
  creativeName: string;
  /** Permalink da linha de DATA MAIS ANTIGA que tiver um link registrado —
   * fixado na "primeira aparição" do criativo, nunca trocado por um link
   * mais recente (regra do usuário: sem cache de imagem/vídeo, a miniatura
   * é sempre a da primeira vez que o criativo apareceu). */
  permalinkUrl: string | null;
  campaignNames: string[];
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
  /** Custo por resultado — `null` sem `totalResultCount` (> 0). */
  cpa: number | null;
  /** Custo por clique — `null` sem `totalClicks` (> 0). */
  cpc: number | null;
  /** Taxa de clique — `null` sem `totalClicks`/`totalImpressions` (> 0). */
  ctr: number | null;
  /** Retorno sobre investimento — `null` sem `totalRevenue`. */
  roas: number | null;
}

interface CreativeAccumulator {
  creativeName: string;
  permalinkUrl: string | null;
  permalinkDate: string | null;
  campaignNames: Set<string>;
  totalSpend: number;
  totalImpressions: number | null;
  totalReach: number | null;
  totalClicks: number | null;
  resultType: PerformanceGoal | null;
  totalResultCount: number | null;
  totalRevenue: number | null;
}

function newAccumulator(creativeName: string): CreativeAccumulator {
  return {
    creativeName,
    permalinkUrl: null,
    permalinkDate: null,
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

function accumulateRow(acc: CreativeAccumulator, row: AdCreativeDailyMetricRow): void {
  acc.campaignNames.add(row.campaignName);
  acc.totalSpend += row.spend;
  acc.totalImpressions = sumNullable(acc.totalImpressions, row.impressions);
  acc.totalReach = sumNullable(acc.totalReach, row.reach);
  acc.totalClicks = sumNullable(acc.totalClicks, row.clicks);
  acc.totalResultCount = sumNullable(acc.totalResultCount, row.resultCount);
  acc.totalRevenue = sumNullable(acc.totalRevenue, row.revenue);
  if (row.resultType) acc.resultType = row.resultType;

  if (row.creativePermalinkUrl && (acc.permalinkDate === null || row.date < acc.permalinkDate)) {
    acc.permalinkUrl = row.creativePermalinkUrl;
    acc.permalinkDate = row.date;
  }
}

function finishSummary(acc: CreativeAccumulator): CreativeSummary {
  return {
    creativeName: acc.creativeName,
    permalinkUrl: acc.permalinkUrl,
    campaignNames: Array.from(acc.campaignNames).sort(),
    totalSpend: acc.totalSpend,
    totalImpressions: acc.totalImpressions,
    totalReach: acc.totalReach,
    totalClicks: acc.totalClicks,
    resultType: acc.resultType,
    totalResultCount: acc.totalResultCount,
    totalRevenue: acc.totalRevenue,
    cpa: acc.totalResultCount && acc.totalResultCount > 0 ? acc.totalSpend / acc.totalResultCount : null,
    cpc: acc.totalClicks && acc.totalClicks > 0 ? acc.totalSpend / acc.totalClicks : null,
    ctr: acc.totalClicks !== null && acc.totalImpressions && acc.totalImpressions > 0 ? acc.totalClicks / acc.totalImpressions : null,
    roas: acc.totalRevenue !== null && acc.totalSpend > 0 ? acc.totalRevenue / acc.totalSpend : null,
  };
}

/** `GROUP BY client_id, creative_name` em tempo de consulta — as linhas de
 * entrada já vêm filtradas por cliente e período; aqui só agrupa por
 * criativo, somando totais. Ordenado por investimento decrescente (mesmo
 * critério de prioridade usado no resto da plataforma: quem consome mais
 * verba aparece primeiro). */
export function buildCreativeSummaries(rows: AdCreativeDailyMetricRow[]): CreativeSummary[] {
  const byCreative = new Map<string, CreativeAccumulator>();

  for (const row of rows) {
    const acc = byCreative.get(row.creativeName) ?? newAccumulator(row.creativeName);
    accumulateRow(acc, row);
    byCreative.set(row.creativeName, acc);
  }

  return Array.from(byCreative.values())
    .map(finishSummary)
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

export interface CreativeCampaignBreakdown {
  campaignName: string;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  resultType: PerformanceGoal | null;
  resultCount: number | null;
  revenue: number | null;
  cpa: number | null;
  cpc: number | null;
  ctr: number | null;
  roas: number | null;
}

export interface CreativeEvolutionPoint {
  date: string;
  spend: number;
  resultCount: number | null;
}

export interface CreativeDetail {
  summary: CreativeSummary;
  /** Uma linha por campanha que usou este criativo — mesmos totais/índices
   * do resumo, recortados por campanha. */
  campaigns: CreativeCampaignBreakdown[];
  /** Uma linha por dia (soma de todas as campanhas daquele dia) — alimenta
   * o gráfico de evolução da tela de detalhe. */
  evolution: CreativeEvolutionPoint[];
}

/** Tela de detalhe de UM criativo — resumo (mesmo formato de
 * `buildCreativeSummaries`, recortado só pra esse nome) + campanhas +
 * evolução diária. `null` quando o criativo não tiver nenhuma linha no
 * período (nunca uma tela vazia fabricada — quem chama decide o 404/estado
 * vazio). */
export function buildCreativeDetail(rows: AdCreativeDailyMetricRow[], creativeName: string): CreativeDetail | null {
  const creativeRows = rows.filter((row) => row.creativeName === creativeName);
  if (creativeRows.length === 0) return null;

  const [summary] = buildCreativeSummaries(creativeRows);

  const byCampaign = new Map<
    string,
    { spend: number; impressions: number | null; reach: number | null; clicks: number | null; resultType: PerformanceGoal | null; resultCount: number | null; revenue: number | null }
  >();
  for (const row of creativeRows) {
    const acc = byCampaign.get(row.campaignName) ?? {
      spend: 0,
      impressions: null,
      reach: null,
      clicks: null,
      resultType: null,
      resultCount: null,
      revenue: null,
    };
    acc.spend += row.spend;
    acc.impressions = sumNullable(acc.impressions, row.impressions);
    acc.reach = sumNullable(acc.reach, row.reach);
    acc.clicks = sumNullable(acc.clicks, row.clicks);
    acc.resultCount = sumNullable(acc.resultCount, row.resultCount);
    acc.revenue = sumNullable(acc.revenue, row.revenue);
    if (row.resultType) acc.resultType = row.resultType;
    byCampaign.set(row.campaignName, acc);
  }

  const campaigns: CreativeCampaignBreakdown[] = Array.from(byCampaign.entries())
    .map(([campaignName, acc]) => ({
      campaignName,
      spend: acc.spend,
      impressions: acc.impressions,
      reach: acc.reach,
      clicks: acc.clicks,
      resultType: acc.resultType,
      resultCount: acc.resultCount,
      revenue: acc.revenue,
      cpa: acc.resultCount && acc.resultCount > 0 ? acc.spend / acc.resultCount : null,
      cpc: acc.clicks && acc.clicks > 0 ? acc.spend / acc.clicks : null,
      ctr: acc.clicks !== null && acc.impressions && acc.impressions > 0 ? acc.clicks / acc.impressions : null,
      roas: acc.revenue !== null && acc.spend > 0 ? acc.revenue / acc.spend : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  const byDate = new Map<string, { spend: number; resultCount: number | null }>();
  for (const row of creativeRows) {
    const acc = byDate.get(row.date) ?? { spend: 0, resultCount: null };
    acc.spend += row.spend;
    acc.resultCount = sumNullable(acc.resultCount, row.resultCount);
    byDate.set(row.date, acc);
  }
  const evolution: CreativeEvolutionPoint[] = Array.from(byDate.entries())
    .map(([date, acc]) => ({ date, spend: acc.spend, resultCount: acc.resultCount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { summary, campaigns, evolution };
}
