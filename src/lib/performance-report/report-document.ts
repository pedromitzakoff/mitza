import { formatCurrency, formatDateWithYear, formatDateTimeWithYear, formatPercent, formatShortDate } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeCostPerResult, computeRoas, type PerformanceSummary } from "@/lib/performance";
import { NO_ANALYTICS_DATA_MESSAGE, NO_CAMPAIGNS_MESSAGE, NO_CREATIVES_MESSAGE, NO_PERFORMANCE_GOAL_MESSAGE } from "@/lib/analytics-messages";
import type { AnalyticsKpiCard, AnalyticsKpiComparisonTone } from "@/lib/analytics";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { AdSetSummary } from "@/lib/ad-set-analytics";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { PerformanceReportData, PerformanceReportDailyRow } from "./report-data";
import {
  buildCampaignBadges,
  buildPeriodReading,
  buildTargetVariationLabel,
  findBestCostCampaign,
  findHighestVolumeCampaign,
} from "./report-derivatives";

/**
 * Camada 2 — ESTRUTURA (KPIs + tabelas), independente de HTML/PDF. Cada
 * tabela é dado puro (nomes já formatados, `sortValue` numérico pra
 * ordenação) — NENHUM HTML pré-montado aqui (isso é 100% do renderer,
 * Camada 4, que decide como escapar/desenhar). Modular por desenho: Idade e
 * Gênero (fora de escopo nesta rodada — sem fonte de dado ainda, ver
 * auditoria) entram no futuro como mais duas entradas de `tables`/`PerformanceReportTable`,
 * sem precisar alterar este tipo nem o HTML renderer — só um novo builder
 * `buildAgeTable`/`buildGenderTable` seguindo o mesmo contrato.
 */
export interface PerformanceReportColumn {
  key: string;
  header: string;
}

export interface PerformanceReportMetricCell {
  /** Já formatado pra exibição (ex.: "R$ 4.830,68", "12,59x", "—"). */
  display: string;
  /** `null` = sempre ordena por último (dado ausente nunca "vence" nem
   * "perde" por acaso de direção). */
  sortValue: number | null;
}

export interface PerformanceReportRow {
  id: string;
  name: string;
  /** Só a tabela de Criativos preenche isso — miniatura pequena ao lado do
   * nome, nunca uma galeria (pedido explícito do usuário). */
  thumbnailUrl?: string | null;
  /** Só a tabela de Criativos preenche isso quando a coluna "Prévia" existe
   * (`hasPreviewColumn`) — `undefined`/`null` = sem link pra ESTE criativo
   * especificamente, mesmo que outros da mesma tabela tenham. */
  previewUrl?: string | null;
  /** Etapa "Resultado Diário": quando definido, o renderer mostra este
   * texto no lugar de TODAS as células de métrica (célula única, em vez de
   * uma por coluna) — usado só pra dias sem NENHUM sinal de sincronização
   * (nem investimento, nem resultado). `metrics` continua preenchido
   * normalmente mesmo nesse caso (todas as células `null`/"—"), pra
   * ordenação por coluna continuar funcionando igual — só a APRESENTAÇÃO
   * muda. Nunca usado pelas outras tabelas (uma campanha/público/criativo só
   * existe na tabela se teve alguma linha real no período, então nunca
   * "sem dado nenhum"). */
  rowNote?: string | null;
  /** Etapa "Otimização do Performance Report": só a tabela de Campanhas
   * preenche isso (`report-derivatives.ts`, `buildCampaignBadges`) — rótulos
   * curtos e discretos ("Melhor custo", "Maior volume", "Acima da meta",
   * "Abaixo da meta"), nunca mais de um por categoria (global vs. meta), e
   * NUNCA alteram `metrics`/`sortValue`/ordenação — puramente decoração da
   * linha já pronta. `undefined`/`[]` nas demais tabelas. */
  badges?: string[];
  metrics: PerformanceReportMetricCell[];
}

export interface PerformanceReportTable {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  nameColumnHeader: string;
  metricColumns: PerformanceReportColumn[];
  hasPreviewColumn: boolean;
  rows: PerformanceReportRow[];
  emptyMessage: string;
  /** `false` só na tabela de Resultado Diário (pedido explícito do usuário:
   * "quero todos os dias visíveis, não aplique progressive disclosure
   * nesta rodada") — as demais tabelas continuam com a disclosure de
   * sempre (10 linhas + "ver todas"). */
  disclosure: boolean;
  /** Linha de total — só a tabela de Resultado Diário preenche (soma das
   * aditivas, derivadas recalculadas do total, nunca média dos dias).
   * Renderizada sempre por último, fora da ordenação/disclosure das outras
   * linhas. `null` nas demais tabelas (Campanhas/Públicos/Criativos nunca
   * tiveram um total agregado pedido). */
  totalRow: PerformanceReportRow | null;
  /** `false` só na tabela de Resultado Diário (Etapa "Otimização do
   * Performance Report", item 7 — "5 itens" não agrega valor numa tabela
   * que já é sempre o período inteiro, dia a dia). As demais continuam
   * mostrando a contagem, mesmo padrão de sempre. */
  showItemCount: boolean;
}

export type PerformanceReportSummaryBlock =
  | { status: "no_goal"; message: string }
  | { status: "no_data"; message: string }
  | { status: "ok"; kpis: AnalyticsKpiCard[]; note: string };

export interface PerformanceReportDocument {
  clientName: string;
  periodLabel: string;
  generatedAtLabel: string;
  totalCampaigns: number;
  totalAdSets: number;
  totalCreatives: number;
  summary: PerformanceReportSummaryBlock;
  /** Etapa "Otimização do Performance Report" — 1 a 3 frases curtas,
   * determinísticas (`report-derivatives.ts`, `buildPeriodReading`), nunca
   * texto livre/IA generativa. `null` quando não há objetivo configurado ou
   * nenhum dado no período (mesmos estados de `summary`) — sem base
   * nenhuma pra qualquer leitura. */
  periodReading: string[] | null;
  tables: PerformanceReportTable[];
}

// Etapa "Otimização do Performance Report": nota de metodologia reduzida a
// uma linha discreta (pedido explícito — a regra de engenharia completa
// continua documentada no código, só não ocupa mais espaço de destaque no
// relatório do cliente).
const METHODOLOGY_NOTE = "Indicadores calculados a partir dos totais consolidados do período.";

/** Rótulo de resultado/custo — como é UMA coluna compartilhada por todas as
 * linhas da tabela, usa o objetivo comum quando todas as linhas do período o
 * compartilham (caso normal); no raro caso de objetivos MISTOS (múltiplos
 * `client_goals`), cai pro rótulo genérico "Resultado"/"Custo por
 * resultado" — nunca rotula errado uma linha classificada num objetivo
 * diferente. Mesma lógica já aprovada em `report-campaigns.tsx`/
 * `report-creatives.tsx` (o Relatório interativo existente), só reaplicada
 * aqui pro renderer HTML/PDF. */
function resolveResultLabels(resultTypes: Array<PerformanceGoal | null>): { resultLabel: string; costLabel: string } {
  const distinct = new Set(resultTypes.filter((t): t is PerformanceGoal => t !== null));
  const shared = distinct.size === 1 ? PERFORMANCE_GOALS[[...distinct][0] as PerformanceGoal] : null;
  return { resultLabel: shared?.resultMetricLabel ?? "Resultado", costLabel: shared?.costMetricShortLabel ?? "Custo por resultado" };
}

function metricCell(display: string | null, sortValue: number | null): PerformanceReportMetricCell {
  return { display: display ?? "—", sortValue };
}

/**
 * Badges de Campanhas (Etapa "Otimização do Performance Report", item 5) —
 * calculados uma única vez sobre a lista inteira (`findBestCostCampaign`/
 * `findHighestVolumeCampaign`, `report-derivatives.ts`) e aplicados por
 * linha; nunca recalculado por linha, nunca altera `totalSpend`/ordenação
 * (a lista continua ordenada por investimento, mesmo critério de sempre).
 * `targetCostPerResult` vem do MESMO `PerformanceSummary` do Resumo
 * Executivo — nunca uma meta diferente pro badge "Acima/Abaixo da meta".
 */
function buildCampaignsTable(campaigns: CampaignSummary[], targetCostPerResult: number | null): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(campaigns.map((c) => c.resultType));
  const hasRevenue = campaigns.some((c) => c.totalRevenue !== null);
  const hasRoas = campaigns.some((c) => c.roas !== null);
  const hasImpressions = campaigns.some((c) => c.totalImpressions !== null);
  const bestCostCampaign = findBestCostCampaign(campaigns);
  const highestVolumeCampaign = findHighestVolumeCampaign(campaigns);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    { key: "result", header: resultLabel },
    { key: "cost", header: costLabel },
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
  ];

  const rows: PerformanceReportRow[] = campaigns.map((c) => {
    const metrics: PerformanceReportMetricCell[] = [
      metricCell(formatCurrency(c.totalSpend), c.totalSpend),
      metricCell(c.totalResultCount !== null ? String(c.totalResultCount) : null, c.totalResultCount),
      metricCell(c.cpa !== null ? formatCurrency(c.cpa) : null, c.cpa),
    ];
    if (hasRevenue) metrics.push(metricCell(c.totalRevenue !== null ? formatCurrency(c.totalRevenue) : null, c.totalRevenue));
    if (hasRoas) metrics.push(metricCell(c.roas !== null ? `${c.roas.toFixed(2)}x` : null, c.roas));
    if (hasImpressions) metrics.push(metricCell(c.totalImpressions !== null ? String(c.totalImpressions) : null, c.totalImpressions));
    return {
      id: `${c.channel}-${c.campaignName}`,
      name: c.campaignName,
      badges: buildCampaignBadges(c, bestCostCampaign, highestVolumeCampaign, targetCostPerResult),
      metrics,
    };
  });

  return {
    id: "campanhas",
    eyebrow: "CAMPANHAS",
    title: "Campanhas",
    description: "Desempenho das campanhas no período.",
    nameColumnHeader: "Campanha",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: NO_CAMPAIGNS_MESSAGE,
    disclosure: true,
    totalRow: null,
    showItemCount: true,
  };
}

function buildAdSetsTable(adSets: AdSetSummary[]): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(adSets.map((a) => a.resultType));
  const hasRevenue = adSets.some((a) => a.totalRevenue !== null);
  const hasRoas = adSets.some((a) => a.roas !== null);
  const hasImpressions = adSets.some((a) => a.totalImpressions !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    { key: "result", header: resultLabel },
    { key: "cost", header: costLabel },
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
  ];

  const rows: PerformanceReportRow[] = adSets.map((a) => {
    const metrics: PerformanceReportMetricCell[] = [
      metricCell(formatCurrency(a.totalSpend), a.totalSpend),
      metricCell(a.totalResultCount !== null ? String(a.totalResultCount) : null, a.totalResultCount),
      metricCell(a.cpa !== null ? formatCurrency(a.cpa) : null, a.cpa),
    ];
    if (hasRevenue) metrics.push(metricCell(a.totalRevenue !== null ? formatCurrency(a.totalRevenue) : null, a.totalRevenue));
    if (hasRoas) metrics.push(metricCell(a.roas !== null ? `${a.roas.toFixed(2)}x` : null, a.roas));
    if (hasImpressions) metrics.push(metricCell(a.totalImpressions !== null ? String(a.totalImpressions) : null, a.totalImpressions));
    return { id: `${a.channel}-${a.adSetName}`, name: a.adSetName, metrics };
  });

  return {
    id: "publicos",
    eyebrow: "PÚBLICOS",
    title: "Públicos",
    description: "Desempenho por público no período.",
    nameColumnHeader: "Público",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Dados não disponíveis neste período.",
    disclosure: true,
    totalRow: null,
    showItemCount: true,
  };
}

function buildCreativesTable(creatives: CreativeSummary[]): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(creatives.map((c) => c.resultType));
  const hasCtr = creatives.some((c) => c.ctr !== null);
  const hasCpc = creatives.some((c) => c.cpc !== null);
  const hasRevenue = creatives.some((c) => c.totalRevenue !== null);
  const hasRoas = creatives.some((c) => c.roas !== null);
  const hasImpressions = creatives.some((c) => c.totalImpressions !== null);
  const hasAnyPermalink = creatives.some((c) => c.permalinkUrl !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    { key: "result", header: resultLabel },
    { key: "cost", header: costLabel },
    ...(hasCtr ? [{ key: "ctr", header: "CTR" }] : []),
    ...(hasCpc ? [{ key: "cpc", header: "CPC" }] : []),
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
    ...(hasImpressions ? [{ key: "impressions", header: "Impressões" }] : []),
  ];

  const rows: PerformanceReportRow[] = creatives.map((c) => {
    const metrics: PerformanceReportMetricCell[] = [
      metricCell(formatCurrency(c.totalSpend), c.totalSpend),
      metricCell(c.totalResultCount !== null ? String(c.totalResultCount) : null, c.totalResultCount),
      metricCell(c.cpa !== null ? formatCurrency(c.cpa) : null, c.cpa),
    ];
    if (hasCtr) metrics.push(metricCell(c.ctr !== null ? formatPercent(c.ctr * 100) : null, c.ctr));
    if (hasCpc) metrics.push(metricCell(c.cpc !== null ? formatCurrency(c.cpc) : null, c.cpc));
    if (hasRevenue) metrics.push(metricCell(c.totalRevenue !== null ? formatCurrency(c.totalRevenue) : null, c.totalRevenue));
    if (hasRoas) metrics.push(metricCell(c.roas !== null ? `${c.roas.toFixed(2)}x` : null, c.roas));
    if (hasImpressions) metrics.push(metricCell(c.totalImpressions !== null ? String(c.totalImpressions) : null, c.totalImpressions));
    return { id: c.creativeName, name: c.creativeName, thumbnailUrl: c.previewImageUrl, previewUrl: c.permalinkUrl, metrics };
  });

  return {
    id: "criativos",
    eyebrow: "CRIATIVOS",
    title: "Criativos",
    description: "Desempenho por criativo, com miniatura e link quando disponíveis.",
    nameColumnHeader: "Criativo",
    metricColumns,
    hasPreviewColumn: hasAnyPermalink,
    rows,
    emptyMessage: NO_CREATIVES_MESSAGE,
    disclosure: true,
    totalRow: null,
    showItemCount: true,
  };
}

/**
 * Resultado Diário — uma linha por dia civil do período (já preenchido pra
 * TODOS os dias por `buildDailyRows`, `report-data.ts`; nunca recorta aqui).
 * "Resultado"/"Custo por resultado" usam o MESMO objetivo do cliente do
 * Resumo Executivo (`performanceGoal`) — nunca uma segunda definição de
 * resultado principal. Receita/ROAS só aparecem quando pelo menos um dia
 * tiver o dado (mesmo padrão `hasRevenue`/`hasRoas` das outras 3 tabelas).
 *
 * Dias sem NENHUM sinal (nem investimento, nem resultado) ganham
 * `rowNote: "Sem dados"` — só quando os dois lados são genuinamente
 * desconhecidos (nunca quando há investimento real mas só falta o
 * resultado, ou vice-versa: nesse caso cada célula mostra seu próprio
 * valor/"—" normalmente, mesmo padrão de qualquer métrica ausente no resto
 * do relatório).
 *
 * Total: aditivas somadas ignorando dias sem dado (nunca contam como zero),
 * derivadas recalculadas do total via os MESMOS helpers canônicos
 * (`computeCostPerResult`/`computeRoas`) — nunca média dos dias. Este total
 * reconcilia exatamente com o Resumo Executivo pra investimento/resultado/
 * receita, porque vem das MESMAS linhas de origem (`ClientAnalyticsData`),
 * só reagrupadas por data em vez de somadas direto — ver
 * `scripts/test-performance-report-daily.ts`.
 */
function buildDailyTable(daily: PerformanceReportDailyRow[], performanceGoal: PerformanceGoal | null): PerformanceReportTable {
  const config = performanceGoal ? PERFORMANCE_GOALS[performanceGoal] : null;
  const resultLabel = config?.resultMetricLabel ?? "Resultado";
  const costLabel = config?.costMetricShortLabel ?? "Custo por resultado";
  const hasRevenue = daily.some((d) => d.revenue !== null);
  const hasRoas = daily.some((d) => d.roas !== null);

  const metricColumns: PerformanceReportColumn[] = [
    { key: "investment", header: "Investimento" },
    { key: "result", header: resultLabel },
    { key: "cost", header: costLabel },
    ...(hasRevenue ? [{ key: "revenue", header: "Receita" }] : []),
    ...(hasRoas ? [{ key: "roas", header: "ROAS" }] : []),
  ];

  function buildMetrics(spend: number | null, resultCount: number | null, costPerResult: number | null, revenue: number | null, roas: number | null): PerformanceReportMetricCell[] {
    const metrics: PerformanceReportMetricCell[] = [
      metricCell(spend !== null ? formatCurrency(spend) : null, spend),
      metricCell(resultCount !== null ? String(resultCount) : null, resultCount),
      metricCell(costPerResult !== null ? formatCurrency(costPerResult) : null, costPerResult),
    ];
    if (hasRevenue) metrics.push(metricCell(revenue !== null ? formatCurrency(revenue) : null, revenue));
    if (hasRoas) metrics.push(metricCell(roas !== null ? `${roas.toFixed(2)}x` : null, roas));
    return metrics;
  }

  const rows: PerformanceReportRow[] = daily.map((d) => {
    const hasNoSignalAtAll = d.spend === null && d.resultCount === null;
    return {
      id: d.date,
      name: formatShortDate(d.date),
      rowNote: hasNoSignalAtAll ? "Sem dados" : null,
      metrics: buildMetrics(d.spend, d.resultCount, d.costPerResult, d.revenue, d.roas),
    };
  });

  // Total — aditivas somadas (dias sem dado nunca contam como 0 na soma),
  // derivadas recalculadas do total.
  const daysWithSpend = daily.filter((d) => d.spend !== null);
  const totalSpend = daysWithSpend.length > 0 ? daysWithSpend.reduce((sum, d) => sum + d.spend!, 0) : null;

  const daysWithResult = daily.filter((d) => d.resultCount !== null);
  const totalResultCount = daysWithResult.length > 0 ? daysWithResult.reduce((sum, d) => sum + d.resultCount!, 0) : null;

  const daysWithRevenue = daily.filter((d) => d.revenue !== null);
  const totalRevenue = daysWithRevenue.length > 0 ? daysWithRevenue.reduce((sum, d) => sum + d.revenue!, 0) : null;

  const totalCostPerResult = computeCostPerResult(totalSpend, totalResultCount ?? 0, totalResultCount !== null);
  const totalRoas = computeRoas(totalRevenue, totalSpend);

  const totalRow: PerformanceReportRow = {
    id: "total",
    name: "Total",
    metrics: buildMetrics(totalSpend, totalResultCount, totalCostPerResult, totalRevenue, totalRoas),
  };

  return {
    id: "resultado-diario",
    eyebrow: "RESULTADO DIÁRIO",
    title: "Resultado diário",
    description: "Investimento e resultado de cada dia do período.",
    nameColumnHeader: "Data",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Nenhum dado disponível para os dias do período selecionado.",
    disclosure: false,
    totalRow,
    // Etapa "Otimização do Performance Report", item 7: a contagem de itens
    // não agrega valor numa tabela que já é sempre "todo o período, dia a
    // dia" — omitida só aqui, a estrutura de dados (`rows`) continua igual.
    showItemCount: false,
  };
}

/** Enriquece o card de custo (`key: "cost"`, sempre o único que
 * `buildAnalyticsKpiCards` popula com "Meta: R$X") com a variação
 * percentual — nunca recalcula a meta nem o custo, só troca o texto de
 * exibição usando `performanceSummary.comparison`/`targetCostPerResult`,
 * já canônicos. `tone` reaproveita `comparison.status` (mesma classificação
 * de `getPerformanceStatus`, ±10% de margem) — nunca uma segunda régua de
 * "isso está bom ou ruim". */
function enrichCostKpiWithTargetVariation(kpis: AnalyticsKpiCard[], performanceSummary: PerformanceSummary): AnalyticsKpiCard[] {
  const variationText = buildTargetVariationLabel(performanceSummary.comparison, performanceSummary.targetCostPerResult);
  if (!variationText) return kpis;

  const tone: AnalyticsKpiComparisonTone =
    performanceSummary.comparison.status === "worse" ? "negative" : performanceSummary.comparison.status === "better" ? "positive" : "neutral";

  return kpis.map((kpi) => (kpi.key === "cost" ? { ...kpi, comparison: { text: variationText, tone } } : kpi));
}

function buildSummaryBlock(data: PerformanceReportData): PerformanceReportSummaryBlock {
  if (data.summary.status === "no_goal") return { status: "no_goal", message: NO_PERFORMANCE_GOAL_MESSAGE };
  if (data.summary.status === "no_data") return { status: "no_data", message: NO_ANALYTICS_DATA_MESSAGE };
  const kpis = enrichCostKpiWithTargetVariation(data.summary.kpis, data.summary.performanceSummary);
  return { status: "ok", kpis, note: METHODOLOGY_NOTE };
}

/** `null` sem objetivo configurado ou sem dado no período — mesmos dois
 * estados de `buildSummaryBlock`, nenhuma leitura possível sem base
 * (`report-derivatives.ts`, `buildPeriodReading`). */
function buildPeriodReadingForDocument(data: PerformanceReportData): string[] | null {
  if (data.summary.status !== "ok" || !data.performanceGoal) return null;
  return buildPeriodReading({
    performanceGoal: data.performanceGoal,
    performanceSummary: data.summary.performanceSummary,
    campaigns: data.campaigns,
  });
}

export function buildPerformanceReportDocument(data: PerformanceReportData): PerformanceReportDocument {
  const targetCostPerResult = data.summary.status === "ok" ? data.summary.performanceSummary.targetCostPerResult : null;

  return {
    clientName: data.client.name,
    periodLabel: `${formatDateWithYear(data.period.start)} → ${formatDateWithYear(data.period.end)}`,
    generatedAtLabel: formatDateTimeWithYear(data.generatedAt),
    totalCampaigns: data.campaigns.length,
    totalAdSets: data.adSets.length,
    totalCreatives: data.creatives.length,
    summary: buildSummaryBlock(data),
    periodReading: buildPeriodReadingForDocument(data),
    // Ordem = ordem de renderização: Resultado Diário → Campanhas →
    // Públicos → Criativos (Resumo Executivo é renderizado à parte, fora
    // deste array, por quem consome o documento).
    tables: [
      buildDailyTable(data.dailyRows, data.performanceGoal),
      buildCampaignsTable(data.campaigns, targetCostPerResult),
      buildAdSetsTable(data.adSets),
      buildCreativesTable(data.creatives),
    ],
  };
}
