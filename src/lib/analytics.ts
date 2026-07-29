import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow, type PerformanceSummary } from "@/lib/performance";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";

/**
 * Lógica pura do MVP de Analytics (aba dentro do cliente, nunca visível na
 * visão global da agência) — mesmo princípio central do pedido do usuário:
 * UMA estrutura única, que recebe as métricas disponíveis e decide o que
 * renderizar; nenhum `if (objective === "leads") return <LeadsDashboard />`
 * em lugar nenhum. Reaproveita 100% do núcleo de performance já existente
 * (`lib/performance.ts`, `lib/performance-goals.ts`) — nenhum cálculo de
 * custo/ROAS/agregação é reimplementado aqui.
 */

export type AnalyticsPeriodPreset = "last_7_days" | "last_30_days" | "this_month" | "last_month" | "custom";

export const ANALYTICS_PERIOD_PRESET_OPTIONS: { value: Exclude<AnalyticsPeriodPreset, "custom">; label: string }[] = [
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
];

export interface AnalyticsPeriod {
  start: string;
  end: string;
}

function lastNDaysRange(today: string, days: number): AnalyticsPeriod {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: today };
}

function monthRange(year: number, month: number): AnalyticsPeriod {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return { start: firstDay.toISOString().slice(0, 10), end: lastDay.toISOString().slice(0, 10) };
}

/**
 * Resolve o período do Analytics a partir do preset da URL — SEMPRE
 * independente de sprint (pedido explícito do usuário: "não vincular o
 * Analytics a uma sprint"). "custom" exige as duas datas preenchidas (o
 * formulário de período personalizado só submete com elas); qualquer preset
 * desconhecido ou ausente cai no padrão ("this_month"), nunca lança erro.
 */
export function resolveAnalyticsPeriod(
  preset: string | undefined,
  today: string,
  custom?: { start?: string; end?: string },
): AnalyticsPeriod {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const year = todayDate.getUTCFullYear();
  const month = todayDate.getUTCMonth();

  switch (preset) {
    case "last_7_days":
      return lastNDaysRange(today, 7);
    case "last_30_days":
      return lastNDaysRange(today, 30);
    case "last_month":
      return monthRange(year, month - 1);
    case "custom":
      if (custom?.start && custom?.end && custom.end >= custom.start) return { start: custom.start, end: custom.end };
      return monthRange(year, month);
    case "this_month":
    default:
      return monthRange(year, month);
  }
}

export interface AnalyticsKpiCard {
  key: string;
  label: string;
  value: string;
}

const MAX_KPI_CARDS = 6;

/**
 * Cards de KPI — a mesma estrutura visual pra qualquer objetivo; o que muda
 * é só QUANTOS cards existem, decidido pela presença real do dado no
 * `PerformanceSummary` (nunca por um `if (goal === ...)` solto). Investimento
 * aparece sempre (é o único KPI comum a todo objetivo); os demais só entram
 * quando `summary.hasAnyRecord` — sem registro nenhum, o card correspondente
 * simplesmente não existe (nunca "0" fabricado).
 */
export function buildAnalyticsKpiCards(
  goal: PerformanceGoal | null,
  actualSpend: number,
  summary: PerformanceSummary | null,
  formatCurrencyValue: (value: number) => string,
): AnalyticsKpiCard[] {
  const cards: AnalyticsKpiCard[] = [{ key: "investment", label: "Investimento", value: formatCurrencyValue(actualSpend) }];
  if (!goal || !summary || !summary.hasAnyRecord) return cards.slice(0, MAX_KPI_CARDS);

  const config = PERFORMANCE_GOALS[goal];
  cards.push({ key: "result", label: config.resultMetricLabel, value: String(summary.resultCount) });
  cards.push({
    key: "cost",
    label: config.costMetricLabel,
    value: summary.costPerResult !== null ? formatCurrencyValue(summary.costPerResult) : "—",
  });
  if (summary.revenue !== null) cards.push({ key: "revenue", label: "Faturamento", value: formatCurrencyValue(summary.revenue) });
  if (summary.roas !== null) cards.push({ key: "roas", label: "ROAS", value: `${summary.roas.toFixed(2)}x` });

  return cards.slice(0, MAX_KPI_CARDS);
}

export interface AnalyticsChannelRow {
  channel: TrafficChannel;
  spend: number;
  resultCount: number;
  costPerResult: number | null;
  revenue: number | null;
}

/**
 * Detalhamento por CANAL — substitui deliberadamente o "detalhamento por
 * campanha" pedido originalmente: a MITZA não guarda identidade de campanha
 * em NENHUMA tabela hoje (o Import Service agrega e descarta esse dado ao
 * gravar em `daily_spend`/`daily_performance` — ver
 * `import_sources.campaign_name_column`; o fluxo manual, `performance_records`,
 * nunca teve essa dimensão). Canal (`channel`) é a granularidade mais fina
 * que de fato existe e é consultável pra qualquer cliente — nunca inventa
 * uma dimensão que o sistema não possui. Só inclui canais com pelo menos
 * investimento ou resultado real registrado no período (nunca uma linha
 * "zerada" por completo).
 */
export function buildAnalyticsChannelRows(
  goal: PerformanceGoal,
  records: PerformanceRecordRow[],
  spendByChannel: Partial<Record<TrafficChannel, number>>,
): AnalyticsChannelRow[] {
  const channelsWithData = new Set<TrafficChannel>();
  for (const record of records) {
    if (record.resultType === goal) channelsWithData.add(record.channel);
  }
  for (const channel of Object.keys(spendByChannel) as TrafficChannel[]) {
    if ((spendByChannel[channel] ?? 0) > 0) channelsWithData.add(channel);
  }

  return Array.from(channelsWithData)
    .map((channel): AnalyticsChannelRow => {
      const spend = spendByChannel[channel] ?? 0;
      const aggregated = aggregatePerformanceResults(records, goal, channel);
      return {
        channel,
        spend,
        resultCount: aggregated.resultCount,
        costPerResult: computeCostPerResult(spend, aggregated.resultCount, aggregated.hasAnyRecord),
        revenue: aggregated.revenue,
      };
    })
    .sort((a, b) => b.resultCount - a.resultCount);
}

export interface AnalyticsInsight {
  key: string;
  title: string;
  subject: string;
  detail: string;
}

const MAX_INSIGHTS = 4;

/**
 * Insights determinísticos, sem IA — mesmas 4 regras do pedido original,
 * só com "canal" no lugar de "campanha" (ver `buildAnalyticsChannelRows`
 * acima pro motivo). Só faz sentido com mais de 1 canal: com um único
 * canal, os KPIs do topo já contam toda a história, um insight repetiria a
 * mesma informação com outras palavras.
 */
export function buildAnalyticsChannelInsights(
  rows: AnalyticsChannelRow[],
  goal: PerformanceGoal,
  formatCurrencyValue: (value: number) => string,
): AnalyticsInsight[] {
  if (rows.length < 2) return [];

  const config = PERFORMANCE_GOALS[goal];
  const channelLabel = (c: TrafficChannel) => TRAFFIC_CHANNELS[c].label;
  const insights: AnalyticsInsight[] = [];

  const topVolume = [...rows].sort((a, b) => b.resultCount - a.resultCount)[0];
  if (topVolume.resultCount > 0) {
    insights.push({
      key: "top_volume",
      title: "Maior volume",
      subject: channelLabel(topVolume.channel),
      detail: `${topVolume.resultCount} ${config.resultMetricLabel.toLowerCase()} no período.`,
    });
  }

  const withResult = rows.filter((r) => r.resultCount > 0 && r.costPerResult !== null);
  if (withResult.length > 0) {
    const bestEfficiency = [...withResult].sort((a, b) => a.costPerResult! - b.costPerResult!)[0];
    insights.push({
      key: "best_efficiency",
      title: "Melhor eficiência",
      subject: channelLabel(bestEfficiency.channel),
      detail: `${config.costMetricLabel} de ${formatCurrencyValue(bestEfficiency.costPerResult!)}.`,
    });
  }

  const topSpend = [...rows].sort((a, b) => b.spend - a.spend)[0];
  if (topSpend.spend > 0) {
    insights.push({
      key: "top_spend",
      title: "Maior investimento",
      subject: channelLabel(topSpend.channel),
      detail: `${formatCurrencyValue(topSpend.spend)} investidos no período.`,
    });
  }

  const noResultDespiteSpend = rows.find((r) => r.spend > 0 && r.resultCount === 0);
  if (noResultDespiteSpend) {
    insights.push({
      key: "attention_no_result",
      title: "Atenção",
      subject: channelLabel(noResultDespiteSpend.channel),
      detail: `${formatCurrencyValue(noResultDespiteSpend.spend)} investidos sem nenhum resultado registrado no período.`,
    });
  }

  return insights.slice(0, MAX_INSIGHTS);
}

export interface AnalyticsTrendSeries {
  label: string;
  points: { date: string; value: number }[];
}

export interface AnalyticsTrend {
  /** Sempre presente quando houver dias suficientes — `daily_spend` tem
   * granularidade diária pra qualquer cliente (sync nativo do Meta). */
  spend: AnalyticsTrendSeries;
  /** `null` quando não há granularidade diária de RESULTADO — só existe pra
   * clientes com integração Stract ativa (`daily_performance`); o fluxo
   * manual (`performance_records`) só registra por sprint/período, nunca
   * por dia. Limitação real do que a MITZA armazena hoje, não uma omissão. */
  result: AnalyticsTrendSeries | null;
}

const MIN_TREND_DAYS = 2;

/**
 * Série de evolução diária pro gráfico principal — `null` quando não há
 * pelo menos `MIN_TREND_DAYS` dias de investimento no período (a interface
 * mostra a mensagem discreta nesse caso, nunca um gráfico vazio/quebrado).
 */
export function buildAnalyticsTrend(
  goal: PerformanceGoal | null,
  dailySpendByDate: Map<string, number>,
  dailyResultByDate: Map<string, number> | null,
): AnalyticsTrend | null {
  const spendDates = Array.from(dailySpendByDate.keys()).sort();
  if (spendDates.length < MIN_TREND_DAYS) return null;

  const spend: AnalyticsTrendSeries = {
    label: "Investimento",
    points: spendDates.map((date) => ({ date, value: dailySpendByDate.get(date) ?? 0 })),
  };

  if (!goal || !dailyResultByDate || dailyResultByDate.size === 0) return { spend, result: null };

  const result: AnalyticsTrendSeries = {
    label: PERFORMANCE_GOALS[goal].resultMetricLabel,
    points: spendDates.map((date) => ({ date, value: dailyResultByDate.get(date) ?? 0 })),
  };

  return { spend, result };
}
