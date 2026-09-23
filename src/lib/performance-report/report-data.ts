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
import { fetchReportCampaignClassifications } from "@/lib/report-campaign-classification-data";
import {
  buildPurposeByCampaignId,
  buildPurposeByCampaignName,
  isConfidentlySecondaryByName,
  resolveReportView,
  REPORT_PURPOSE_CONFIG,
  type ReportCampaignPurpose,
  type ReportView,
} from "@/lib/report-view-classification";

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
  /** Etapa "Filtro no topo afeta o dashboard inteiro": as MESMAS linhas
   * brutas (por dia, por campanha/público/criativo) que `campaigns`/
   * `adSets`/`creatives` já resumem em totais do período — antes eram
   * descartadas depois de alimentar `buildCampaignSummaries`/etc; agora
   * seguem adiante pra Camada 2/3 poder recalcular "Resultado Diário" e o
   * Resumo do período só pra quem bate no filtro ativo. Nenhuma consulta
   * nova: já eram buscadas aqui (Meta-only, mesmo filtro por canal de
   * sempre) — só não eram mais expostas fora desta função. */
  campaignDailyRows: CampaignDailyMetricRow[];
  adSetDailyRows: AdSetDailyMetricRow[];
  creativeDailyRows: AdCreativeDailyMetricRow[];
  /** Etapa "Filtro por campanha afeta o Relatório inteiro": mesma razão de
   * `campaignDailyRows`/`adSetDailyRows`/`creativeDailyRows` acima —
   * Posicionamentos só ganhou acesso à linha bruta agora porque, até esta
   * etapa, nada precisava reconstruir a tabela a partir dela (a agregação
   * sempre ignorava `campaignName` de propósito, ver
   * `lib/campaign-placement-analytics.ts`). Continua ignorado na agregação
   * em si — só usado pra FILTRAR as linhas por campanha antes de agregar. */
  placementDailyRows: CampaignPlacementDailyMetricRow[];
  /** Taxa de conversão (vendas ÷ carrinhos) — pedido explícito do usuário
   * ("carrinho é uma métrica secundária, só pra calcular a conversão").
   * Carrinho NUNCA é um `performance_goal`/aparece em `client_goals`: é só
   * mais um `result_type` dentro de `daily_performance` (`goal = 'carts'`
   * em `metric_mappings`, ver supabase/secondary-cart-metric.sql), somado
   * aqui direto da mesma tabela — `null` sem nenhum carrinho registrado no
   * período (cliente sem essa métrica configurada, caso comum hoje: só
   * Leonardo Darcadia tem). Só existe no nível de CONTA (os agregados por
   * campanha/público/criativo ignoram qualquer goal fora de leads/sales,
   * ver `lib/stract-sync.ts`) — por isso nunca recalculada sob o filtro de
   * Campanha/Público/Criativo (`ReportFilterableTables` some com o card
   * enquanto o filtro está ativo, mesmo tratamento de `periodReading`). */
  conversionRate: number | null;
  /** "Posicionamentos" (Meta "Platform Position" — feed, stories, reels
   * etc.) — pedido explícito do usuário. Escopo combinado com o usuário:
   * comparação no TOTAL DA CONTA (`buildPlacementSummaries` agrupa só por
   * posicionamento, nunca por campanha nesta v1). `[]` sem nenhuma fonte
   * com `import_sources.platform_position_column` configurado (caso comum
   * hoje: só Aibou tem) — a tabela "Posicionamentos" simplesmente mostra o
   * estado vazio nesse caso, nunca um dado fabricado. */
  placements: PlacementSummary[];
  generatedAt: string;
  /** Etapa "Separar o Relatório por finalidade das campanhas": qual das
   * duas visões este documento representa. `campaigns`/`adSets`/
   * `creatives`/`placements`/`dailyRows` acima já vêm FILTRADOS pra esta
   * visão — nunca um segundo filtro em `report-document.ts`. */
  view: ReportView;
  /** `true` quando o cliente tem pelo menos UMA campanha classificada numa
   * finalidade secundária (independente do período em exibição) — decide
   * se o seletor de visão aparece. `false` = Relatório continua
   * exatamente como sempre foi, sem nenhum elemento novo (cliente com
   * finalidade única continua com relatório simples, pedido explícito). */
  hasSecondaryCampaigns: boolean;
  /** Nomes de campanha (visão "principal") sem NENHUMA classificação —
   * nunca escondidas da tabela, só identificáveis (badge "Não
   * classificada" em `report-document.ts`). Vazio quando
   * `hasSecondaryCampaigns` é `false` (nunca mostra o badge pra quem não
   * usa a funcionalidade). */
  unclassifiedCampaignNames: string[];
  /** Só preenchido na visão "secundario" — investimento é a ÚNICA métrica
   * comparável entre finalidades diferentes (nunca soma
   * impressões+alcance+cliques), por isso é o único consolidado oferecido
   * aqui. `null` na visão "principal". */
  secondarySummary: { totalSpend: number; breakdown: { purpose: ReportCampaignPurpose; label: string; spend: number }[] } | null;
  /** Finalidade por NOME de campanha (`campaigns`/`campaignDailyRows` já
   * filtrados pra esta visão) — só as entradas classificadas, nunca todas
   * as campanhas do cliente. `report-document.ts` usa isso só pro badge de
   * finalidade da tabela Campanhas da visão "secundario" (Camada 2 nunca
   * recalcula classificação, só lê o que a Camada 1 já resolveu). */
  campaignPurposeByName: Record<string, ReportCampaignPurpose>;
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

function toFilterableCampaignRows(rows: CampaignDailyMetricRow[]): FilterableDailyRow[] {
  return rows.map((row) => ({ date: row.date, name: row.campaignName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
}

/**
 * Etapa "Separar o Relatório por finalidade das campanhas": Resumo/
 * Resultado Diário recalculados a partir SÓ das campanhas da visão
 * "principal" (`campaignDailyRows` já filtrado por quem chama) — nunca o
 * total de `daily_performance` da conta inteira, que incluiria também o
 * investimento das campanhas secundárias. Reaproveita `recomputeFilteredSummary`/
 * `recomputeDailyRows` (`report-filter-recompute.ts`, Etapa "Filtro no topo
 * afeta o dashboard inteiro") com texto de filtro vazio — mesmo cálculo já
 * testado, só aplicado sobre um subconjunto pré-filtrado em vez do texto
 * digitado pelo usuário.
 *
 * Só usada quando `hasSecondaryCampaigns` é verdadeiro (cliente realmente
 * usa a separação) — cliente sem nenhuma campanha secundária continua
 * lendo o total real da conta (`buildReportSummary`/`buildDailyRows`),
 * porque as duas fontes reconciliam exatamente quando não há nenhuma
 * campanha excluída da visão "principal".
 */
function buildCampaignRecomputedSummary(goal: PerformanceGoal, campaignDailyRows: CampaignDailyMetricRow[]): PerformanceReportSummary {
  if (campaignDailyRows.length === 0) return { status: "no_data" };
  const rows = toFilterableCampaignRows(campaignDailyRows);
  const performanceSummary = recomputeFilteredSummary(goal, rows, "contains", "");
  if (!performanceSummary.hasAnyRecord && (performanceSummary.actualSpend ?? 0) === 0) return { status: "no_data" };
  const kpis = buildAnalyticsKpiCards(goal, performanceSummary.actualSpend ?? 0, performanceSummary, null, formatCurrency);
  return { status: "ok", kpis, performanceSummary };
}

export async function buildPerformanceReportData(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
  view: ReportView = "principal",
): Promise<PerformanceReportData> {
  const [
    clientRows,
    analyticsData,
    campaignRowsAllChannels,
    adSetRowsAllChannels,
    creativeRows,
    dailyPerformanceRows,
    placementRowsAllChannels,
    classifications,
  ] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("id", clientId), "clients:performance-report"),
    fetchClientAnalyticsData(supabase, clientId, period, "meta"),
    getCampaignDailyMetricsForPeriod(supabase, clientId, period),
    getAdSetDailyMetricsForPeriod(supabase, clientId, period),
    getAdCreativeDailyMetricsForPeriod(supabase, clientId, period),
    // Taxa de conversão: `daily_performance` sem filtro de `result_type`
    // (`fetchClientAnalyticsData` acima já filtra pro objetivo principal só
    // — carrinho nunca é o objetivo principal, por isso precisa da sua
    // própria leitura, sem cálculo novo: MESMA função já usada pela janela
    // diária da Visão Geral, `getDailyPerformanceRowsForPeriod`).
    getDailyPerformanceRowsForPeriod(supabase, clientId, { firstDay: period.start, lastDay: period.end }),
    // Posicionamentos: `[]` pra cliente sem fonte com platform_position_column
    // configurado — nenhuma linha nessa tabela nesse caso, mesmo padrão de
    // getCampaignDailyMetricsForPeriod/getAdSetDailyMetricsForPeriod.
    getCampaignPlacementDailyMetricsForPeriod(supabase, clientId, period),
    // Etapa "Separar o Relatório por finalidade das campanhas" — classificação
    // vigente (independente do período em exibição, ver
    // `lib/report-campaign-classification-data.ts`).
    fetchReportCampaignClassifications(supabase, clientId),
  ]);

  const client = clientRows[0];

  // Meta-only v1: campaign_daily_metrics/ad_set_daily_metrics são
  // channel-aware (podem ter linhas de outros canais se o cliente também
  // usa Google) — filtra explicitamente. ad_creative_daily_metrics já é
  // implicitamente Meta-only (sem coluna de canal), nenhum filtro necessário.
  const campaignDailyRowsAll = campaignRowsAllChannels.filter((row) => row.channel === "meta");
  const adSetDailyRowsAll = adSetRowsAllChannels.filter((row) => row.channel === "meta");
  const placementDailyRowsAll: CampaignPlacementDailyMetricRow[] = placementRowsAllChannels.filter((row) => row.channel === "meta");

  // Etapa "Separar o Relatório por finalidade das campanhas": `campaignId`
  // é a identidade de classificação (nunca o nome — auditoria); Públicos/
  // Criativos/Posicionamentos só têm `campaignName`, então usam uma ponte
  // por nome derivada das linhas de campanha do MESMO período
  // (`buildPurposeByCampaignName`) — nome que resolve com ambiguidade
  // (`"ambiguous"`) nunca é tratado como secundário nem excluído da visão
  // principal, só fica de fora da visão secundária (ver
  // `isConfidentlySecondaryByName`).
  const purposeByCampaignId = buildPurposeByCampaignId(classifications);
  const hasSecondaryCampaigns = classifications.some((c) => resolveReportView(c.purpose) === "secundario");
  const purposeByCampaignName = buildPurposeByCampaignName(purposeByCampaignId, campaignDailyRowsAll);

  function campaignRowMatchesView(row: CampaignDailyMetricRow): boolean {
    const purpose = row.campaignId ? purposeByCampaignId.get(row.campaignId) : undefined;
    if (view === "secundario") return purpose !== undefined && resolveReportView(purpose) === "secundario";
    // "principal": mantém classificadas em leads/sales + NÃO classificadas
    // (nunca escondidas, auditoria seção 5) — só exclui as classificadas
    // numa finalidade secundária.
    return purpose === undefined || resolveReportView(purpose) === "principal";
  }

  function nameMatchesView(campaignName: string): boolean {
    const isSecondary = isConfidentlySecondaryByName(purposeByCampaignName, campaignName);
    return view === "secundario" ? isSecondary : !isSecondary;
  }

  const campaignDailyRows = campaignDailyRowsAll.filter(campaignRowMatchesView);
  const adSetDailyRows = adSetDailyRowsAll.filter((row) => nameMatchesView(row.campaignName));
  const creativeDailyRows = creativeRows.filter((row) => nameMatchesView(row.campaignName));
  const placementDailyRows = placementDailyRowsAll.filter((row) => nameMatchesView(row.campaignName));

  const campaigns = buildCampaignSummaries(campaignDailyRows);
  const adSets = buildAdSetSummaries(adSetDailyRows);
  const creatives = buildCreativeSummaries(creativeDailyRows);
  const placements = buildPlacementSummaries(placementDailyRows);

  const unclassifiedCampaignNames =
    hasSecondaryCampaigns && view === "principal"
      ? Array.from(
          new Set(
            campaignDailyRows.filter((row) => !(row.campaignId && purposeByCampaignId.has(row.campaignId))).map((row) => row.campaignName),
          ),
        )
      : [];

  // Resumo/Resultado Diário: recalculado a partir só das campanhas da
  // visão quando o cliente realmente separa finalidades (ver comentário de
  // `buildCampaignRecomputedSummary`); senão, o total real da conta de
  // sempre — idêntico ao Relatório de antes desta etapa.
  const summary: PerformanceReportSummary =
    view === "secundario"
      ? { status: "no_data" } // não renderizado nesta visão — ver `secondarySummary`.
      : hasSecondaryCampaigns && analyticsData.performanceGoal
        ? buildCampaignRecomputedSummary(analyticsData.performanceGoal, campaignDailyRows)
        : buildReportSummary(analyticsData);

  const dailyRows: PerformanceReportDailyRow[] =
    view === "secundario"
      ? []
      : hasSecondaryCampaigns
        ? recomputeDailyRows(period, toFilterableCampaignRows(campaignDailyRows), "contains", "")
        : buildDailyRows(period, analyticsData.dailyRows);

  // Taxa de conversão: só faz sentido na visão "principal" (carrinho/venda
  // nunca é uma finalidade secundária) — Meta-only, soma direta por
  // `result_type` (ver comentário original: 'carts' é aditivo só no banco,
  // nunca no tipo `PerformanceGoal` compartilhado por 65+ arquivos).
  let conversionRate: number | null = null;
  if (view === "principal") {
    const metaDailyPerformanceRows = dailyPerformanceRows.filter((row) => row.channel === "meta");
    const cartsCount = metaDailyPerformanceRows.filter((row) => (row.resultType as string) === "carts").reduce((sum, row) => sum + row.resultCount, 0);
    const salesCount = metaDailyPerformanceRows.filter((row) => row.resultType === "sales").reduce((sum, row) => sum + row.resultCount, 0);
    conversionRate = computeConversionRate(salesCount, cartsCount);
  }

  // Consolidado da visão "secundario": SÓ investimento (auditoria — a única
  // métrica comparável entre awareness/alcance/seguidores/tráfego/visitas,
  // nunca soma impressões+alcance+cliques).
  const secondarySummary =
    view === "secundario"
      ? (() => {
          const spendByPurpose = new Map<ReportCampaignPurpose, number>();
          for (const row of campaignDailyRows) {
            const purpose = row.campaignId ? purposeByCampaignId.get(row.campaignId) : undefined;
            if (!purpose) continue;
            spendByPurpose.set(purpose, (spendByPurpose.get(purpose) ?? 0) + row.spend);
          }
          const breakdown = Array.from(spendByPurpose.entries())
            .map(([purpose, spend]) => ({ purpose, label: REPORT_PURPOSE_CONFIG[purpose].label, spend }))
            .sort((a, b) => b.spend - a.spend);
          return { totalSpend: breakdown.reduce((sum, b) => sum + b.spend, 0), breakdown };
        })()
      : null;

  const campaignPurposeByName: Record<string, ReportCampaignPurpose> = {};
  for (const row of campaignDailyRows) {
    const purpose = row.campaignId ? purposeByCampaignId.get(row.campaignId) : undefined;
    if (purpose) campaignPurposeByName[row.campaignName] = purpose;
  }

  return {
    client: { id: client.id, name: client.name },
    period: { start: period.start, end: period.end, label: formatDateRange(period.start, period.end) },
    summary,
    performanceGoal: analyticsData.performanceGoal,
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
    hasSecondaryCampaigns,
    unclassifiedCampaignNames,
    secondarySummary,
    campaignPurposeByName,
  };
}
