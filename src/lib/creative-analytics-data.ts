import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQueryToleratingMissingColumn } from "./require-query";
import { dedupeRowsByProviderPreference, getMetaImportSourceProviderMap } from "./granular-provider-dedup";
import type { AdCreativeDailyMetricRow } from "./creative-analytics";
import type { PerformanceGoal } from "./performance-goals";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Leitura de `ad_creative_daily_metrics` pra UM cliente + período — sem
 * nenhuma agregação aqui (isso é sempre `lib/creative-analytics.ts`, puro
 * e testável sem Supabase). Cliente sem nenhuma fonte com `ad_name_column`
 * configurado simplesmente nunca tem linha nesta tabela — devolve `[]`,
 * nunca um erro (ausência de configuração não é falha de infraestrutura).
 *
 * `link_clicks` (Etapa 2.4) é lido com `requireQueryToleratingMissingColumn`
 * — a coluna só existe depois que `supabase/meta-ads-link-clicks.sql`
 * rodar manualmente; antes disso, a mesma consulta é repetida sem essa
 * coluna, e cada linha recebe `linkClicks: null` (ausência de dado, nunca
 * um erro que derrubaria a tela).
 *
 * Migração Stract -> Meta API direta: ver dedup em `getCampaignDailyMetricsForPeriod`
 * (`lib/campaign-analytics-data.ts`) — mesma lógica, mesma função compartilhada
 * (`lib/granular-provider-dedup.ts`).
 */
export async function getAdCreativeDailyMetricsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<AdCreativeDailyMetricRow[]> {
  const [result, sourceById] = await Promise.all([
    requireQueryToleratingMissingColumn(
      supabase
        .from("ad_creative_daily_metrics")
        .select(
          "date, campaign_name, campaign_id, creative_name, creative_permalink_url, preview_image_url, spend, impressions, reach, clicks, link_clicks, result_type, result_count, revenue, import_source_id",
        )
        .eq("client_id", clientId)
        .gte("date", period.start)
        .lte("date", period.end),
      () =>
        supabase
          .from("ad_creative_daily_metrics")
          .select(
            "date, campaign_name, campaign_id, creative_name, creative_permalink_url, preview_image_url, spend, impressions, reach, clicks, result_type, result_count, revenue, import_source_id",
          )
          .eq("client_id", clientId)
          .gte("date", period.start)
          .lte("date", period.end),
      "link_clicks",
      "ad_creative_daily_metrics:period",
    ),
    getMetaImportSourceProviderMap(supabase, clientId),
  ]);

  // Branches mantidas separadas — ver comentário em
  // `getCampaignDailyMetricsForPeriod` (`lib/campaign-analytics-data.ts`).
  if (result.usedFallback) {
    const dedupedRows = dedupeRowsByProviderPreference(result.rows, (row) => row.import_source_id, (row) => row.date, sourceById);
    return dedupedRows.map((row) => ({
      date: row.date,
      campaignName: row.campaign_name,
      campaignId: row.campaign_id,
      creativeName: row.creative_name,
      creativePermalinkUrl: row.creative_permalink_url,
      previewImageUrl: row.preview_image_url,
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      linkClicks: null,
      resultType: row.result_type as PerformanceGoal | null,
      resultCount: row.result_count,
      revenue: row.revenue,
    }));
  }

  const dedupedRows = dedupeRowsByProviderPreference(result.rows, (row) => row.import_source_id, (row) => row.date, sourceById);
  return dedupedRows.map((row) => ({
    date: row.date,
    campaignName: row.campaign_name,
    campaignId: row.campaign_id,
    creativeName: row.creative_name,
    creativePermalinkUrl: row.creative_permalink_url,
    previewImageUrl: row.preview_image_url,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    linkClicks: row.link_clicks,
    resultType: row.result_type as PerformanceGoal | null,
    resultCount: row.result_count,
    revenue: row.revenue,
  }));
}
