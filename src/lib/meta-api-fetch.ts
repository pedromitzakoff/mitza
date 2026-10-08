import type { MetaApiIngestRow } from "@/lib/meta-api-ingest";

/**
 * MITZA ONE — Busca direta na Meta Marketing API (substitui o papel que
 * `docs/N8N_META_INGESTION_GUIDE.md` descreve pro n8n: "busca dado bruto na
 * Meta e faz UM POST pra MITZA"). Em vez de um workflow externo fazendo essa
 * chamada e enviando pro endpoint `/api/n8n/meta-insights`, esta função faz
 * a MESMA chamada à Graph API diretamente do servidor da MITZA — o destino
 * final é idêntico: `ingestMetaApiPayload` (`lib/meta-api-ingest-run.ts`),
 * reaproveitado sem nenhuma alteração, nenhuma segunda regra de
 * agregação/gravação.
 *
 * Mesmos parâmetros documentados no guia n8n (seção 1) — nenhuma segunda
 * convenção de quais campos/breakdowns buscar: `level=ad` (mais granular,
 * campanha/conjunto/anúncio deriváveis somando), `time_increment=1` (uma
 * linha por dia), `breakdowns=publisher_platform,platform_position` (pra
 * Posicionamentos), `actions`/`action_values` repassados BRUTOS (a MITZA
 * decide via `metric_mappings` o que conta como resultado — esta função
 * nunca filtra/interpreta `action_type`).
 */

const META_GRAPH_API_VERSION = "v25.0";

interface MetaInsightsActionEntry {
  action_type: string;
  value: string;
}

interface MetaInsightsRawRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  platform_position?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaInsightsActionEntry[];
  action_values?: MetaInsightsActionEntry[];
}

interface MetaInsightsResponse {
  data: MetaInsightsRawRow[];
  paging?: { next?: string };
  error?: { message: string };
}

function parseActionEntries(entries: MetaInsightsActionEntry[] | undefined): Record<string, number> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const result: Record<string, number> = {};
  for (const entry of entries) {
    const value = Number(entry.value);
    if (Number.isFinite(value)) result[entry.action_type] = value;
  }
  return result;
}

/**
 * Núcleo puro — converte UMA linha bruta da Graph API pra `MetaApiIngestRow`
 * (mesmo formato que `validateMetaApiIngestPayload` já valida e
 * `ingestMetaApiPayload` já grava). Testável sem rede: a função que chama a
 * Graph API (`fetchMetaApiInsightsForAccount`, abaixo) só busca os dados
 * brutos e delega a conversão real pra cá.
 *
 * `campaignId`/`campaignName` ausentes na linha (nunca deveriam faltar numa
 * resposta real da Meta no nível `ad`, mas a API externa nunca é 100%
 * confiável) viram `null` — o chamador descarta a linha antes de montar o
 * payload (`validateMetaApiIngestPayload` já rejeitaria do mesmo jeito,
 * mas filtrar aqui evita mandar lixo garantido pro validador).
 */
export function mapMetaInsightsRowToIngestRow(row: MetaInsightsRawRow): MetaApiIngestRow | null {
  if (!row.campaign_id || !row.campaign_name) return null;

  return {
    date: row.date_start,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adSetId: row.adset_id,
    adSetName: row.adset_name,
    adId: row.ad_id,
    adName: row.ad_name,
    platformPosition: row.platform_position,
    spend: Number(row.spend ?? 0),
    impressions: row.impressions !== undefined ? Number(row.impressions) : undefined,
    reach: row.reach !== undefined ? Number(row.reach) : undefined,
    clicks: row.clicks !== undefined ? Number(row.clicks) : undefined,
    actions: parseActionEntries(row.actions),
    actionValues: parseActionEntries(row.action_values),
  };
}

const INSIGHTS_FIELDS =
  "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,actions,action_values";

/**
 * Busca os insights de UMA conta de anúncios, já convertidos pro formato de
 * ingestão (`MetaApiIngestRow[]`) — equivalente direto ao que o n8n faria
 * pra montar `MetaApiIngestPayload.rows`. `accountId` no formato `act_...`
 * (mesma convenção de `import_sources.external_account_id`).
 */
export async function fetchMetaApiInsightsForAccount(accountId: string, since: string, until: string): Promise<MetaApiIngestRow[]> {
  const accessToken = process.env.META_API_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_API_ACCESS_TOKEN não configurado");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("breakdowns", "publisher_platform,platform_position");
  url.searchParams.set("fields", INSIGHTS_FIELDS);
  url.searchParams.set("access_token", accessToken);

  const rawRows: MetaInsightsRawRow[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const response: Response = await fetch(nextUrl);
    const json: MetaInsightsResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Meta Insights API error (${accountId}): ${json?.error?.message ?? response.statusText}`);
    }

    rawRows.push(...(json.data ?? []));
    nextUrl = json.paging?.next;
  }

  const rows: MetaApiIngestRow[] = [];
  for (const rawRow of rawRows) {
    const mapped = mapMetaInsightsRowToIngestRow(rawRow);
    if (mapped) rows.push(mapped);
  }
  return rows;
}
