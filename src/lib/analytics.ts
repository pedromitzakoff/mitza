import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import {
  aggregatePerformanceResults,
  computeCostPerResult,
  type PerformanceRecordRow,
  type PerformanceSummary,
} from "@/lib/performance";
import { computePercentChange } from "@/lib/period-comparison";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Núcleo puro de período/KPI reaproveitado pelo Relatório de Performance
 * (`lib/performance-report/`, via `app/clients/analytics-data.ts`) — mesmo
 * princípio de sempre: UMA estrutura única, que recebe as métricas
 * disponíveis e decide o que renderizar; nenhum
 * `if (objective === "leads") return <LeadsDashboard />` em lugar nenhum.
 * Reaproveita 100% do núcleo de performance já existente
 * (`lib/performance.ts`, `lib/performance-goals.ts`) — nenhum cálculo de
 * custo/ROAS/agregação é reimplementado aqui. Etapa "Relatório Único": o
 * antigo hub Analytics (aba própria dentro do cliente) que originou este
 * arquivo foi aposentado — o que resta aqui é só o que ainda alimenta o
 * Relatório de Performance e a tela de seleção de período
 * (`/clients/[id]/relatorio`).
 */

export type AnalyticsPeriodPreset = "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month" | "last_month" | "custom";

/**
 * Etapa "Relatório Único": "today"/"yesterday" entraram pra alimentar o
 * seletor de período do Relatório de Performance (`/clients/[id]/relatorio`)
 * — o Analytics MVP (aposentado nesta mesma etapa) nunca precisou de
 * granularidade diária aqui, mas o Relatório de Performance passou a ser
 * gerado sob demanda a qualquer momento, não só no fechamento mensal.
 */
export const ANALYTICS_PERIOD_PRESET_OPTIONS: { value: Exclude<AnalyticsPeriodPreset, "custom">; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last_7_days", label: "Últimos 7 dias" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "this_month", label: "Mês atual" },
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
 * Resolve o período a partir do preset da URL — SEMPRE independente de
 * sprint. "custom" exige as duas datas preenchidas (o formulário de período
 * personalizado só submete com elas); qualquer preset desconhecido ou
 * ausente cai no padrão ("this_month"), nunca lança erro. Fonte única de
 * verdade de semântica de data pro Relatório de Performance — a tela de
 * seleção de período do cliente (`/clients/[id]/relatorio`) e o painel
 * `/reports` (`app/reports/report-panel.ts`) sempre reaproveitam esta mesma
 * função, nunca uma segunda implementação de período.
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
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const yesterday = new Date(todayDate);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      return { start: yesterdayStr, end: yesterdayStr };
    }
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

export type AnalyticsKpiComparisonTone = "positive" | "negative" | "neutral";

export interface AnalyticsKpiComparison {
  text: string;
  tone: AnalyticsKpiComparisonTone;
}

export interface AnalyticsKpiCard {
  key: string;
  label: string;
  value: string;
  /** Linha auxiliar de contexto — variação vs. período anterior OU meta
   * configurada (nunca as duas juntas no mesmo card). `null`/ausente = sem
   * base de comparação real (nunca fabricada). */
  comparison?: AnalyticsKpiComparison | null;
}

/** Constrói a linha "↑18% vs período anterior" — `direction` decide se um
 * aumento é bom (`higher_is_better`, ex.: ROAS/resultado/receita), ruim
 * (`lower_is_better`, ex.: custo por resultado) ou nem uma coisa nem outra
 * (`neutral`, ex.: investimento — gastar mais/menos não é em si bom ou
 * ruim). `null` sempre que não há período anterior comparável (mesma regra
 * de `computePercentChange`: nunca uma variação fabricada). Exportada
 * (Etapa "Revisão da Visão Geral"): "Evolução no período" reaproveita esta
 * mesma função pros KPIs executivos da agência — nenhuma segunda versão do
 * texto/tom "↑X% vs período anterior". */
export function buildPercentChangeComparison(
  current: number,
  previous: number | null,
  direction: "higher_is_better" | "lower_is_better" | "neutral",
): AnalyticsKpiComparison | null {
  const percentChange = computePercentChange(current, previous);
  if (percentChange === null) return null;

  const symbol = percentChange >= 0 ? "↑" : "↓";
  const tone: AnalyticsKpiComparisonTone =
    direction === "neutral" ? "neutral" : direction === "higher_is_better" ? (percentChange >= 0 ? "positive" : "negative") : percentChange <= 0 ? "positive" : "negative";

  return { text: `${symbol}${Math.abs(percentChange).toFixed(0)}% vs período anterior`, tone };
}

/**
 * Cards de KPI — Etapa "Analytics Instagramável": lista curta e EXPLÍCITA por
 * objetivo (pedido direto do usuário — "poucas informações muito bem
 * apresentadas", nunca uma dezena de cards). Investimento aparece sempre (é
 * o único KPI comum a todo objetivo, sempre o primeiro); os demais são
 * exatamente os indicadores que o usuário definiu como relevantes por
 * objetivo — nunca um card a mais mostrando um dado que já está no Hero
 * (por isso "Vendas"/contagem bruta não aparece aqui pra `sales`: ROAS +
 * CPA + Receita já contam essa história, e a contagem em si já é o Hero
 * quando não há receita configurada). Métrica indisponível vira "—", nunca
 * um card removido (a ausência do dado é informação: mostra que existe uma
 * lacuna, não esconde o card inteiro).
 *
 * Facelift "Analytics Instagramável": cada card ganha uma linha de contexto
 * (variação vs. período anterior, ou "Meta: R$X" quando configurada) —
 * reaproveita 100% dado que já existe (`previousSummary`, já buscado pro
 * Hero; `targetCostPerResult`, já dentro de `summary`), nenhuma consulta
 * nova. Meta tem prioridade sobre variação pro card de custo — é a
 * comparação mais acionável pro gestor quando existe.
 */
export function buildAnalyticsKpiCards(
  goal: PerformanceGoal | null,
  actualSpend: number,
  summary: PerformanceSummary | null,
  previousSummary: PerformanceSummary | null,
  formatCurrencyValue: (value: number) => string,
): AnalyticsKpiCard[] {
  const investment: AnalyticsKpiCard = {
    key: "investment",
    label: "Investimento",
    value: formatCurrencyValue(actualSpend),
    comparison: buildPercentChangeComparison(actualSpend, previousSummary?.actualSpend ?? null, "neutral"),
  };
  if (!goal || !summary || !summary.hasAnyRecord) return [investment];

  const config = PERFORMANCE_GOALS[goal];

  const costComparison: AnalyticsKpiComparison | null =
    summary.targetCostPerResult !== null
      ? { text: `Meta: ${formatCurrencyValue(summary.targetCostPerResult)}`, tone: "neutral" }
      : summary.costPerResult !== null
        ? buildPercentChangeComparison(summary.costPerResult, previousSummary?.costPerResult ?? null, "lower_is_better")
        : null;

  const cost: AnalyticsKpiCard = {
    key: "cost",
    label: config.costMetricShortLabel,
    value: summary.costPerResult !== null ? formatCurrencyValue(summary.costPerResult) : "—",
    comparison: costComparison,
  };

  if (goal === "sales") {
    return [
      investment,
      {
        key: "roas",
        label: "ROAS",
        value: summary.roas !== null ? `${summary.roas.toFixed(2)}x` : "—",
        comparison: summary.roas !== null ? buildPercentChangeComparison(summary.roas, previousSummary?.roas ?? null, "higher_is_better") : null,
      },
      cost,
      {
        key: "revenue",
        label: "Receita",
        value: summary.revenue !== null ? formatCurrencyValue(summary.revenue) : "—",
        comparison: summary.revenue !== null ? buildPercentChangeComparison(summary.revenue, previousSummary?.revenue ?? null, "higher_is_better") : null,
      },
      // Etapa "Visão Geral: decisão em 5 segundos": Ticket médio saiu da
      // Visão Geral (era ruído numa tela pensada pra decisão em 5 segundos)
      // e passou a viver só aqui — Analytics é a tela de investigação, o
      // lugar certo pra mais um dado de contexto sobre a mesma receita já
      // mostrada acima. Mesmo valor de sempre (`PerformanceSummary.averageTicket`),
      // nenhum cálculo novo.
      {
        key: "averageTicket",
        label: "Ticket médio",
        value: summary.averageTicket !== null ? formatCurrencyValue(summary.averageTicket) : "—",
        comparison:
          summary.averageTicket !== null
            ? buildPercentChangeComparison(summary.averageTicket, previousSummary?.averageTicket ?? null, "higher_is_better")
            : null,
      },
    ];
  }

  return [
    investment,
    {
      key: "result",
      label: config.resultMetricLabel,
      value: String(summary.resultCount),
      comparison: buildPercentChangeComparison(summary.resultCount, previousSummary?.resultCount ?? null, "higher_is_better"),
    },
    cost,
  ];
}

export interface AnalyticsChannelRow {
  channel: TrafficChannel;
  spend: number;
  resultCount: number;
  costPerResult: number | null;
  revenue: number | null;
}

/**
 * Detalhamento por CANAL (Meta/Google/etc.) — granularidade mais alta que
 * campanha/criativo (essas duas vivem em `ad_creative_daily_metrics`, ver
 * `lib/creative-analytics.ts`/`lib/campaign-analytics.ts`). Consumido por
 * `fetchClientAnalyticsData` (`app/clients/analytics-data.ts`) como parte de
 * `ClientAnalyticsData.channelRows`. Só inclui canais com pelo menos
 * investimento ou resultado real registrado no período (nunca uma linha
 * "zerada" por completo).
 *
 * `instagram` nunca entra aqui (Etapa Integração Instagram) — é uma fonte
 * de RESULTADO orgânico, nunca um canal de investimento próprio; uma linha
 * "Instagram: R$0,00 por seguidor" seria enganosa (o investimento real que
 * cruza com esse resultado é de outro canal, Meta Ads — ver
 * `resolvePerformanceSummaryForGoal`, `lib/instagram-metrics.ts`). O
 * cruzamento cross-fonte aparece só nos cards de KPI do topo, nunca nesta
 * tabela por canal (que assume implicitamente "mesmo canal investe e
 * gera o resultado").
 */
export function buildAnalyticsChannelRows(
  goal: PerformanceGoal,
  records: PerformanceRecordRow[],
  spendByChannel: Partial<Record<TrafficChannel, number>>,
): AnalyticsChannelRow[] {
  const channelsWithData = new Set<TrafficChannel>();
  for (const record of records) {
    if (record.resultType === goal && record.channel !== "instagram") channelsWithData.add(record.channel);
  }
  for (const channel of Object.keys(spendByChannel) as TrafficChannel[]) {
    if (channel !== "instagram" && (spendByChannel[channel] ?? 0) > 0) channelsWithData.add(channel);
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
