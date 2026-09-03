import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { buildAnalyticsKpiCards, type AnalyticsKpiCard } from "@/lib/analytics";
import type { ClientAnalyticsData } from "@/app/clients/analytics-data";
import { fetchClientAnalyticsData } from "@/app/clients/analytics-data";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { buildCampaignSummaries, type CampaignSummary } from "@/lib/campaign-analytics";
import { getAdSetDailyMetricsForPeriod } from "@/lib/ad-set-analytics-data";
import { buildAdSetSummaries, type AdSetSummary } from "@/lib/ad-set-analytics";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries, type CreativeSummary } from "@/lib/creative-analytics";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada 1 do Gerador de Relatório de Performance — dado puro, nenhum
 * cálculo novo: TUDO aqui vem de uma função já usada/auditada em outro lugar
 * da MITZA (`fetchClientAnalyticsData` + `buildAnalyticsKpiCards`, as MESMAS
 * do hub de Analytics; `buildCampaignSummaries`/`buildAdSetSummaries`/
 * `buildCreativeSummaries`, os MESMOS agregadores canônicos das respectivas
 * seções). v1 é deliberadamente Meta-only (pedido explícito do usuário,
 * "Priorize Meta Ads") — nenhuma lógica de seletor de plataforma/Google
 * Ads aqui, ao contrário de `analytics-report/report-data.ts`.
 *
 * `summary` espelha os 2 estados reais de `AnalyticsSection` sem objetivo
 * configurado (`no_goal`) ou sem nenhum dado no período (`no_data`) — nunca
 * um 3º estado "platform_not_connected" (não existe seletor de plataforma
 * nesta v1). Campanhas/Públicos/Criativos são buscados INDEPENDENTE do
 * status do objetivo — um cliente sem `performance_goal` configurado ainda
 * pode ter investimento/campanhas reais no período.
 */
export type PerformanceReportSummary = { status: "no_goal" } | { status: "no_data" } | { status: "ok"; kpis: AnalyticsKpiCard[] };

export interface PerformanceReportData {
  client: { id: string; name: string };
  period: { start: string; end: string; label: string };
  summary: PerformanceReportSummary;
  campaigns: CampaignSummary[];
  adSets: AdSetSummary[];
  creatives: CreativeSummary[];
  generatedAt: string;
}

function buildReportSummary(data: ClientAnalyticsData): PerformanceReportSummary {
  if (!data.performanceGoal) return { status: "no_goal" };

  const hasAnyData = data.actualSpend > 0 || (data.summary?.hasAnyRecord ?? false);
  if (!hasAnyData) return { status: "no_data" };

  // `previousSummary: null` deliberado — este relatório nunca mostra
  // variação percentual vs. período anterior (pedido explícito do usuário
  // na 1ª auditoria: "recalculados a partir dos totais", nunca comparação
  // temporal nos KPIs do topo). `buildAnalyticsKpiCards` já trata
  // `previousSummary: null` como "sem base de comparação", omitindo a linha
  // de contexto sem nenhuma mudança na função em si.
  const kpis = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, null, formatCurrency);
  return { status: "ok", kpis };
}

export async function buildPerformanceReportData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<PerformanceReportData> {
  const [clientRows, analyticsData, campaignRowsAllChannels, adSetRowsAllChannels, creativeRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:performance-report"),
    fetchClientAnalyticsData(supabase, clientId, period, "meta"),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
    getAdSetDailyMetricsForPeriod(supabase, clientId, period),
    getAdCreativeDailyMetricsForPeriod(supabase, clientId, period),
  ]);

  const client = clientRows[0];

  // Meta-only v1: campaign_daily_metrics/ad_set_daily_metrics são
  // channel-aware (podem ter linhas de outros canais se o cliente também
  // usa Google) — filtra explicitamente. ad_creative_daily_metrics já é
  // implicitamente Meta-only (sem coluna de canal), nenhum filtro necessário.
  const campaigns = buildCampaignSummaries(campaignRowsAllChannels.filter((row) => row.channel === "meta"));
  const adSets = buildAdSetSummaries(adSetRowsAllChannels.filter((row) => row.channel === "meta"));
  const creatives = buildCreativeSummaries(creativeRows);

  return {
    client: { id: client.id, name: client.name },
    period: { start: period.start, end: period.end, label: formatDateRange(period.start, period.end) },
    summary: buildReportSummary(analyticsData),
    campaigns,
    adSets,
    creatives,
    generatedAt: new Date().toISOString(),
  };
}
