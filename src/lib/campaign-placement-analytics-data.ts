import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQuery } from "./require-query";
import { dedupeRowsByProviderPreference, getMetaImportSourceProviderMap } from "./granular-provider-dedup";
import type { CampaignPlacementDailyMetricRow } from "./campaign-placement-analytics";
import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Leitura de `campaign_placement_daily_metrics` pra UM cliente + período —
 * sem nenhuma agregação aqui (isso é sempre `lib/campaign-placement-analytics.ts`,
 * puro e testável sem Supabase). Cliente sem nenhuma fonte com
 * `platform_position_column` configurado simplesmente nunca tem linha nesta
 * tabela — devolve `[]`, nunca um erro (mesmo padrão de
 * `getCampaignDailyMetricsForPeriod`).
 *
 * Migração Stract -> Meta API direta: ver dedup em `getCampaignDailyMetricsForPeriod`
 * (`lib/campaign-analytics-data.ts`) — mesma lógica, mesma função compartilhada
 * (`lib/granular-provider-dedup.ts`).
 */
export async function getCampaignPlacementDailyMetricsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<CampaignPlacementDailyMetricRow[]> {
  const [rows, sourceById] = await Promise.all([
    requireQuery(
      supabase
        .from("campaign_placement_daily_metrics")
        .select("date, channel, campaign_name, campaign_id, platform_position, spend, result_type, result_count, revenue, import_source_id")
        .eq("client_id", clientId)
        .gte("date", period.start)
        .lte("date", period.end),
      "campaign_placement_daily_metrics:period",
    ),
    getMetaImportSourceProviderMap(supabase, clientId),
  ]);

  const dedupedRows = dedupeRowsByProviderPreference(
    rows,
    (row) => row.import_source_id,
    (row) => row.date,
    sourceById,
  );

  return dedupedRows.map((row) => ({
    date: row.date,
    channel: row.channel as TrafficChannel,
    campaignName: row.campaign_name,
    campaignId: row.campaign_id,
    platformPosition: row.platform_position,
    spend: row.spend,
    resultType: row.result_type as PerformanceGoal | null,
    resultCount: row.result_count,
    revenue: row.revenue,
  }));
}
