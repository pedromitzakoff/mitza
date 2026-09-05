import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { buildAnalyticsKpiCards, type AnalyticsKpiCard } from "@/lib/analytics";
import type { ClientAnalyticsData, ClientAnalyticsDailyRow } from "@/app/clients/analytics-data";
import { fetchClientAnalyticsData } from "@/app/clients/analytics-data";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { buildCampaignSummaries, type CampaignSummary } from "@/lib/campaign-analytics";
import { getAdSetDailyMetricsForPeriod } from "@/lib/ad-set-analytics-data";
import { buildAdSetSummaries, type AdSetSummary } from "@/lib/ad-set-analytics";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries, type CreativeSummary } from "@/lib/creative-analytics";
import { computeCostPerResult, computeRoas, type PerformanceSummary } from "@/lib/performance";
import { listDatesInclusive } from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada 1 do Gerador de Relatório de Performance — dado puro, nenhum
 * cálculo novo: TUDO aqui vem de uma função já usada/auditada em outro lugar
 * da MITZA (`fetchClientAnalyticsData` + `buildAnalyticsKpiCards`;
 * `buildCampaignSummaries`/`buildAdSetSummaries`/`buildCreativeSummaries`,
 * os MESMOS agregadores canônicos das respectivas seções). v1 é
 * deliberadamente Meta-only (pedido explícito do usuário, "Priorize Meta
 * Ads") — nenhuma lógica de seletor de plataforma/Google Ads aqui.
 *
 * `summary` reflete 2 estados: sem objetivo configurado (`no_goal`) ou sem
 * nenhum dado no período (`no_data`) — nunca um 3º estado
 * "platform_not_connected" (não existe seletor de plataforma nesta v1).
 * Campanhas/Públicos/Criativos são buscados INDEPENDENTE do status do
 * objetivo — um cliente sem `performance_goal` configurado ainda
 * pode ter investimento/campanhas reais no período.
 *
 * `performanceSummary` (Etapa "Otimização do Performance Report"): o MESMO
 * `PerformanceSummary` que `data.summary` (`ClientAnalyticsData`) já
 * calculava — só agora também exposto pra Camada 2 (`report-document.ts`)
 * derivar a variação vs. meta e a "Leitura do período"
 * (`report-derivatives.ts`), sem recalcular nada nem consultar de novo.
 */
export type PerformanceReportSummary =
  | { status: "no_goal" }
  | { status: "no_data" }
  | { status: "ok"; kpis: AnalyticsKpiCard[]; performanceSummary: PerformanceSummary };

/**
 * Uma linha por DIA CIVIL do período (Etapa "Resultado Diário") — sempre
 * uma linha por data do intervalo inteiro, mesmo sem nenhum sinal (isso é
 * decidido aqui, nunca em `report-document.ts`/componente de apresentação).
 * Aditivas (`spend`/`resultCount`/`revenue`) vêm direto de
 * `ClientAnalyticsData.dailyRows` (já explicado lá: `null` = sem sinal pra
 * essa data, nunca `0` fabricado — exceto `resultCount`, que pode ser `0`
 * CONFIRMADO quando há sinal de sincronização). Derivadas
 * (`costPerResult`/`roas`) recalculadas aqui a partir das aditivas do MESMO
 * dia, via os MESMOS helpers canônicos de `lib/performance.ts` usados pelo
 * resto da MITZA — nunca uma segunda fórmula.
 */
export interface PerformanceReportDailyRow {
  date: string;
  spend: number | null;
  resultCount: number | null;
  revenue: number | null;
  costPerResult: number | null;
  roas: number | null;
}

export interface PerformanceReportData {
  client: { id: string; name: string };
  period: { start: string; end: string; label: string };
  summary: PerformanceReportSummary;
  /** Objetivo principal do cliente — mesma fonte de `summary`
   * (`ClientAnalyticsData.performanceGoal`), exposto aqui porque
   * `report-document.ts` precisa dele pra rotular a coluna "Resultado" da
   * seção Resultado Diário com o MESMO nome de objetivo usado no Resumo
   * Executivo (Leads/Vendas/Seguidores) — nunca uma segunda definição de
   * resultado principal. */
  performanceGoal: PerformanceGoal | null;
  dailyRows: PerformanceReportDailyRow[];
  campaigns: CampaignSummary[];
  adSets: AdSetSummary[];
  creatives: CreativeSummary[];
  generatedAt: string;
}

/**
 * Preenche TODOS os dias civis do período (`listDatesInclusive`, mesma
 * função já usada por `lib/daily-results.ts` pro mesmo tipo de janela —
 * nenhuma segunda semântica de data), mesmo os que não têm nenhuma linha em
 * `dailyRows` — é isso que permite a tabela mostrar "sem dado" pro dia 3 de
 * um período 1-3 quando só o dia 1 sincronizou, em vez de a tabela
 * simplesmente terminar cedo. `dailyRows` (esparso) vem de
 * `ClientAnalyticsData`, já com a mesma soma que alimenta o Resumo
 * Executivo — Σ dos dias aqui reconcilia exatamente com `actualSpend`/
 * `summary.resultCount`/`summary.revenue` (mesmas linhas de origem, só
 * reagrupadas por data em vez de somadas num total só).
 */
export function buildDailyRows(period: { start: string; end: string }, dailyRows: ClientAnalyticsDailyRow[]): PerformanceReportDailyRow[] {
  const byDate = new Map(dailyRows.map((row) => [row.date, row]));

  return listDatesInclusive(period.start, period.end).map((date): PerformanceReportDailyRow => {
    const row = byDate.get(date);
    const spend = row?.spend ?? null;
    const resultCount = row?.resultCount ?? null;
    const revenue = row?.revenue ?? null;
    const hasAnyRecord = resultCount !== null;

    return {
      date,
      spend,
      resultCount,
      revenue,
      costPerResult: computeCostPerResult(spend, resultCount ?? 0, hasAnyRecord),
      roas: computeRoas(revenue, spend),
    };
  });
}

function buildReportSummary(data: ClientAnalyticsData): PerformanceReportSummary {
  if (!data.performanceGoal) return { status: "no_goal" };

  const hasAnyData = data.actualSpend > 0 || (data.summary?.hasAnyRecord ?? false);
  if (!hasAnyData) return { status: "no_data" };

  // `previousSummary: null` deliberado — este relatório nunca mostra
  // variação percentual vs. período anterior (pedido explícito do usuário
  // na 1ª auditoria: "recalculados a partir dos totais", nunca comparação
  // temporal nos KPIs do topo). `buildAnalyticsKpiCards` já trata
  // `previousSummary: null` como "sem base de comparação", omitindo a linha
  // de contexto sem nenhuma mudança na função em si.
  const kpis = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, null, formatCurrency);
  // `hasAnyData` já garante `data.summary !== null` aqui (só é `null` quando
  // `performanceGoal` também é `null`, que já retornou "no_goal" acima).
  return { status: "ok", kpis, performanceSummary: data.summary! };
}

export async function buildPerformanceReportData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
): Promise<PerformanceReportData> {
  const [clientRows, analyticsData, campaignRowsAllChannels, adSetRowsAllChannels, creativeRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:performance-report"),
    fetchClientAnalyticsData(supabase, clientId, period, "meta"),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
    getAdSetDailyMetricsForPeriod(supabase, clientId, period),
    getAdCreativeDailyMetricsForPeriod(supabase, clientId, period),
  ]);

  const client = clientRows[0];

  // Meta-only v1: campaign_daily_metrics/ad_set_daily_metrics são
  // channel-aware (podem ter linhas de outros canais se o cliente também
  // usa Google) — filtra explicitamente. ad_creative_daily_metrics já é
  // implicitamente Meta-only (sem coluna de canal), nenhum filtro necessário.
  const campaigns = buildCampaignSummaries(campaignRowsAllChannels.filter((row) => row.channel === "meta"));
  const adSets = buildAdSetSummaries(adSetRowsAllChannels.filter((row) => row.channel === "meta"));
  const creatives = buildCreativeSummaries(creativeRows);

  return {
    client: { id: client.id, name: client.name },
    period: { start: period.start, end: period.end, label: formatDateRange(period.start, period.end) },
    summary: buildReportSummary(analyticsData),
    performanceGoal: analyticsData.performanceGoal,
    dailyRows: buildDailyRows(period, analyticsData.dailyRows),
    campaigns,
    adSets,
    creatives,
    generatedAt: new Date().toISOString(),
  };
}
