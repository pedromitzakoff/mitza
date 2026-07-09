// Meta Graph API (Marketing API) — Insights endpoint.
// Versão estável mais recente em jul/2026. Ajuste esta constante quando a
// Meta depreciar a versão em uso.
const META_GRAPH_API_VERSION = "v25.0";

export interface DailySpend {
  date: string; // YYYY-MM-DD
  spend: number;
}

interface InsightsRow {
  date_start: string;
  spend?: string;
}

interface InsightsResponse {
  data: InsightsRow[];
  paging?: { next?: string };
  error?: { message: string };
}

/**
 * Busca o spend diário (breakdown por dia, `time_increment=1`) de uma conta
 * de anúncios da Meta entre duas datas (inclusive).
 */
export async function fetchDailySpend(
  adAccountId: string,
  since: string,
  until: string,
): Promise<DailySpend[]> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN não configurado");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set("fields", "spend");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("access_token", accessToken);

  const rows: InsightsRow[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const response: Response = await fetch(nextUrl);
    const json: InsightsResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Meta Insights API error: ${json?.error?.message ?? response.statusText}`);
    }

    rows.push(...(json.data ?? []));
    nextUrl = json.paging?.next;
  }

  return rows.map((row) => ({
    date: row.date_start,
    spend: Number(row.spend ?? 0),
  }));
}
