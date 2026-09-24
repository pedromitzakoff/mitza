import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { buildAnalyticsKpiCards, type AnalyticsKpiCard } from "@/lib/analytics";
import type { ClientAnalyticsData, ClientAnalyticsDailyRow } from "@/app/clients/analytics-data";
import { fetchClientAnalyticsData } from "@/app/clients/analytics-data";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { buildCampaignSummaries, type CampaignSummary, type CampaignDailyMetricRow } from "@/lib/campaign-analytics";
import { getAdSetDailyMetricsForPeriod } from "@/lib/ad-set-analytics-data";
import { buildAdSetSummaries, type AdSetSummary, type AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeSummaries, type CreativeSummary, type AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import { getCampaignPlacementDailyMetricsForPeriod } from "@/lib/campaign-placement-analytics-data";
import { buildPlacementSummaries, type PlacementSummary, type CampaignPlacementDailyMetricRow } from "@/lib/campaign-placement-analytics";
import { computeCostPerResult, computeRoas, computeConversionRate, type PerformanceSummary } from "@/lib/performance";
import { recomputeDailyRows, recomputeFilteredSummary, type FilterableDailyRow } from "@/lib/performance-report/report-filter-recompute";
import { listDatesInclusive } from "@/lib/monthly-budget";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { getDailyPerformanceRowsForPeriod } from "@/lib/performance-queries";
import { fetchClientFunnels, fetchCampaignFunnelAssignments } from "@/lib/client-funnels-data";
import {
  buildFunnelByCampaignId,
  buildFunnelByCampaignName,
  resolveFunnelForCampaignName,
  aggregateSpendByFunnel,
  funnelShowsResults,
  sortFunnelsForDisplay,
  type ClientFunnel,
} from "@/lib/client-funnels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Gestão de Funis Estratégicos por Cliente": substitui a Etapa
 * anterior ("Separar o Relatório por finalidade das campanhas",
 * `principal`/`secundario`) por um seletor real — "Visão geral" (conta
 * inteira, sempre) e "Visão por funil" (uma campanha classificada por vez,
 * pra QUALQUER funil que o gestor tenha criado, não mais uma lista fixa de 7
 * finalidades). Substituição funcional e compatível (pedido explícito do
 * usuário): tudo que a Etapa anterior fazia continua possível — um funil
 * "Reconhecimento" com `relevantIndicators: ['impressions']` e sem meta
 * vinculada reproduz exatamente o antigo "awareness"; um funil "Vendas" com
 * `linkedResultType: 'sales'` reproduz o antigo "sales" — só que agora
 * configurável pelo painel, nunca fixo em código. A tabela por trás
 * (`campaign_report_classifications`) tinha ZERO linhas em produção até essa
 * migration, então não há nenhuma classificação real perdida na troca (ver
 * `supabase/client-funnels.sql`).
 *
 * `ReportView` viaja como string simples na URL (`"geral"` ou o `id` de um
 * `client_funnels` do cliente) — resolvida aqui (`resolveReportView`) porque
 * esta função já carrega os funis do cliente de qualquer forma; um id de
 * funil inválido/removido cai em "geral" sem quebrar (nunca um 404 por um
 * link salvo antigo).
 */
export type ReportView = string;
export const GENERAL_REPORT_VIEW: ReportView = "geral";

export function isGeneralReportView(view: ReportView): boolean {
  return view === GENERAL_REPORT_VIEW;
}

function resolveReportView(raw: string | undefined, funnels: ClientFunnel[]): ReportView {
  if (!raw || raw === GENERAL_REPORT_VIEW) return GENERAL_REPORT_VIEW;
  return funnels.some((f) => f.id === raw) ? raw : GENERAL_REPORT_VIEW;
}

/**
 * Camada 1 do Gerador de Relatório de Performance — dado puro, nenhum
 * cálculo novo: TUDO aqui vem de uma função já usada/auditada em outro lugar
 * da MITZA (`fetchClientAnalyticsData` + `buildAnalyticsKpiCards`;
 * `buildCampaignSummaries`/`buildAdSetSummaries`/`buildCreativeSummaries`,
 * os MESMOS agregadores canônicos das respectivas seções). v1 é
 * deliberadamente Meta-only (pedido explícito do usuário, "Priorize Meta
 * Ads") — nenhuma lógica de seletor de plataforma/Google Ads aqui.
 *
 * `summary` reflete 3 estados: sem objetivo configurado pra esta VISÃO
 * (`no_goal` — sem `performance_goal` na "geral", ou funil sem
 * `linkedResultType`/`relevantIndicators` sem "results" na "por funil"),
 * sem nenhum dado no período (`no_data`), ou só investimento
 * (`investment_only` — funil real com dado, mas deliberadamente sem meta de
 * resultado vinculada, ex.: Distribuição de Conteúdo). Campanhas/Públicos/
 * Criativos são buscados INDEPENDENTE do status do resumo.
 */
export type PerformanceReportSummary =
  | { status: "no_goal" }
  | { status: "no_data" }
  | { status: "investment_only"; totalSpend: number }
  | { status: "ok"; kpis: AnalyticsKpiCard[]; performanceSummary: PerformanceSummary };

export interface PerformanceReportDailyRow {
  date: string;
  spend: number | null;
  resultCount: number | null;
  revenue: number | null;
  costPerResult: number | null;
  roas: number | null;
}

/** Um funil do cliente, já com o investimento do período (Visão geral) —
 * dado pronto pro painorama, nunca recalculado na camada de apresentação. */
export interface ReportFunnelPanoramaEntry {
  funnelId: string;
  funnelName: string;
  spend: number;
}

export interface PerformanceReportData {
  client: { id: string; name: string };
  period: { start: string; end: string; label: string };
  summary: PerformanceReportSummary;
  /** Objetivo relevante pra ESTA visão — "geral" usa o objetivo principal do
   * cliente (`ClientAnalyticsData.performanceGoal`, como sempre foi);
   * "por funil" usa `client_funnels.linked_result_type` do funil selecionado
   * (`null` quando o funil não tem meta vinculada) — nunca o mesmo campo pras
   * duas visões, pra "Resultado Diário"/rótulos nunca nomearem errado o
   * resultado mostrado. */
  performanceGoal: PerformanceGoal | null;
  dailyRows: PerformanceReportDailyRow[];
  campaigns: CampaignSummary[];
  adSets: AdSetSummary[];
  creatives: CreativeSummary[];
  campaignDailyRows: CampaignDailyMetricRow[];
  adSetDailyRows: AdSetDailyMetricRow[];
  creativeDailyRows: AdCreativeDailyMetricRow[];
  placementDailyRows: CampaignPlacementDailyMetricRow[];
  /** Taxa de conversão (vendas ÷ carrinhos) — só na Visão geral (carrinho é
   * uma contagem de CONTA, não filtrável por campanha/funil — misturar com
   * uma visão já recortada por funil violaria "nunca somar investimento
   * fora do escopo mostrado"). `null` na Visão por funil e sem carrinho
   * registrado no período. */
  conversionRate: number | null;
  placements: PlacementSummary[];
  generatedAt: string;
  /** Qual visão este documento representa — `"geral"` ou o id de um funil do
   * cliente. `campaigns`/`adSets`/`creatives`/`placements`/`dailyRows` acima
   * já vêm FILTRADOS pra esta visão quando é um funil — nunca um segundo
   * filtro em `report-document.ts`. */
  view: ReportView;
  /** Funis ativos do cliente, pra montar o seletor — `[]` decide se ele
   * aparece (cliente sem nenhum funil configurado continua com o Relatório
   * exatamente como sempre foi, nenhum elemento novo visível). */
  activeFunnels: { id: string; name: string }[];
  /** Só preenchido na Visão geral com pelo menos um funil configurado —
   * investimento total (sempre o mesmo da conta) + como ele se reparte entre
   * os funis existentes, nunca uma soma incompatível (só investimento é
   * comparável entre funis diferentes). */
  funnelPanorama: { totalSpend: number; breakdown: ReportFunnelPanoramaEntry[]; unassignedSpend: number } | null;
  /** Nomes de campanha (Visão geral) sem NENHUM funil confirmado — nunca
   * escondidas da tabela, só identificáveis (badge "Pendente de funil" em
   * `report-document.ts`, mesmo tratamento do antigo "Não classificada").
   * Vazio sem nenhum funil configurado (nunca mostra o badge pra quem não
   * usa a funcionalidade) — a ação de classificar em lote vive na seção
   * "Funis" da página do cliente, nunca duplicada aqui. */
  pendingFunnelCampaignNames: string[];
  /** `true` quando, na Visão por funil, pelo menos uma campanha do funil não
   * tem `campaignId` confiável ou seu nome é ambíguo entre campanhas — sinal
   * de que Públicos/Criativos/Posicionamentos abaixo podem estar
   * incompletos pra este funil (nunca escondido, ver auditoria seção 5).
   * `false` na Visão geral (nunca filtra por nome lá). */
  funnelFilterMayBeIncomplete: boolean;
  /** `null` na Visão geral (Camada 2 sempre mostra tudo que os dados
   * tiverem, comportamento intocado). Na Visão por funil, exatamente os
   * indicadores que o gestor marcou como relevantes pra ESTE funil
   * (`client_funnels.relevant_indicators`) — "results" já resolvido por
   * `funnelShowsResults` (nunca `true` sem meta vinculada, mesmo se
   * marcado). */
  selectedFunnelIndicators: { results: boolean; impressions: boolean; reach: boolean; clicks: boolean } | null;
}

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

  const kpis = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, null, formatCurrency);
  return { status: "ok", kpis, performanceSummary: data.summary! };
}

function toFilterableCampaignRows(rows: CampaignDailyMetricRow[]): FilterableDailyRow[] {
  return rows.map((row) => ({ date: row.date, name: row.campaignName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
}

/**
 * Resumo/Resultado Diário de um FUNIL específico, a partir só das campanhas
 * que pertencem a ele (`campaignDailyRows` já filtrado por quem chama).
 * Reaproveita `recomputeFilteredSummary` (Etapa "Filtro no topo afeta o
 * dashboard inteiro") com texto de filtro vazio — mesmo cálculo já testado,
 * só sobre um subconjunto pré-filtrado por funil em vez de texto digitado.
 */
function buildFunnelResultSummary(goal: PerformanceGoal, campaignDailyRows: CampaignDailyMetricRow[]): PerformanceReportSummary {
  if (campaignDailyRows.length === 0) return { status: "no_data" };
  const rows = toFilterableCampaignRows(campaignDailyRows);
  const performanceSummary = recomputeFilteredSummary(goal, rows, "contains", "");
  if (!performanceSummary.hasAnyRecord && (performanceSummary.actualSpend ?? 0) === 0) return { status: "no_data" };
  const kpis = buildAnalyticsKpiCards(goal, performanceSummary.actualSpend ?? 0, performanceSummary, null, formatCurrency);
  return { status: "ok", kpis, performanceSummary };
}

/** Resumo de um funil SEM meta de resultado vinculada (ou sem "results" nos
 * indicadores relevantes) — só investimento, nunca um resultado fabricado
 * (auditoria: "results" sem meta vinculada nunca produz número real). */
function buildFunnelInvestmentOnlySummary(campaignDailyRows: CampaignDailyMetricRow[]): PerformanceReportSummary {
  if (campaignDailyRows.length === 0) return { status: "no_data" };
  const totalSpend = campaignDailyRows.reduce((sum, row) => sum + row.spend, 0);
  if (totalSpend === 0) return { status: "no_data" };
  return { status: "investment_only", totalSpend };
}

export async function buildPerformanceReportData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
  viewParam?: string,
): Promise<PerformanceReportData> {
  const [
    clientRows,
    analyticsData,
    campaignRowsAllChannels,
    adSetRowsAllChannels,
    creativeRows,
    dailyPerformanceRows,
    placementRowsAllChannels,
    funnelsUnsorted,
    assignments,
  ] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:performance-report"),
    fetchClientAnalyticsData(supabase, clientId, period, "meta"),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
    getAdSetDailyMetricsForPeriod(supabase, clientId, period),
    getAdCreativeDailyMetricsForPeriod(supabase, clientId, period),
    getDailyPerformanceRowsForPeriod(supabase, clientId, { firstDay: period.start, lastDay: period.end }),
    getCampaignPlacementDailyMetricsForPeriod(supabase, clientId, period),
    // Etapa "Gestão de Funis Estratégicos por Cliente" — funis + classificação
    // vigente (independente do período em exibição, ver `lib/client-funnels-data.ts`).
    fetchClientFunnels(supabase, clientId),
    fetchCampaignFunnelAssignments(supabase, clientId),
  ]);

  const client = clientRows[0];
  const funnels = sortFunnelsForDisplay(funnelsUnsorted);
  const activeFunnels = funnels.filter((f) => f.isActive);
  const view = resolveReportView(viewParam, funnels);
  const selectedFunnel = isGeneralReportView(view) ? null : (funnels.find((f) => f.id === view) ?? null);

  // Meta-only v1: campaign_daily_metrics/ad_set_daily_metrics são
  // channel-aware (podem ter linhas de outros canais se o cliente também
  // usa Google) — filtra explicitamente. ad_creative_daily_metrics já é
  // implicitamente Meta-only (sem coluna de canal), nenhum filtro necessário.
  const campaignDailyRowsAll = campaignRowsAllChannels.filter((row) => row.channel === "meta");
  const adSetDailyRowsAll = adSetRowsAllChannels.filter((row) => row.channel === "meta");
  const placementDailyRowsAll: CampaignPlacementDailyMetricRow[] = placementRowsAllChannels.filter((row) => row.channel === "meta");

  const funnelByCampaignId = buildFunnelByCampaignId(assignments);
  const funnelByCampaignName = buildFunnelByCampaignName(funnelByCampaignId, campaignDailyRowsAll);

  const pendingFunnelCampaignNames =
    funnels.length > 0
      ? Array.from(
          new Set(
            campaignDailyRowsAll.filter((row) => !(row.campaignId && funnelByCampaignId.has(row.campaignId))).map((row) => row.campaignName),
          ),
        )
      : [];

  let campaignDailyRows = campaignDailyRowsAll;
  let adSetDailyRows = adSetRowsAllChannels.filter((row) => row.channel === "meta");
  let creativeDailyRows = creativeRows;
  let placementDailyRows = placementDailyRowsAll;
  let funnelFilterMayBeIncomplete = false;

  if (selectedFunnel) {
    campaignDailyRows = campaignDailyRowsAll.filter((row) => row.campaignId && funnelByCampaignId.get(row.campaignId) === selectedFunnel.id);
    adSetDailyRows = adSetDailyRowsAll.filter((row) => resolveFunnelForCampaignName(funnelByCampaignName, row.campaignName) === selectedFunnel.id);
    creativeDailyRows = creativeRows.filter((row) => resolveFunnelForCampaignName(funnelByCampaignName, row.campaignName) === selectedFunnel.id);
    placementDailyRows = placementDailyRowsAll.filter(
      (row) => resolveFunnelForCampaignName(funnelByCampaignName, row.campaignName) === selectedFunnel.id,
    );
    funnelFilterMayBeIncomplete = campaignDailyRows.some(
      (row) => !row.campaignId || funnelByCampaignName.get(row.campaignName) === "ambiguous",
    );
  }

  const campaigns = buildCampaignSummaries(campaignDailyRows);
  const adSets = buildAdSetSummaries(adSetDailyRows);
  const creatives = buildCreativeSummaries(creativeDailyRows);
  const placements = buildPlacementSummaries(placementDailyRows);

  const selectedFunnelIndicators = selectedFunnel
    ? {
        results: funnelShowsResults(selectedFunnel),
        impressions: selectedFunnel.relevantIndicators.includes("impressions"),
        reach: selectedFunnel.relevantIndicators.includes("reach"),
        clicks: selectedFunnel.relevantIndicators.includes("clicks"),
      }
    : null;

  const performanceGoal: PerformanceGoal | null = selectedFunnel
    ? funnelShowsResults(selectedFunnel)
      ? selectedFunnel.linkedResultType
      : null
    : analyticsData.performanceGoal;

  const summary: PerformanceReportSummary = selectedFunnel
    ? funnelShowsResults(selectedFunnel) && selectedFunnel.linkedResultType
      ? buildFunnelResultSummary(selectedFunnel.linkedResultType, campaignDailyRows)
      : buildFunnelInvestmentOnlySummary(campaignDailyRows)
    : buildReportSummary(analyticsData);

  const dailyRows: PerformanceReportDailyRow[] = selectedFunnel
    ? summary.status === "ok"
      ? recomputeDailyRows(period, toFilterableCampaignRows(campaignDailyRows), "contains", "")
      : []
    : buildDailyRows(period, analyticsData.dailyRows);

  // Taxa de conversão: só na Visão geral (carrinho é contagem de CONTA,
  // nunca filtrável por campanha/funil).
  let conversionRate: number | null = null;
  if (!selectedFunnel) {
    const metaDailyPerformanceRows = dailyPerformanceRows.filter((row) => row.channel === "meta");
    const cartsCount = metaDailyPerformanceRows.filter((row) => (row.resultType as string) === "carts").reduce((sum, row) => sum + row.resultCount, 0);
    const salesCount = metaDailyPerformanceRows.filter((row) => row.resultType === "sales").reduce((sum, row) => sum + row.resultCount, 0);
    conversionRate = computeConversionRate(salesCount, cartsCount);
  }

  // Painorama de funis — só na Visão geral, só quando o cliente tem algum
  // funil configurado. Investimento é a ÚNICA métrica somada entre funis
  // diferentes (nunca soma resultado — leads/vendas/seguidores de funis
  // diferentes não são somáveis, auditoria).
  const funnelPanorama =
    !selectedFunnel && funnels.length > 0
      ? (() => {
          const spendByFunnel = aggregateSpendByFunnel(campaignDailyRowsAll, funnelByCampaignId);
          const breakdown: ReportFunnelPanoramaEntry[] = funnels
            .filter((f) => (spendByFunnel.get(f.id) ?? 0) > 0)
            .map((f) => ({ funnelId: f.id, funnelName: f.name, spend: spendByFunnel.get(f.id) ?? 0 }))
            .sort((a, b) => b.spend - a.spend);
          const unassignedSpend = spendByFunnel.get(null) ?? 0;
          const totalSpend = breakdown.reduce((sum, entry) => sum + entry.spend, 0) + unassignedSpend;
          return { totalSpend, breakdown, unassignedSpend };
        })()
      : null;

  return {
    client: { id: client.id, name: client.name },
    period: { start: period.start, end: period.end, label: formatDateRange(period.start, period.end) },
    summary,
    performanceGoal,
    dailyRows,
    campaigns,
    adSets,
    creatives,
    campaignDailyRows,
    adSetDailyRows,
    creativeDailyRows,
    placementDailyRows,
    conversionRate,
    placements,
    generatedAt: new Date().toISOString(),
    view,
    activeFunnels: activeFunnels.map((f) => ({ id: f.id, name: f.name })),
    funnelPanorama,
    pendingFunnelCampaignNames,
    funnelFilterMayBeIncomplete,
    selectedFunnelIndicators,
  };
}
