import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import type { CampaignDailyMetricRow } from "@/lib/campaign-analytics";
import { previousEquivalentPeriod, computePercentChange, type PeriodRange } from "@/lib/period-comparison";
import { computeCpm, computeCtr, computeCpc, computeCostPerResult, computeRoas } from "@/lib/performance";
import { resolveLatestSuccessAt } from "@/lib/data-trust";
import type { PerformanceGoal } from "@/lib/performance-goals";

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
 * A fonte correta é `fetchMetaApiPeriodReach` (`lib/meta-api-fetch.ts`), uma
 * consulta própria à Graph API cobrindo o período inteiro de uma vez — já
 * implementada, mas ainda não conectada a esta camada (ver
 * `buildMetaAdsDashboardData`, que por isso devolve `reach: null` nesta
 * etapa). Entra em uso a partir da etapa que exibir alcance/frequência nos
 * KPIs/gráficos.
 */
export interface MetaAdsPeriodReach {
  reach: number;
  frequency: number;
  fetchedAt: string;
}

export interface MetaAdsDashboardData {
  client: { id: string; name: string };
  comparison: MetaAdsPeriodComparison;
  reach: MetaAdsPeriodReach | null;
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
 * `MetaAdsPeriodReach`). Linhas sem `channel === "meta"` já devem ter sido
 * filtradas por quem chama (mesma disciplina de `report-data.ts`). */
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

  return { period, totals, derived };
}

/** Compara o período atual ao período anterior de MESMA duração
 * (`previousEquivalentPeriod`, `lib/period-comparison.ts` — nenhum segundo
 * cálculo de período anterior). `previousRows` vazio (cliente sem histórico
 * suficiente) produz `previous: null`, nunca um snapshot fabricado a partir
 * de zero linhas. */
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
    resultCountChangePct: previous ? computePercentChange(current.totals.resultCount, previous.totals.resultCount) : null,
  };
}

/**
 * Monta os dados do Dashboard Meta Ads pra UM cliente + período — Camada 1
 * (Fundação, Etapa 2.1). `null` quando o cliente não existe/foi excluído
 * (mesmo critério 404 silencioso das demais rotas de `clients/[id]/**`).
 */
export async function buildMetaAdsDashboardData(
  supabase: Supabase,
  clientId: string,
  period: PeriodRange,
): Promise<MetaAdsDashboardData | null> {
  const previousPeriod = previousEquivalentPeriod(period);

  const [clientRows, importSourceRows, currentRowsAll, previousRowsAll] = await Promise.all([
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
  ]);

  const client = clientRows[0];
  if (!client) return null;

  // `campaign_daily_metrics` é channel-aware (pode ter linhas de outro
  // canal se o cliente também usa Google) — mesmo filtro explícito de
  // `report-data.ts`, nunca assumido implicitamente.
  const currentRows = currentRowsAll.filter((row) => row.channel === "meta");
  const previousRows = previousRowsAll.filter((row) => row.channel === "meta");

  const comparison = buildPeriodComparison(period, currentRows, previousRows);
  const lastSyncAt = resolveLatestSuccessAt(
    importSourceRows.map((row) => ({ enabled: row.enabled, lastSuccessAt: row.last_success_at })),
  );

  return {
    client: { id: client.id, name: client.name },
    comparison,
    // Fundação (Etapa 2.1): alcance/frequência de período ainda não
    // conectados — ver doc-comment de `MetaAdsPeriodReach`.
    reach: null,
    resultSource: "meta_attributed",
    resultType: client.performance_goal,
    lastSyncAt,
    generatedAt: new Date().toISOString(),
  };
}
