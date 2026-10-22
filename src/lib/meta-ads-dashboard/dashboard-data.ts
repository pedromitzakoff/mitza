import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { CampaignDailyMetricRow, CampaignSummary } from "@/lib/campaign-analytics";
import type { AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import { previousEquivalentPeriod, computePercentChange, type PeriodRange } from "@/lib/period-comparison";
import { computeCpm, computeCtr, computeCpc, computeCostPerResult, computeRoas, computeFrequency } from "@/lib/performance";
import { fetchMetaApiPeriodReach, fetchMetaApiAccountBalance } from "@/lib/meta-api-fetch";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { buildEvolutionSeries, type ChartMetricSeries } from "./evolution-data";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.1 (Fundação do Dashboard Meta
 * Ads, `/clients/[id]/meta-ads`). Núcleo puro + camada de leitura próprios
 * deste dashboard — DISTINTOS de `lib/performance-report/report-data.ts`
 * (que serve o Relatório de Performance/PDF/link externo, preservado
 * intocado): o dashboard interativo tem forma diferente (comparação de
 * período, métricas configuráveis, granularidade por nível) e não deveria
 * acoplar sua evolução à do documento de Relatório. Reaproveita, sim, a
 * MESMA camada de leitura granular já existente (`getCampaignDailyMetricsForPeriod`,
 * `lib/campaign-analytics-data.ts`) e o MESMO núcleo central de performance
 * (`lib/performance.ts`) — nenhuma segunda consulta/agregação/fórmula.
 */

export interface MetaAdsAdditiveTotals {
  spend: number;
  impressions: number;
  clicks: number;
  /** Cliques especificamente no link/CTA de destino (DISTINTO de `clicks`)
   * — KOFF Analytics Fase 2, Etapa 2.4. `null` quando NENHUMA linha do
   * escopo tem esse campo (período inteiro antes da coluna existir, ou
   * fonte sem o campo configurado) — nunca `0` fabricado, mesma convenção
   * de `revenue` abaixo. */
  linkClicks: number | null;
  resultCount: number;
  /** `null` quando nenhuma linha do escopo tem receita registrada (nunca
   * `0` fabricado — mesma convenção de `PerformanceSummary.revenue`). */
  revenue: number | null;
}

export interface MetaAdsDerivedMetrics {
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  /** CTR do link — DISTINTO de `ctr` (cliques totais). `null` sem
   * `totalLinkClicks`/impressões disponíveis. */
  linkCtr: number | null;
  /** CPC do link — DISTINTO de `cpc`. `null` sem `totalLinkClicks`. */
  linkCpc: number | null;
  costPerResult: number | null;
  roas: number | null;
}

export interface MetaAdsPeriodSnapshot {
  period: PeriodRange;
  /** `false` = nenhuma linha de `campaign_daily_metrics` no escopo (período
   * sem sincronização, não "zero resultados registrados") — pedido
   * explícito do usuário ("diferencie ausência de dados de resultado igual
   * a zero"); quem apresenta o card de Resultados usa isto pra nunca
   * mostrar "0" quando na verdade não há dado nenhum pro período. */
  hasAnyRecord: boolean;
  totals: MetaAdsAdditiveTotals;
  derived: MetaAdsDerivedMetrics;
}

export interface MetaAdsPeriodComparison {
  current: MetaAdsPeriodSnapshot;
  /** `null` quando o período anterior equivalente não tem nenhuma linha
   * (cliente novo, sem histórico suficiente) — nunca comparado contra um
   * snapshot vazio fabricado. */
  previous: MetaAdsPeriodSnapshot | null;
  spendChangePct: number | null;
  resultCountChangePct: number | null;
}

/**
 * Alcance/frequência do PERÍODO — pedido explícito do usuário ("frequência
 * e alcance devem respeitar a deduplicação do período; não calcule
 * frequência de períodos longos somando alcance diário"). Nunca derivado
 * somando `campaign_daily_metrics.reach` entre dias (alcance não é
 * aditivo — a Meta deduplica usuários únicos dentro da janela consultada).
 * A fonte é `fetchMetaApiPeriodReach` (`lib/meta-api-fetch.ts`), uma consulta
 * própria à Graph API cobrindo o período inteiro de uma vez (ver
 * `fetchAccountPeriodReachSnapshot`, abaixo).
 *
 * `"unavailable"` — pedido explícito do usuário ("prever... indisponibilidade
 * da integração... se o dado não estiver disponível, mostrar um estado
 * adequado em vez de zero inventado") — NUNCA um `reach`/`frequency` de `0`
 * fabricado:
 * - `not_configured`: cliente sem fonte `meta_api` habilitada (ex.: só usa
 *   Stract pra Meta) — a consulta de período inteiro exige a credencial
 *   direta da Graph API, que esses clientes não têm aqui.
 * - `token_missing`: `META_API_ACCESS_TOKEN` não configurado no ambiente.
 * - `timeout`: a Graph API não respondeu dentro do limite
 *   (`PERIOD_REACH_FETCH_TIMEOUT_MS`, `lib/meta-api-fetch.ts`).
 * - `fetch_error`: qualquer outra falha (rede, limite de taxa, erro da API).
 */
export type MetaAdsReachSnapshot =
  | { status: "ok"; impressions: number; reach: number; frequency: number | null }
  | { status: "unavailable"; reason: "not_configured" | "token_missing" | "timeout" | "fetch_error" };

export interface MetaAdsReachComparison {
  current: MetaAdsReachSnapshot;
  previous: MetaAdsReachSnapshot;
  reachChangePct: number | null;
  frequencyChangePct: number | null;
}

/** Compara dois snapshots de alcance/frequência — `null` sempre que
 * qualquer um dos dois lados não está `"ok"` (nunca uma variação calculada
 * contra um valor indisponível). Pura/testável sem rede. */
export function buildReachComparison(current: MetaAdsReachSnapshot, previous: MetaAdsReachSnapshot): MetaAdsReachComparison {
  let reachChangePct: number | null = null;
  let frequencyChangePct: number | null = null;

  if (current.status === "ok" && previous.status === "ok") {
    reachChangePct = computePercentChange(current.reach, previous.reach);
    frequencyChangePct = current.frequency !== null ? computePercentChange(current.frequency, previous.frequency) : null;
  }

  return { current, previous, reachChangePct, frequencyChangePct };
}

export interface MetaAdsDashboardData {
  client: { id: string; name: string };
  /** `import_sources.external_account_id` (`act_...`) da integração direta
   * Meta — `null` quando o cliente não tem essa fonte habilitada (ex.: só
   * usa Stract). Exibido no cabeçalho do dashboard (pedido do usuário,
   * Etapa 2.4, item 4: "cabeçalho com cliente, conta..."). */
  metaAdAccountId: string | null;
  comparison: MetaAdsPeriodComparison;
  reachComparison: MetaAdsReachComparison;
  /** Etapa 2.3 — séries diárias das 9 métricas selecionáveis no gráfico de
   * evolução, pro período atual e pro anterior equivalente. Nunca inclui
   * alcance/frequência (ver doc-comment de `buildEvolutionSeries`,
   * `lib/meta-ads-dashboard/evolution-data.ts`). */
  evolution: ChartMetricSeries[];
  /** KOFF Analytics Fase 2, Etapa 2.4 — exploração Campanhas → Conjuntos →
   * Anúncios, tudo na mesma tela. `explorationCampaigns` já vem resumido
   * (`buildCampaignSummaries`, uma linha por campanha); `explorationAdSetRows`/
   * `explorationCreativeRows` vêm BRUTOS (uma linha por dia) porque a
   * seção de exploração precisa refiltrar por campanha selecionada e
   * reagregar (`buildAdSetSummaries`/`buildCreativeSummaries`) só sobre o
   * subconjunto — mesmo padrão já usado por `ReportFilterableTables`
   * (`performance-report/report-filterable-tables.tsx`), nunca uma segunda
   * lógica de filtro. Achado da auditoria desta etapa, documentado em
   * `docs/META_ADS_DASHBOARD_METRICS_GAP_ANALYSIS.md`: `ad_creative_daily_metrics`
   * não tem `ad_set_id`/`ad_set_name` — Anúncios é filtrável por CAMPANHA,
   * nunca por Conjunto especificamente (a UI trata isso como dois recortes
   * irmãos da mesma campanha, nunca um 3º nível fabricado). */
  explorationCampaigns: CampaignSummary[];
  explorationAdSetRows: AdSetDailyMetricRow[];
  explorationCreativeRows: AdCreativeDailyMetricRow[];
  /** Resultados somados de `campaign_daily_metrics.result_count` são SEMPRE
   * atribuídos pela Meta (vêm de `actions`/`metric_mappings`, dentro da
   * janela de atribuição do próprio Ads Manager) — nunca confirmados por
   * uma fonte de negócio independente (CRM/vendas reais). Pedido explícito
   * do usuário ("diferencie métricas atribuídas pela Meta de resultados
   * gerais do negócio") — a interface que consumir este dado precisa
   * rotular isso explicitamente, nunca apresentar como "resultado do
   * negócio" sem essa qualificação. A MITZA hoje não tem, para o canal
   * Meta, uma segunda fonte de resultado independente da própria Meta —
   * por isso este campo é sempre `"meta_attributed"` (nunca `"business"`).
   */
  resultSource: "meta_attributed";
  resultType: PerformanceGoal | null;
  /** `import_sources.last_success_at` mais recente entre as fontes Meta
   * habilitadas — mesma fonte/resolução de `dados-data.ts`
   * (`resolveLatestSuccessAt`), nunca um segundo cálculo de frescor. `null`
   * = nenhuma sincronização bem-sucedida registrada ainda (a interface
   * NUNCA deve apresentar isso como "atualizado agora"). */
  lastSyncAt: string | null;
  generatedAt: string;
}

/** Soma pura das métricas ADITIVAS (investimento, impressões, cliques,
 * resultado, receita) — nunca inclui alcance/frequência (ver
 * `MetaAdsReachSnapshot`, que usa uma fonte própria, nunca soma de linhas
 * diárias). Linhas sem `channel === "meta"` já devem ter sido filtradas por
 * quem chama (mesma disciplina de `report-data.ts`). */
export function sumAdditiveTotals(rows: CampaignDailyMetricRow[]): MetaAdsAdditiveTotals {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let linkClicks: number | null = null;
  let resultCount = 0;
  let revenue: number | null = null;

  for (const row of rows) {
    spend += row.spend;
    impressions += row.impressions ?? 0;
    clicks += row.clicks ?? 0;
    if (row.linkClicks !== null) linkClicks = (linkClicks ?? 0) + row.linkClicks;
    resultCount += row.resultCount ?? 0;
    if (row.revenue !== null) revenue = (revenue ?? 0) + row.revenue;
  }

  return { spend, impressions, clicks, linkClicks, resultCount, revenue };
}

/** Monta um snapshot completo (totais + métricas derivadas) de UM período
 * a partir das linhas brutas já filtradas por canal/cliente/período —
 * `hasAnyRecord` (pra `computeCostPerResult`) é "existe pelo menos uma
 * linha no escopo", nunca confundido com "resultCount > 0" (0 resultados
 * registrados explicitamente é diferente de nenhum dado). */
export function buildPeriodSnapshot(period: PeriodRange, rows: CampaignDailyMetricRow[]): MetaAdsPeriodSnapshot {
  const totals = sumAdditiveTotals(rows);
  const hasAnyRecord = rows.length > 0;

  const derived: MetaAdsDerivedMetrics = {
    cpm: computeCpm(totals.spend, totals.impressions),
    ctr: computeCtr(totals.clicks, totals.impressions),
    cpc: computeCpc(totals.spend, totals.clicks),
    linkCtr: totals.linkClicks !== null ? computeCtr(totals.linkClicks, totals.impressions) : null,
    linkCpc: totals.linkClicks !== null ? computeCpc(totals.spend, totals.linkClicks) : null,
    costPerResult: computeCostPerResult(totals.spend, totals.resultCount, hasAnyRecord),
    roas: computeRoas(totals.revenue, totals.spend),
  };

  return { period, hasAnyRecord, totals, derived };
}

/** Compara o período atual ao período anterior de MESMA duração
 * (`previousEquivalentPeriod`, `lib/period-comparison.ts` — nenhum segundo
 * cálculo de período anterior). `previousRows` vazio (cliente sem histórico
 * suficiente) produz `previous: null`, nunca um snapshot fabricado a partir
 * de zero linhas. `resultCountChangePct` só é calculado quando o período
 * anterior TEM registro (nunca comparado contra um período anterior vazio,
 * mesma régua de "ausência de dados ≠ zero"). */
export function buildPeriodComparison(
  period: PeriodRange,
  currentRows: CampaignDailyMetricRow[],
  previousRows: CampaignDailyMetricRow[],
): MetaAdsPeriodComparison {
  const current = buildPeriodSnapshot(period, currentRows);
  const previous = previousRows.length > 0 ? buildPeriodSnapshot(previousEquivalentPeriod(period), previousRows) : null;

  return {
    current,
    previous,
    spendChangePct: previous ? computePercentChange(current.totals.spend, previous.totals.spend) : null,
    resultCountChangePct: previous?.hasAnyRecord ? computePercentChange(current.totals.resultCount, previous.totals.resultCount) : null,
  };
}

/** `import_sources.external_account_id` da fonte de integração DIRETA Meta
 * (`provider = "meta_api"`) do cliente — MESMO filtro de
 * `syncAllMetaApiAccounts` (`lib/meta-api-direct-sync.ts`), nunca uma
 * segunda resolução. `null` quando o cliente não tem essa fonte habilitada
 * (ex.: só usa Stract pra Meta) — nesse caso a consulta de alcance por
 * período inteiro não é possível aqui (ela exige a credencial direta da
 * Graph API), nunca um erro: vira `MetaAdsReachSnapshot` com
 * `reason: "not_configured"`.
 */
export async function resolveMetaAdAccountId(supabase: Supabase, clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("import_sources")
    .select("external_account_id")
    .eq("client_id", clientId)
    .eq("provider", "meta_api")
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    console.error(`[meta-ads-dashboard] falha ao resolver conta Meta do cliente ${clientId}:`, error);
    return null;
  }
  return data?.external_account_id ?? null;
}

/**
 * Busca alcance/impressões do período inteiro (nível conta) e calcula a
 * frequência a partir deles — NUNCA lança: qualquer falha (sem conta
 * configurada, sem token, timeout, erro da Graph API) vira
 * `{ status: "unavailable", reason }`, nunca uma exceção que derrubaria a
 * página (pedido do usuário: "prever... falhas... indisponibilidade da
 * integração"). Soma defensivamente as linhas devolvidas (nível `"account"`
 * normalmente devolve uma única linha, mas nunca assume isso como garantia
 * contratual da API).
 */
export async function fetchAccountPeriodReachSnapshot(accountId: string | null, period: PeriodRange): Promise<MetaAdsReachSnapshot> {
  if (!accountId) return { status: "unavailable", reason: "not_configured" };

  try {
    const rows = await fetchMetaApiPeriodReach(accountId, "account", period.start, period.end);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const reach = rows.reduce((sum, row) => sum + row.reach, 0);
    return { status: "ok", impressions, reach, frequency: computeFrequency(impressions, reach) };
  } catch (err) {
    console.error(`[meta-ads-dashboard] falha ao buscar alcance de período (conta ${accountId}, ${period.start}..${period.end}):`, err);
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : "";
    if (name === "TimeoutError" || name === "AbortError") return { status: "unavailable", reason: "timeout" };
    if (message.includes("META_API_ACCESS_TOKEN")) return { status: "unavailable", reason: "token_missing" };
    return { status: "unavailable", reason: "fetch_error" };
  }
}

/**
 * Saldo da conta Meta — pedido explícito do usuário: "puxe o saldo da
 * conta... indicador no topo da tela... só para as contas de pré-pago; as
 * que não forem, coloca tipo PÓS-PAGO no lugar do saldo". `isPrepay: false`
 * nunca carrega `balance`/`currency` — pra conta pós-paga (faturamento por
 * limiar), o campo `balance` da Graph API representa valor A FATURAR, não
 * saldo disponível; mostrar isso como "saldo" seria enganoso (ver doc de
 * `mapMetaAccountBalanceResponse`, `lib/meta-api-fetch.ts`).
 */
export type MetaAdAccountBalanceSnapshot =
  | { status: "ok"; isPrepay: true; balance: number; currency: string }
  | { status: "ok"; isPrepay: false }
  | { status: "unavailable"; reason: "not_configured" | "token_missing" | "timeout" | "fetch_error" };

/** Mesmo padrão de `fetchAccountPeriodReachSnapshot` — NUNCA lança, toda
 * falha vira `{ status: "unavailable", reason }`. */
export async function fetchAccountBalanceSnapshot(accountId: string | null): Promise<MetaAdAccountBalanceSnapshot> {
  if (!accountId) return { status: "unavailable", reason: "not_configured" };

  try {
    const row = await fetchMetaApiAccountBalance(accountId);
    if (!row) return { status: "unavailable", reason: "fetch_error" };
    if (!row.isPrepay) return { status: "ok", isPrepay: false };
    // `row.balance` pode vir `null` mesmo pra conta pré-paga quando
    // `funding_source_details.display_string` não pôde ser interpretado
    // (`parseFundingSourceDisplayAmount`, `lib/meta-api-fetch.ts`) — nunca
    // mostra `R$ null`/um valor fabricado, trata como indisponível igual a
    // qualquer outra falha.
    if (row.balance === null) return { status: "unavailable", reason: "fetch_error" };
    return { status: "ok", isPrepay: true, balance: row.balance, currency: row.currency };
  } catch (err) {
    console.error(`[meta-ads-dashboard] falha ao buscar saldo da conta ${accountId}:`, err);
    const name = err instanceof Error ? err.name : "";
    const message = err instanceof Error ? err.message : "";
    if (name === "TimeoutError" || name === "AbortError") return { status: "unavailable", reason: "timeout" };
    if (message.includes("META_API_ACCESS_TOKEN")) return { status: "unavailable", reason: "token_missing" };
    return { status: "unavailable", reason: "fetch_error" };
  }
}

/**
 * Monta os dados de performance Meta Ads a partir de informação JÁ buscada
 * por quem chama — hoje o Cockpit Único do Cliente (`app/clients/[id]/page.tsx`),
 * reaproveitando a MESMA leitura de `campaign_daily_metrics`/
 * `ad_set_daily_metrics`/`ad_creative_daily_metrics` que `buildPerformanceReportData`
 * já faz pro Relatório (nenhuma segunda consulta ao banco). Pura — nunca
 * chama Supabase/Graph API diretamente; quem chama resolve `metaAdAccountId`
 * (`resolveMetaAdAccountId`) e `reach` (`fetchAccountPeriodReachSnapshot`)
 * antes de montar os parâmetros.
 *
 * Consolidação (Etapa "Cockpit único por cliente"): o antigo
 * `buildMetaAdsDashboardData` — que tinha sua PRÓPRIA rota
 * (`/clients/[id]/meta-ads`) e buscava tudo de novo — foi removido quando
 * essa rota separada foi descontinuada a pedido do usuário ("só quero essa
 * página no sistema para cada cliente"); todo o conteúdo passou a viver
 * dentro do Cockpit. Diferença real: o Cockpit usa um único mês como
 * período, SEM comparação com o período anterior (mesma convenção das
 * demais seções do Cockpit — Meta & Ritmo/Evolução Diária tampouco
 * comparam mês a mês) — por isso `comparison.previous` e
 * `reachComparison.previous` são sempre vazios/indisponíveis aqui, nunca
 * fabricados. `buildPeriodComparison`/`buildReachComparison` continuam os
 * MESMOS núcleos puros de sempre (só recebem "nada" como período anterior).
 */
export function buildCockpitAdPerformanceData(params: {
  client: { id: string; name: string };
  metaAdAccountId: string | null;
  period: PeriodRange;
  campaignDailyRows: CampaignDailyMetricRow[];
  explorationCampaigns: CampaignSummary[];
  explorationAdSetRows: AdSetDailyMetricRow[];
  explorationCreativeRows: AdCreativeDailyMetricRow[];
  resultType: PerformanceGoal | null;
  reach: MetaAdsReachSnapshot;
  lastSyncAt: string | null;
}): MetaAdsDashboardData {
  const {
    client,
    metaAdAccountId,
    period,
    campaignDailyRows,
    explorationCampaigns,
    explorationAdSetRows,
    explorationCreativeRows,
    resultType,
    reach,
    lastSyncAt,
  } = params;

  const comparison = buildPeriodComparison(period, campaignDailyRows, []);
  const reachComparison = buildReachComparison(reach, { status: "unavailable", reason: "not_configured" });
  const evolution = buildEvolutionSeries(period, period, campaignDailyRows, [], resultType);

  return {
    client,
    metaAdAccountId,
    comparison,
    reachComparison,
    evolution,
    explorationCampaigns,
    explorationAdSetRows,
    explorationCreativeRows,
    resultSource: "meta_attributed",
    resultType,
    lastSyncAt,
    generatedAt: new Date().toISOString(),
  };
}
