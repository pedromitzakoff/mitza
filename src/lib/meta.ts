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

interface GraphApiError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface InsightsResponse {
  data: InsightsRow[];
  paging?: { next?: string };
  error?: GraphApiError;
}

/** Classificação do que deu errado — nunca inclui o token nem o corpo cru
 * da resposta, só o suficiente pra decidir "ignorar essa conta e seguir pras
 * outras" vs. "mostrar pro admin investigar". */
export type MetaSyncErrorKind =
  | "invalid_token"
  | "account_not_found"
  | "rate_limited"
  | "invalid_response"
  | "http_error"
  | "unknown";

export class MetaSyncError extends Error {
  readonly kind: MetaSyncErrorKind;

  constructor(kind: MetaSyncErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "MetaSyncError";
  }
}

/** Classifica o erro devolvido pela Graph API pelos códigos documentados —
 * nunca por texto livre (o `message` da Meta pode mudar; `code`/`error_subcode`
 * são estáveis). Referência: developers.facebook.com/docs/graph-api/guides/error-handling. */
function classifyGraphApiError(error: GraphApiError | undefined, httpStatus: number): MetaSyncError {
  const code = error?.code;

  if (code === 190) {
    return new MetaSyncError("invalid_token", "Token de acesso inválido ou expirado.");
  }
  if (code === 100 || code === 803 || httpStatus === 404) {
    return new MetaSyncError("account_not_found", "Conta de anúncios não encontrada ou sem permissão de acesso.");
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || httpStatus === 429) {
    return new MetaSyncError("rate_limited", "Limite de requisições da Meta atingido — tente novamente mais tarde.");
  }
  if (!error) {
    return new MetaSyncError("http_error", `Erro HTTP ${httpStatus} ao consultar a Meta.`);
  }
  return new MetaSyncError("unknown", "Erro desconhecido ao consultar a Meta.");
}

/**
 * Busca o spend diário (breakdown por dia, `time_increment=1`) de uma conta
 * de anúncios da Meta entre duas datas (inclusive). Busca exclusivamente
 * `date_start`/`spend` — nenhum outro campo (leads, CPL, alcance, etc.) faz
 * parte desta fase da integração.
 */
export async function fetchDailySpend(
  adAccountId: string,
  since: string,
  until: string,
): Promise<DailySpend[]> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new MetaSyncError("unknown", "META_ACCESS_TOKEN não configurado no servidor.");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set("fields", "spend");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("access_token", accessToken);

  const rows: InsightsRow[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    let response: Response;
    try {
      response = await fetch(nextUrl);
    } catch {
      throw new MetaSyncError("http_error", "Falha de rede ao contatar a Meta.");
    }

    let json: InsightsResponse;
    try {
      json = await response.json();
    } catch {
      throw new MetaSyncError("invalid_response", "Resposta inválida (não-JSON) da Meta.");
    }

    if (!response.ok || json.error) {
      throw classifyGraphApiError(json.error, response.status);
    }

    if (!Array.isArray(json.data)) {
      throw new MetaSyncError("invalid_response", "Resposta da Meta sem o campo `data` esperado.");
    }

    rows.push(...json.data);
    nextUrl = json.paging?.next;
  }

  return rows.map((row) => ({
    date: row.date_start,
    spend: Number(row.spend ?? 0),
  }));
}

/**
 * Normaliza o ID de conta de anúncios digitado pelo admin — aceita com ou
 * sem o prefixo "act_" e sempre grava no formato canônico esperado pela
 * Graph API. String vazia/só espaços vira `null` (cliente sem integração
 * Meta, ignorado pela sincronização — nunca um valor placeholder forçado
 * só pra satisfazer o formulário).
 */
export function normalizeMetaAdAccountId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return `act_${trimmed}`;
  return trimmed;
}
