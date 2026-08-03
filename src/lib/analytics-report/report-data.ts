import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatCurrency, formatDateRange } from "@/lib/format";
import {
  buildAnalyticsHero,
  buildAnalyticsKpiCards,
  buildLearningsNarrative,
  buildResultHeadline,
  buildResultLede,
  buildTrendCaption,
  type AnalyticsKpiCard,
  type AnalyticsTrend,
} from "@/lib/analytics";
import { buildPeriodHighlights, type PeriodHighlight } from "@/lib/period-highlights";
import { fetchClientAnalyticsData, type ClientAnalyticsData } from "@/app/clients/analytics-data";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { buildCampaignSummaries, type CampaignSummary } from "@/lib/campaign-analytics";
import { buildCreativeSummaries, type CreativeSummary } from "@/lib/creative-analytics";
import { FUTURE_OPPORTUNITY_CATEGORIES } from "@/lib/analytics-messages";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada 1 do AnalyticsReport (arquitetura em
 * `docs/ANALYTICS_REPORT_EXPORT_ARCHITECTURE.md`) — dado puro, mesma
 * estrutura pra qualquer tema/formato de saída. Restrição não-negociável:
 * TODO valor aqui vem de uma função já usada pelo Analytics na tela
 * (`analytics-section.tsx`) — nunca uma fórmula nova só pro relatório.
 *
 * `summary` espelha os 3 estados que `AnalyticsSection` já trata (sem
 * objetivo / sem dado / com dado) — discriminado por `status`, pra o
 * renderer nunca precisar adivinhar qual empty state mostrar.
 */
export type AnalyticsReportSummary =
  | { status: "no_goal" }
  | { status: "no_data" }
  | {
      status: "ok";
      headline: string;
      lede: string;
      kpis: AnalyticsKpiCard[];
      trend: AnalyticsTrend | null;
      trendCaption: string | null;
      highlights: PeriodHighlight[];
      learnings: string[];
    };

export interface AnalyticsReportData {
  client: { id: string; name: string };
  period: { start: string; end: string; label: string };
  summary: AnalyticsReportSummary;
  /** Mesma lista estática do bloco "Oportunidades" do Resumo Executivo
   * (`FUTURE_OPPORTUNITY_CATEGORIES`) — reserva de espaço, sem inteligência
   * própria (ver `analytics-opportunities.tsx`). */
  opportunities: string[];
  creatives: CreativeSummary[];
  campaigns: CampaignSummary[];
  generatedAt: string;
}

function buildReportSummary(data: ClientAnalyticsData, creatives: CreativeSummary[], campaigns: CampaignSummary[]): AnalyticsReportSummary {
  if (!data.performanceGoal) return { status: "no_goal" };

  const hasAnyData = data.actualSpend > 0 || (data.summary?.hasAnyRecord ?? false);
  if (!hasAnyData) return { status: "no_data" };

  const goal = data.performanceGoal;
  const hasAnyRecord = data.summary?.hasAnyRecord ?? false;
  const hero = buildAnalyticsHero({ goal, summary: data.summary!, previousSummary: data.previousSummary, formatCurrencyValue: formatCurrency });
  const headline = buildResultHeadline(goal, hero, hasAnyRecord);
  const lede = buildResultLede({ goal, hero, hasAnyRecord, actualSpend: data.actualSpend, formatCurrencyValue: formatCurrency });
  const kpis = buildAnalyticsKpiCards(goal, data.actualSpend, data.summary, data.previousSummary, formatCurrency);
  const learnings = buildLearningsNarrative({
    goal,
    summary: data.summary!,
    previousSummary: data.previousSummary,
    channelRows: data.channelRows,
    totalActualSpend: data.actualSpend,
    heroPercentChange: hero.percentChange,
  });
  const trendCaption = data.trend ? buildTrendCaption(data.trend) : null;
  const highlights = buildPeriodHighlights({
    goal,
    trend: data.trend,
    creativeSummaries: creatives,
    campaignSummaries: campaigns,
    formatCurrencyValue: formatCurrency,
  });

  return { status: "ok", headline, lede, kpis, trend: data.trend, trendCaption, highlights, learnings };
}

export async function buildAnalyticsReportData(supabase: Supabase, clientId: string, period: { start: string; end: string }): Promise<AnalyticsReportData> {
  // Integração Google Ads: Campanhas é uma busca independente de Criativos
  // desde a origem (`campaign_daily_metrics`, channel-aware) — nunca mais
  // derivada de `ad_creative_daily_metrics` (Meta-only).
  const [clientRows, data, adCreativeRows, campaignRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:analytics-report"),
    fetchClientAnalyticsData(supabase, clientId, period),
    getAdCreativeDailyMetricsForPeriod(supabase, clientId, period),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
  ]);

  const client = clientRows[0];
  const creatives = buildCreativeSummaries(adCreativeRows);
  const campaigns = buildCampaignSummaries(campaignRows);

  return {
    client: { id: client.id, name: client.name },
    period: { start: period.start, end: period.end, label: formatDateRange(period.start, period.end) },
    summary: buildReportSummary(data, creatives, campaigns),
    opportunities: [...FUTURE_OPPORTUNITY_CATEGORIES],
    creatives,
    campaigns,
    generatedAt: new Date().toISOString(),
  };
}
