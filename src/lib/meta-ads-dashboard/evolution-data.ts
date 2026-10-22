import { listDatesInclusive } from "@/lib/monthly-budget";
import type { CampaignDailyMetricRow } from "@/lib/campaign-analytics";
import type { PeriodRange } from "@/lib/period-comparison";
import { computeCpm, computeCtr, computeCpc, computeCostPerResult, computeRoas } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { resolveResultLabels } from "./metric-cards";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.3 (Gráficos interativos).
 * Núcleo puro da seção "Evolução da performance" — séries DIÁRIAS das
 * métricas aditivas/derivadas, pro período atual e pro anterior
 * equivalente. Alcance/Frequência NUNCA entram aqui (pedido explícito do
 * usuário, item 8 da Etapa 2.3: "sem somar indicadores não aditivos") — a
 * única fonte correta de alcance/frequência (`fetchAccountPeriodReachSnapshot`,
 * Etapa 2.2) devolve UM número pro período inteiro, não uma série diária;
 * construí-la dia a dia exigiria uma chamada à Graph API por dia do
 * período (inaceitável, pedido do usuário: "evitar consultas
 * desnecessárias à API") — e nunca somar `campaign_daily_metrics.reach`
 * entre dias pra simular isso (o mesmo erro de dobra-contagem já evitado
 * em todo o resto do dashboard).
 */

export type ChartMetricId =
  | "investment"
  | "results"
  | "costPerResult"
  | "impressions"
  | "clicks"
  | "linkClicks"
  | "ctr"
  | "linkCtr"
  | "cpc"
  | "linkCpc"
  | "cpm"
  | "roas";

export type ChartMetricUnit = "currency" | "count" | "percent" | "ratio";

export interface ChartMetricDef {
  id: ChartMetricId;
  label: string;
  unit: ChartMetricUnit;
}

/** Ordem canônica — mesma ordem do seletor de métrica do gráfico. KOFF
 * Analytics Fase 2, Etapa 2.4: cliques no link/CTR do link/CPC do link
 * entram aqui, sempre logo depois do par "geral" equivalente — mesma
 * disciplina dos cards de KPI (`metric-cards.ts`), nunca confundidos com
 * `clicks`/`ctr`/`cpc` (cliques TOTAIS). */
export const CHART_METRIC_IDS: ChartMetricId[] = [
  "investment",
  "results",
  "costPerResult",
  "impressions",
  "clicks",
  "linkClicks",
  "ctr",
  "linkCtr",
  "cpc",
  "linkCpc",
  "cpm",
  "roas",
];

export function buildChartMetricDefs(resultType: PerformanceGoal | null): ChartMetricDef[] {
  const { resultLabel, costLabel } = resolveResultLabels(resultType);
  return [
    { id: "investment", label: "Investimento", unit: "currency" },
    { id: "results", label: resultLabel, unit: "count" },
    { id: "costPerResult", label: costLabel, unit: "currency" },
    { id: "impressions", label: "Impressões", unit: "count" },
    { id: "clicks", label: "Cliques totais", unit: "count" },
    { id: "linkClicks", label: "Cliques no link", unit: "count" },
    { id: "ctr", label: "CTR geral", unit: "percent" },
    { id: "linkCtr", label: "CTR do link", unit: "percent" },
    { id: "cpc", label: "CPC geral", unit: "currency" },
    { id: "linkCpc", label: "CPC do link", unit: "currency" },
    { id: "cpm", label: "CPM", unit: "currency" },
    { id: "roas", label: "ROAS", unit: "ratio" },
  ];
}

export interface DailyAdditiveTotals {
  date: string;
  /** `false` = nenhuma linha de `campaign_daily_metrics` nesse dia — todo
   * valor desse dia vira `null` (um vão real na linha do gráfico), nunca um
   * `0` fabricado. Mesma convenção de `buildDailyRows`
   * (`performance-report/report-data.ts`). */
  hasAnyRecord: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  /** Cliques no link/CTA de destino — `null` quando NENHUMA linha do dia
   * tem esse campo (dia sincronizado antes da coluna existir, ou fonte sem
   * o campo configurado) — nunca `0` fabricado, mesma convenção de
   * `revenue`. KOFF Analytics Fase 2, Etapa 2.4. */
  linkClicks: number | null;
  resultCount: number;
  revenue: number | null;
}

/** Agrupa as linhas brutas (já filtradas por cliente/canal/período, mesma
 * responsabilidade de quem chama) por dia civil, preenchendo TODOS os dias
 * do período (mesmo os sem nenhuma linha, via `listDatesInclusive` —
 * `lib/monthly-budget.ts`, a mesma função que `report-data.ts` já usa) —
 * nunca um dia "pulado" silenciosamente no eixo X do gráfico. */
export function buildDailyAdditiveTotals(period: PeriodRange, rows: CampaignDailyMetricRow[]): DailyAdditiveTotals[] {
  const byDate = new Map<string, CampaignDailyMetricRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return listDatesInclusive(period.start, period.end).map((date): DailyAdditiveTotals => {
    const dayRows = byDate.get(date);
    if (!dayRows || dayRows.length === 0) {
      return { date, hasAnyRecord: false, spend: 0, impressions: 0, clicks: 0, linkClicks: null, resultCount: 0, revenue: null };
    }

    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    let linkClicks: number | null = null;
    let resultCount = 0;
    let revenue: number | null = null;
    for (const row of dayRows) {
      spend += row.spend;
      impressions += row.impressions ?? 0;
      clicks += row.clicks ?? 0;
      if (row.linkClicks !== null) linkClicks = (linkClicks ?? 0) + row.linkClicks;
      resultCount += row.resultCount ?? 0;
      if (row.revenue !== null) revenue = (revenue ?? 0) + row.revenue;
    }
    return { date, hasAnyRecord: true, spend, impressions, clicks, linkClicks, resultCount, revenue };
  });
}

/** Valor de UMA métrica num UM dia — `null` quando o dia não tem nenhum
 * registro (vão na linha, nunca `0` fabricado). Métricas derivadas usam o
 * MESMO núcleo central (`lib/performance.ts`, `safeDivide` por baixo),
 * nunca uma segunda fórmula — sempre a partir dos totais aditivos DESSE
 * DIA (nunca do acumulado do período, que já tem sua própria exibição nos
 * cards de KPI, Etapa 2.2). */
export function computeDailyMetricValue(id: ChartMetricId, day: DailyAdditiveTotals): number | null {
  if (!day.hasAnyRecord) return null;

  switch (id) {
    case "investment":
      return day.spend;
    case "results":
      return day.resultCount;
    case "costPerResult":
      return computeCostPerResult(day.spend, day.resultCount, day.hasAnyRecord);
    case "impressions":
      return day.impressions;
    case "clicks":
      return day.clicks;
    case "linkClicks":
      return day.linkClicks;
    case "ctr":
      return computeCtr(day.clicks, day.impressions);
    case "linkCtr":
      return day.linkClicks !== null ? computeCtr(day.linkClicks, day.impressions) : null;
    case "cpc":
      return computeCpc(day.spend, day.clicks);
    case "linkCpc":
      return day.linkClicks !== null ? computeCpc(day.spend, day.linkClicks) : null;
    case "cpm":
      return computeCpm(day.spend, day.impressions);
    case "roas":
      return computeRoas(day.revenue, day.spend);
  }
}

export interface ChartSeriesPoint {
  date: string;
  value: number | null;
}

export function buildMetricSeries(id: ChartMetricId, days: DailyAdditiveTotals[]): ChartSeriesPoint[] {
  return days.map((day) => ({ date: day.date, value: computeDailyMetricValue(id, day) }));
}

export interface ChartMetricSeries extends ChartMetricDef {
  current: ChartSeriesPoint[];
  /** Mesma quantidade de pontos de `current` (`previousEquivalentPeriod`
   * garante a MESMA duração) — alinhável por índice/posição (dia 1 do
   * período atual com dia 1 do período anterior), nunca por data civil
   * (datas diferentes entre os dois períodos). */
  previous: ChartSeriesPoint[];
}

/**
 * Monta as séries diárias das 12 métricas selecionáveis no gráfico, pro
 * período atual E pro anterior equivalente — uma única passada sobre as
 * linhas já buscadas por quem chama (`buildCockpitAdPerformanceData`,
 * `dashboard-data.ts` — nenhuma segunda consulta ao banco: item do pedido
 * "evitar consultas desnecessárias").
 */
export function buildEvolutionSeries(
  period: PeriodRange,
  previousPeriod: PeriodRange,
  currentRows: CampaignDailyMetricRow[],
  previousRows: CampaignDailyMetricRow[],
  resultType: PerformanceGoal | null,
): ChartMetricSeries[] {
  const currentDays = buildDailyAdditiveTotals(period, currentRows);
  const previousDays = buildDailyAdditiveTotals(previousPeriod, previousRows);
  const defs = buildChartMetricDefs(resultType);

  return defs.map((def) => ({
    ...def,
    current: buildMetricSeries(def.id, currentDays),
    previous: buildMetricSeries(def.id, previousDays),
  }));
}
