import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQuery } from "./require-query";
import type { AdSetDailyMetricRow } from "./ad-set-analytics";
import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Leitura de `ad_set_daily_metrics` pra UM cliente + período — sem nenhuma
 * agregação aqui (isso é sempre `lib/ad-set-analytics.ts`, puro e testável
 * sem Supabase). Cliente sem nenhuma fonte com `ad_set_name_column`
 * configurado simplesmente nunca tem linha nesta tabela — devolve `[]`,
 * nunca um erro (ausência de configuração não é falha de infraestrutura,
 * mesmo critério de `getCampaignDailyMetricsForPeriod`/
 * `getAdCreativeDailyMetricsForPeriod`).
 */
export async function getAdSetDailyMetricsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<AdSetDailyMetricRow[]> {
  const rows = await requireQuery(
    supabase
      .from("ad_set_daily_metrics")
      .select("date, channel, campaign_name, ad_set_name, spend, impressions, reach, clicks, result_type, result_count, revenue")
      .eq("client_id", clientId)
      .gte("date", period.start)
      .lte("date", period.end),
    "ad_set_daily_metrics:period",
  );

  return rows.map((row) => ({
    date: row.date,
    channel: row.channel as TrafficChannel,
    campaignName: row.campaign_name,
    adSetName: row.ad_set_name,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    resultType: row.result_type as PerformanceGoal | null,
    resultCount: row.result_count,
    revenue: row.revenue,
  }));
}
