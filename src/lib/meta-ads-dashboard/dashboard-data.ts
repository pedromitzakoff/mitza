import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import type { CampaignDailyMetricRow } from "@/lib/campaign-analytics";
import { previousEquivalentPeriod, computePercentChange, type PeriodRange } from "@/lib/period-comparison";
import { computeCpm, computeCtr, computeCpc, computeCostPerResult, computeRoas, computeFrequency } from "@/lib/performance";
import { fetchMetaApiPeriodReach } from "@/lib/meta-api-fetch";
import { resolveLatestSuccessAt } from "@/lib/data-trust";
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
  resultCount: number;
  /** `null` quando nenhuma linha do escopo tem receita registrada (nunca
   * `0` fabricado — mesma convenção de `PerformanceSummary.revenue`). */
  revenue: number | null;
}

export interface MetaAdsDerivedMetrics {
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
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
  comparison: MetaAdsPeriodComparison;
  reachComparison: MetaAdsReachComparison;
  /** Etapa 2.3 — séries diárias das 9 métricas selecionáveis no gráfico de
   * evolução, pro período atual e pro anterior equivalente. Nunca inclui
   * alcance/frequência (ver doc-comment de `buildEvolutionSeries`,
   * `lib/meta-ads-dashboard/evolution-data.ts`). */
  evolution: ChartMetricSeries[];
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
  let resultCount = 0;
  let revenue: number | null = null;

  for (const row of rows) {
    spend += row.spend;
    impressions += row.impressions ?? 0;
    clicks += row.clicks ?? 0;
    resultCount += row.resultCount ?? 0;
    if (row.revenue !== null) revenue = (revenue ?? 0) + row.revenue;
  }

  return { spend, impressions, clicks, resultCount, revenue };
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
async function resolveMetaAdAccountId(supabase: Supabase, clientId: string): Promise<string | null> {
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
async function fetchAccountPeriodReachSnapshot(supabase: Supabase, clientId: string, period: PeriodRange): Promise<MetaAdsReachSnapshot> {
  const accountId = await resolveMetaAdAccountId(supabase, clientId);
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
 * Monta os dados do Dashboard Meta Ads pra UM cliente + período. `null`
 * quando o cliente não existe/foi excluído (mesmo critério 404 silencioso
 * das demais rotas de `clients/[id]/**`). KOFF Analytics Fase 2, Etapa 2.2:
 * alcance/frequência de período passam a ser buscados de verdade (Etapa 2.1
 * só preparava a função, sem conectar a nenhuma tela).
 */
export async function buildMetaAdsDashboardData(
  supabase: Supabase,
  clientId: string,
  period: PeriodRange,
): Promise<MetaAdsDashboardData | null> {
  const previousPeriod = previousEquivalentPeriod(period);

  const [clientRows, importSourceRows, currentRowsAll, previousRowsAll, currentReach, previousReach] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("id, name, performance_goal").eq("id", clientId).is("deleted_at", null),
      "clients:meta-ads-dashboard",
    ),
    requireQuery(
      supabase.from("import_sources").select("enabled, last_success_at").eq("client_id", clientId).eq("channel", "meta"),
      "import_sources:meta-ads-dashboard",
    ),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
    getCampaignDailyMetricsForPeriod(supabase, clientId, previousPeriod),
    fetchAccountPeriodReachSnapshot(supabase, clientId, period),
    fetchAccountPeriodReachSnapshot(supabase, clientId, previousPeriod),
  ]);

  const client = clientRows[0];
  if (!client) return null;

  // `campaign_daily_metrics` é channel-aware (pode ter linhas de outro
  // canal se o cliente também usa Google) — mesmo filtro explícito de
  // `report-data.ts`, nunca assumido implicitamente.
  const currentRows = currentRowsAll.filter((row) => row.channel === "meta");
  const previousRows = previousRowsAll.filter((row) => row.channel === "meta");

  const comparison = buildPeriodComparison(period, currentRows, previousRows);
  const reachComparison = buildReachComparison(currentReach, previousReach);
  const evolution = buildEvolutionSeries(period, previousPeriod, currentRows, previousRows, client.performance_goal);
  const lastSyncAt = resolveLatestSuccessAt(
    importSourceRows.map((row) => ({ enabled: row.enabled, lastSuccessAt: row.last_success_at })),
  );

  return {
    client: { id: client.id, name: client.name },
    comparison,
    reachComparison,
    evolution,
    resultSource: "meta_attributed",
    resultType: client.performance_goal,
    lastSyncAt,
    generatedAt: new Date().toISOString(),
  };
}
