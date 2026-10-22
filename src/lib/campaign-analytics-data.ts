import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQueryToleratingMissingColumn } from "./require-query";
import { dedupeRowsByProviderPreference, getMetaImportSourceProviderMap } from "./granular-provider-dedup";
import type { CampaignDailyMetricRow } from "./campaign-analytics";
import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Leitura de `campaign_daily_metrics` pra UM cliente + período — sem
 * nenhuma agregação aqui (isso é sempre `lib/campaign-analytics.ts`, puro e
 * testável sem Supabase). Camada independente de
 * `creative-analytics-data.ts`/`ad_creative_daily_metrics` — Campanhas nunca
 * mais depende de Criativos. Cliente sem nenhuma fonte com
 * `campaign_name_column` configurado simplesmente nunca tem linha nesta
 * tabela — devolve `[]`, nunca um erro.
 *
 * `link_clicks` (Etapa 2.4) é lido com `requireQueryToleratingMissingColumn`
 * — a coluna só existe depois que `supabase/meta-ads-link-clicks.sql`
 * rodar manualmente; antes disso, a mesma consulta é repetida sem essa
 * coluna, e cada linha recebe `linkClicks: null` (ausência de dado, nunca
 * um erro que derrubaria a tela).
 *
 * Migração Stract -> Meta API direta: `dedupeRowsByProviderPreference`
 * (`lib/granular-provider-dedup.ts`) descarta linhas `stract` de qualquer
 * (conta, data) em que `meta_api` também tenha linha — nunca soma as duas
 * fontes. Histórico 100% Stract (sem overlap) continua intacto.
 */
export async function getCampaignDailyMetricsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<CampaignDailyMetricRow[]> {
  const [result, sourceById] = await Promise.all([
    requireQueryToleratingMissingColumn(
      supabase
        .from("campaign_daily_metrics")
        .select(
          "date, channel, campaign_name, campaign_id, spend, impressions, reach, clicks, link_clicks, result_type, result_count, revenue, import_source_id",
        )
        .eq("client_id", clientId)
        .gte("date", period.start)
        .lte("date", period.end),
      () =>
        supabase
          .from("campaign_daily_metrics")
          .select("date, channel, campaign_name, campaign_id, spend, impressions, reach, clicks, result_type, result_count, revenue, import_source_id")
          .eq("client_id", clientId)
          .gte("date", period.start)
          .lte("date", period.end),
      "link_clicks",
      "campaign_daily_metrics:period",
    ),
    getMetaImportSourceProviderMap(supabase, clientId),
  ]);

  // Branches mantidas 100% separadas (nunca uma só chamada de `.map()`
  // sobre a união `TFull[] | TFallback[]`) — garante que `row` tenha sempre
  // um tipo concreto, nunca uma união que faria o cast de `link_clicks`
  // falhar no tipo que não tem essa coluna.
  if (result.usedFallback) {
    const dedupedRows = dedupeRowsByProviderPreference(result.rows, (row) => row.import_source_id, (row) => row.date, sourceById);
    return dedupedRows.map((row) => ({
      date: row.date,
      channel: row.channel as TrafficChannel,
      campaignName: row.campaign_name,
      campaignId: row.campaign_id,
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
    channel: row.channel as TrafficChannel,
    campaignName: row.campaign_name,
    campaignId: row.campaign_id,
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
