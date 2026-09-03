import { formatCurrency, formatDateWithYear, formatDateTimeWithYear, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { NO_ANALYTICS_DATA_MESSAGE, NO_CAMPAIGNS_MESSAGE, NO_CREATIVES_MESSAGE, NO_PERFORMANCE_GOAL_MESSAGE } from "@/lib/analytics-messages";
import type { AnalyticsKpiCard } from "@/lib/analytics";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { AdSetSummary } from "@/lib/ad-set-analytics";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { PerformanceReportData } from "./report-data";

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
  tables: PerformanceReportTable[];
}

const METHODOLOGY_NOTE =
  "Investimento, resultado e receita são somados a partir dos totais de cada agrupamento — CPA e ROAS são sempre recalculados por total÷total, nunca pela média das linhas individuais. Valores não numéricos na origem são tratados como ausência de dado desde a importação, nunca convertidos em zero.";

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

function buildCampaignsTable(campaigns: CampaignSummary[]): PerformanceReportTable {
  const { resultLabel, costLabel } = resolveResultLabels(campaigns.map((c) => c.resultType));
  const hasRevenue = campaigns.some((c) => c.totalRevenue !== null);
  const hasRoas = campaigns.some((c) => c.roas !== null);
  const hasImpressions = campaigns.some((c) => c.totalImpressions !== null);

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
    return { id: `${c.channel}-${c.campaignName}`, name: c.campaignName, metrics };
  });

  return {
    id: "campanhas",
    eyebrow: "PERFORMANCE POR CAMPANHA",
    title: "Performance por campanha",
    description: "Visão consolidada de investimento, resultado e eficiência de cada campanha — maior investimento primeiro.",
    nameColumnHeader: "Campanha",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: NO_CAMPAIGNS_MESSAGE,
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
    eyebrow: "PERFORMANCE POR PÚBLICO",
    title: "Performance por público",
    description: "Consolidação no nível de conjunto de anúncios (ad set) — um público pode aparecer em mais de uma campanha, somado como uma linha só.",
    nameColumnHeader: "Público",
    metricColumns,
    hasPreviewColumn: false,
    rows,
    emptyMessage: "Nenhum dado de público encontrado no período selecionado.",
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
    eyebrow: "PERFORMANCE POR CRIATIVO",
    title: "Performance por criativo",
    description: "Cada criativo é apresentado individualmente, com miniatura quando disponível e link direto pra peça quando informado.",
    nameColumnHeader: "Criativo",
    metricColumns,
    hasPreviewColumn: hasAnyPermalink,
    rows,
    emptyMessage: NO_CREATIVES_MESSAGE,
  };
}

function buildSummaryBlock(data: PerformanceReportData): PerformanceReportSummaryBlock {
  if (data.summary.status === "no_goal") return { status: "no_goal", message: NO_PERFORMANCE_GOAL_MESSAGE };
  if (data.summary.status === "no_data") return { status: "no_data", message: NO_ANALYTICS_DATA_MESSAGE };
  return { status: "ok", kpis: data.summary.kpis, note: METHODOLOGY_NOTE };
}

export function buildPerformanceReportDocument(data: PerformanceReportData): PerformanceReportDocument {
  return {
    clientName: data.client.name,
    periodLabel: `${formatDateWithYear(data.period.start)} → ${formatDateWithYear(data.period.end)}`,
    generatedAtLabel: formatDateTimeWithYear(data.generatedAt),
    totalCampaigns: data.campaigns.length,
    totalAdSets: data.adSets.length,
    totalCreatives: data.creatives.length,
    summary: buildSummaryBlock(data),
    tables: [buildCampaignsTable(data.campaigns), buildAdSetsTable(data.adSets), buildCreativesTable(data.creatives)],
  };
}
