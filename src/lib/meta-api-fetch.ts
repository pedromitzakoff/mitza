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
  /** KOFF Analytics Fase 2, Etapa 2.4 — cliques especificamente no link/CTA
   * de destino (DISTINTO de `clicks`, que inclui curtidas/compartilhamentos/
   * visitas ao perfil em alguns contextos de relatório da própria Meta). */
  inline_link_clicks?: string;
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
    linkClicks: row.inline_link_clicks !== undefined ? Number(row.inline_link_clicks) : undefined,
    actions: parseActionEntries(row.actions),
    actionValues: parseActionEntries(row.action_values),
  };
}

const INSIGHTS_FIELDS =
  "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";

/**
 * Achado real de produção (11/2026 — "Diagnóstico de sincronização"): sem
 * `limit` explícito, a Graph API usa o próprio tamanho de página padrão
 * (pequeno) pra esta consulta — nível de anúncio + 2 dimensões de
 * breakdown gera MUITAS linhas pra uma conta grande/ativa, e cada página a
 * mais é uma viagem de rede sequencial inteira (a paginação por cursor não
 * dá pra paralelizar). Pedir um lote bem maior por página reduz
 * drasticamente o número de viagens pro MESMO total de linhas — nenhuma
 * mudança no que é buscado/gravado (mesmos `fields`/`breakdowns` de
 * sempre), só menos idas e vindas pra montar a mesma resposta. 500 é um
 * valor seguro e comum pra este endpoint da Graph API (bem abaixo de
 * limites de tamanho de resposta que forçariam a própria Meta a reduzir
 * sozinha).
 */
const INSIGHTS_PAGE_LIMIT = 500;

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
  url.searchParams.set("limit", String(INSIGHTS_PAGE_LIMIT));
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

export interface MetaApiPeriodReachRow {
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  impressions: number;
  reach: number;
}

const PERIOD_REACH_FIELDS = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach";

interface MetaPeriodReachRawRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  impressions?: string;
  reach?: string;
}

interface MetaPeriodReachResponse {
  data: MetaPeriodReachRawRow[];
  paging?: { next?: string };
  error?: { message: string };
}

/**
 * MITZA ONE — KOFF Analytics Fase 2 (Dashboard Meta Ads), pedido explícito
 * do usuário: "frequência e alcance devem respeitar a deduplicação do
 * período; não calcule frequência de períodos longos somando alcance
 * diário". `fetchMetaApiInsightsForAccount` (acima) usa `time_increment=1`
 * — correto pra ingestão diária, mas o `reach` de cada linha é deduplicado
 * só DENTRO daquele dia; somar essas linhas entre dias conta a mesma pessoa
 * de novo em cada dia que ela viu o anúncio.
 *
 * Esta função busca o alcance/impressões do PERÍODO INTEIRO de uma vez só
 * (sem `time_increment` — a Graph API devolve UMA linha por entidade já
 * deduplicada pro intervalo pedido) — é a ÚNICA fonte correta de alcance de
 * período na MITZA; nunca somar `campaign_daily_metrics.reach`/
 * `ad_set_daily_metrics.reach`/`ad_creative_daily_metrics.reach` entre datas
 * pra este fim. `level` decide a granularidade (conta/campanha/conjunto/
 * anúncio) — mesma convenção de `fetchMetaApiInsightsForAccount`.
 *
 * KOFF Analytics Fase 2, Etapa 2.2: conectada ao Dashboard Meta Ads
 * (`lib/meta-ads-dashboard/dashboard-data.ts`, `fetchAccountPeriodReachSnapshot`)
 * — essa camada trata indisponibilidade/timeout/token ausente como estado
 * explícito, nunca deixa o erro subir pra quebrar a tela. `signal` com
 * timeout (pedido do usuário: "prever... limites da Graph API, falhas,
 * carregamento") evita que uma chamada presa trave o render da página
 * inteira; `next.revalidate` (mesma janela de 5 minutos já usada pelo sync
 * direto, `meta-api-direct-sync.ts`) evita refazer a MESMA consulta de
 * período a cada reload (pedido do usuário: "evitar consultas
 * desnecessárias à API").
 */
const PERIOD_REACH_FETCH_TIMEOUT_MS = 8000;
const PERIOD_REACH_CACHE_SECONDS = 300;

export async function fetchMetaApiPeriodReach(
  accountId: string,
  level: "account" | "campaign" | "adset" | "ad",
  since: string,
  until: string,
): Promise<MetaApiPeriodReachRow[]> {
  const accessToken = process.env.META_API_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_API_ACCESS_TOKEN não configurado");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}/insights`);
  url.searchParams.set("level", level);
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("fields", PERIOD_REACH_FIELDS);
  url.searchParams.set("access_token", accessToken);

  const rows: MetaApiPeriodReachRow[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const response: Response = await fetch(nextUrl, {
      signal: AbortSignal.timeout(PERIOD_REACH_FETCH_TIMEOUT_MS),
      next: { revalidate: PERIOD_REACH_CACHE_SECONDS },
    });
    const json: MetaPeriodReachResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Meta Insights API error (${accountId}, period reach): ${json?.error?.message ?? response.statusText}`);
    }

    for (const row of json.data ?? []) {
      rows.push({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        adsetId: row.adset_id,
        adsetName: row.adset_name,
        adId: row.ad_id,
        adName: row.ad_name,
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
      });
    }
    nextUrl = json.paging?.next;
  }

  return rows;
}

export interface MetaApiAccountBalanceRow {
  isPrepay: boolean;
  /** "Fundos disponíveis" da conta, em unidade PRINCIPAL da moeda (ex.:
   * reais) — achado real (cliente Helping Hand, 22/10/2026): o campo
   * `balance` do nó da conta NUNCA foi o saldo real disponível pra gastar —
   * a documentação oficial da Graph API o descreve como "Bill amount due"
   * (valor a faturar), e na prática ele só reflete cupons/créditos
   * promocionais residuais da conta (centavos), nunca o valor principal
   * carregado na forma de pagamento. O valor real só existe dentro de
   * `funding_source_details.display_string` — um texto formatado pela
   * própria Meta (ex.: "Saldo disponível (R$37.663,10 BRL)"), sem campo
   * numérico estruturado equivalente nesta resposta. `null` quando a conta
   * NÃO é pré-paga (pedido explícito do usuário: "puxe o saldo somente
   * para as contas de pré-pago; as que não forem, coloca tipo PÓS-PAGO no
   * lugar do saldo" — pra conta pós-paga, `balance` representa o valor A
   * FATURAR, nunca um saldo disponível) OU quando `display_string` não
   * pôde ser interpretado (`parseFundingSourceDisplayAmount` devolveu
   * `null`) — nunca um valor fabricado a partir de uma resposta
   * incompleta/inesperada. */
  balance: number | null;
  currency: string;
}

interface MetaAccountBalanceRawResponse {
  is_prepay_account?: boolean;
  currency?: string;
  funding_source_details?: { display_string?: string };
  error?: { message: string };
}

const ACCOUNT_BALANCE_FIELDS = "is_prepay_account,currency,funding_source_details";

/**
 * Extrai o valor numérico de `funding_source_details.display_string` — não
 * existe campo numérico estruturado equivalente na resposta da Graph API
 * pra "fundos disponíveis" (ver comentário de `MetaApiAccountBalanceRow`).
 * Decide qual separador é o decimal pelo ÚLTIMO `,`/`.` seguido de
 * exatamente 2 dígitos até o fim do número — cobre tanto o formato pt-BR
 * ("37.663,10") quanto en-US ("37,663.10") sem depender do idioma da conta,
 * já que o texto vem formatado pela própria Meta conforme o locale do
 * app/token usado (`META_API_ACCESS_TOKEN`, sempre o mesmo pra toda a
 * MITZA — nunca varia por sessão de usuário).
 *
 * `expectedCurrency` é uma checagem de sanidade (o texto precisa CONTER o
 * código da moeda já lido separadamente em `currency`) — nunca decide o
 * valor em si, só rejeita um `display_string` claramente inconsistente.
 * `null` em qualquer falha de parse — nunca um valor fabricado; melhor não
 * mostrar saldo nenhum do que mostrar um número errado.
 */
export function parseFundingSourceDisplayAmount(displayString: string | undefined, expectedCurrency: string): number | null {
  if (!displayString) return null;

  const inner = displayString.match(/\(([^)]*)\)/)?.[1] ?? displayString;
  if (!inner.includes(expectedCurrency)) return null;

  const numberToken = inner.match(/\d[\d.,]*\d|\d/)?.[0];
  if (!numberToken) return null;

  const lastSeparatorIndex = Math.max(numberToken.lastIndexOf(","), numberToken.lastIndexOf("."));
  if (lastSeparatorIndex === -1 || numberToken.length - lastSeparatorIndex - 1 !== 2) return null;

  const integerPart = numberToken.slice(0, lastSeparatorIndex).replace(/[.,]/g, "");
  const decimalPart = numberToken.slice(lastSeparatorIndex + 1);
  const value = Number(`${integerPart || "0"}.${decimalPart}`);

  return Number.isFinite(value) ? value : null;
}

/**
 * Núcleo puro — converte a resposta bruta do nó da conta (Graph API) pro
 * formato interno. `null` quando a resposta não tem os campos mínimos
 * (`is_prepay_account`/`currency` ausentes — nunca um valor fabricado a
 * partir de uma resposta incompleta).
 */
export function mapMetaAccountBalanceResponse(raw: MetaAccountBalanceRawResponse): MetaApiAccountBalanceRow | null {
  if (raw.is_prepay_account === undefined || !raw.currency) return null;
  const isPrepay = raw.is_prepay_account;
  return {
    isPrepay,
    balance: isPrepay ? parseFundingSourceDisplayAmount(raw.funding_source_details?.display_string, raw.currency) : null,
    currency: raw.currency,
  };
}

/**
 * MITZA ONE — KOFF Analytics (Cockpit Único do Cliente), pedido explícito
 * do usuário: "puxe o saldo da conta... quero que tenha um indicador no
 * topo da tela mostrando saldo da conta". Busca `balance`/
 * `is_prepay_account`/`currency` do nó da própria conta (`/act_...`, sem
 * `/insights`) — 1 chamada leve, cacheada 5 minutos (mesma janela/mesmo
 * timeout de `fetchMetaApiPeriodReach`, nenhuma consulta desnecessária).
 * `null` quando a resposta não tem os campos mínimos; qualquer falha de
 * rede/API segue lançando (quem chama, `fetchAccountBalanceSnapshot` em
 * `lib/meta-ads-dashboard/dashboard-data.ts`, trata isso como estado
 * explícito, nunca deixa quebrar a tela — mesmo padrão de
 * `fetchAccountPeriodReachSnapshot`).
 */
const ACCOUNT_BALANCE_FETCH_TIMEOUT_MS = 8000;
const ACCOUNT_BALANCE_CACHE_SECONDS = 300;

export async function fetchMetaApiAccountBalance(accountId: string): Promise<MetaApiAccountBalanceRow | null> {
  const accessToken = process.env.META_API_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_API_ACCESS_TOKEN não configurado");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}`);
  url.searchParams.set("fields", ACCOUNT_BALANCE_FIELDS);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(ACCOUNT_BALANCE_FETCH_TIMEOUT_MS),
    next: { revalidate: ACCOUNT_BALANCE_CACHE_SECONDS },
  });
  const json: MetaAccountBalanceRawResponse = await response.json();

  if (!response.ok) {
    throw new Error(`Meta Graph API error (${accountId}, saldo da conta): ${json?.error?.message ?? response.statusText}`);
  }

  return mapMetaAccountBalanceResponse(json);
}

/**
 * Preview de criativo (Etapa "Preview de criativos nos cards de Anúncios")
 * — pedido explícito do usuário: mostrar a imagem/thumbnail de vídeo real
 * de cada anúncio, sem baixar/guardar o arquivo (só o link que a Meta já
 * devolve, reaproveitado direto como `src` de `<img>` — nunca armazenado
 * em Supabase Storage, decisão explícita por custo/peso).
 *
 * Busca TODOS os anúncios da conta de uma vez (nunca um por um) — nó
 * `/{account}/ads`, DISTINTO do nó `/insights` usado pra performance
 * (nenhuma relação com data/período, metadado de anúncio é "o que existe
 * agora", não histórico). `creative.thumbnail_url` funciona tanto pra
 * imagem quanto pra vídeo (frame de capa); `image_url` como fallback pros
 * poucos casos em que `thumbnail_url` não vem.
 *
 * `adName` é a mesma identidade canônica de sempre (`creativeName`, ver
 * `lib/creative-analytics.ts`) — quem chama agrupa por nome, nunca por
 * `ad_id` (vários `ad_id` podem compartilhar o mesmo criativo ao longo do
 * tempo).
 */
export interface MetaApiCreativePreviewRow {
  adName: string;
  thumbnailUrl: string | null;
}

interface MetaAdsCreativeRawRow {
  name?: string;
  creative?: { thumbnail_url?: string; image_url?: string };
}

interface MetaAdsCreativeResponse {
  data: MetaAdsCreativeRawRow[];
  paging?: { next?: string };
  error?: { message: string };
}

const CREATIVE_PREVIEW_FIELDS = "name,creative{thumbnail_url,image_url}";
// 500 (o valor usado em `fetchMetaApiInsightsForAccount`) é grande demais
// aqui — `creative{...}` é uma expansão de edge aninhada, bem mais "pesada"
// por linha do que métricas simples, e a Graph API rejeita a chamada
// inteira com "Please reduce the amount of data you're asking for" acima de
// um certo tamanho de página. Achado real em produção (log do Vercel,
// cliente/conta reais) — 50 é o valor seguro para este campo específico.
const CREATIVE_PREVIEW_PAGE_LIMIT = 50;

// Sem `effective_status`, o endpoint `/ads` da Graph API exclui
// silenciosamente anúncios arquivados (campanhas antigas já encerradas) —
// sem erro nenhum, só ausentes da resposta. Achado real em produção
// (conta com histórico: nem todos os criativos apareciam). Pedimos todo
// status "vivo" — só EXCLUDED é `DELETED` (apagado de verdade, nunca mais
// deveria ter preview buscado).
const CREATIVE_PREVIEW_EFFECTIVE_STATUS = JSON.stringify([
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
]);

export async function fetchMetaApiAdCreativePreviews(accountId: string): Promise<MetaApiCreativePreviewRow[]> {
  const accessToken = process.env.META_API_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_API_ACCESS_TOKEN não configurado");
  }

  const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}/ads`);
  url.searchParams.set("fields", CREATIVE_PREVIEW_FIELDS);
  url.searchParams.set("limit", String(CREATIVE_PREVIEW_PAGE_LIMIT));
  url.searchParams.set("effective_status", CREATIVE_PREVIEW_EFFECTIVE_STATUS);
  url.searchParams.set("access_token", accessToken);

  const rows: MetaApiCreativePreviewRow[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const response: Response = await fetch(nextUrl);
    const json: MetaAdsCreativeResponse = await response.json();

    if (!response.ok) {
      throw new Error(`Meta Graph API error (${accountId}, preview de criativo): ${json?.error?.message ?? response.statusText}`);
    }

    for (const row of json.data ?? []) {
      if (!row.name) continue; // sem nome -> nunca combina com nenhum creativeName já gravado, nunca gravável.
      // `image_url` (imagem original) primeiro — qualidade melhor que
      // `thumbnail_url` (miniatura pequena da Meta); thumbnail só como
      // último recurso (ex.: anúncio em vídeo sem imagem estática própria).
      rows.push({ adName: row.name, thumbnailUrl: row.creative?.image_url ?? row.creative?.thumbnail_url ?? null });
    }
    nextUrl = json.paging?.next;
  }

  return rows;
}
