import { buildPercentChangeComparison, type AnalyticsKpiComparison } from "@/lib/analytics";
import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { MetaAdsDashboardData, MetaAdsReachSnapshot } from "./dashboard-data";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.2 (Cards de KPI configuráveis).
 * Núcleo puro: recebe o `MetaAdsDashboardData` já montado (Camada 1) e
 * devolve os 11 cards prontos pra exibição (valor já formatado + variação
 * já calculada) — nenhum componente de tela recalcula nada, só apresenta.
 * Reaproveita `buildPercentChangeComparison` (`lib/analytics.ts`, já usado
 * pelos KPIs do Relatório/Visão Geral) pra "↑X% vs período anterior" com o
 * MESMO tom semântico (verde-limão só quando a variação é `positive`) —
 * nenhuma segunda fórmula/rótulo de comparação.
 */

export type MetricCardId =
  | "investment"
  | "results"
  | "costPerResult"
  | "impressions"
  | "reach"
  | "frequency"
  | "clicks"
  | "cpc"
  | "ctr"
  | "cpm"
  | "roas";

/** Ordem canônica de apresentação — a mesma ordem usada na lista de
 * personalização e como ordem inicial dos cards selecionados. */
export const ALL_METRIC_CARD_IDS: MetricCardId[] = [
  "investment",
  "results",
  "costPerResult",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "cpc",
  "ctr",
  "cpm",
  "roas",
];

/** Seleção inicial inteligente (~6 métricas principais) — pedido explícito
 * do usuário. Cobre investimento (quanto saiu), resultado (o que voltou),
 * custo por resultado (eficiência), impressões/cliques (volume do funil) e
 * CTR (qualidade do anúncio). Alcance/frequência ficam de fora do padrão
 * por decisão deliberada: dependem da integração direta Meta (podem chegar
 * "indisponível" pra quem só usa Stract) — disponíveis via personalização,
 * nunca forçados na primeira experiência. */
export const DEFAULT_SELECTED_METRIC_IDS: MetricCardId[] = ["investment", "results", "costPerResult", "impressions", "clicks", "ctr"];

export interface MetricCardViewModel {
  id: MetricCardId;
  label: string;
  value: string;
  /** `null` = sem base de comparação válida (sem período anterior, métrica
   * indisponível, ou período anterior sem registro) — nunca uma variação
   * fabricada. */
  comparison: AnalyticsKpiComparison | null;
}

function formatRatio(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Texto do card quando o alcance/frequência de período não está
 * disponível — nunca "0", sempre uma explicação do motivo (pedido do
 * usuário: "mostrar um estado adequado em vez de zero inventado"). */
function reachUnavailableLabel(snapshot: MetaAdsReachSnapshot): string {
  if (snapshot.status === "ok") return "—";
  switch (snapshot.reason) {
    case "not_configured":
      return "Integração direta Meta não configurada";
    case "token_missing":
      return "Credencial da Meta não configurada";
    case "timeout":
      return "A Meta não respondeu a tempo";
    case "fetch_error":
      return "Indisponível no momento";
  }
}

/** Rótulo dinâmico de "Resultados"/"Custo por resultado" por objetivo do
 * cliente (`PERFORMANCE_GOALS`) — mesma fonte usada pelo Cockpit
 * (`CockpitResultCard`/`CockpitCostCard`), nunca um segundo rótulo fixo.
 * Exportada: a Etapa 2.3 (`evolution-data.ts`) reaproveita pro seletor de
 * métrica do gráfico, nunca duplicando esta lógica. */
export function resolveResultLabels(resultType: PerformanceGoal | null): { resultLabel: string; costLabel: string } {
  return {
    resultLabel: resultType ? PERFORMANCE_GOALS[resultType].resultMetricLabel : "Resultados",
    costLabel: resultType ? PERFORMANCE_GOALS[resultType].costMetricShortLabel : "Custo por resultado",
  };
}

/**
 * Monta os 11 cards, na ordem canônica, a partir dos dados já buscados.
 * Pura — testável sem rede/banco, só com um `MetaAdsDashboardData` montado
 * à mão.
 */
export function buildMetricCardViewModels(data: MetaAdsDashboardData): MetricCardViewModel[] {
  const { comparison, reachComparison, resultType } = data;
  const current = comparison.current;
  const previous = comparison.previous;

  const { resultLabel, costLabel } = resolveResultLabels(resultType);

  const reachCurrent = reachComparison.current;
  const reachPrevious = reachComparison.previous;
  const previousFrequency = reachPrevious.status === "ok" ? reachPrevious.frequency : null;

  return [
    {
      id: "investment",
      label: "Investimento",
      value: formatCurrency(current.totals.spend),
      comparison: buildPercentChangeComparison(current.totals.spend, previous?.totals.spend ?? null, "neutral"),
    },
    {
      id: "results",
      label: resultLabel,
      value: current.hasAnyRecord ? formatCount(current.totals.resultCount) : "Sem dados no período",
      comparison: current.hasAnyRecord
        ? buildPercentChangeComparison(
            current.totals.resultCount,
            previous?.hasAnyRecord ? previous.totals.resultCount : null,
            "higher_is_better",
          )
        : null,
    },
    {
      id: "costPerResult",
      label: costLabel,
      value: current.derived.costPerResult !== null ? formatCurrency(current.derived.costPerResult) : "—",
      comparison:
        current.derived.costPerResult !== null
          ? buildPercentChangeComparison(current.derived.costPerResult, previous?.derived.costPerResult ?? null, "lower_is_better")
          : null,
    },
    {
      id: "impressions",
      label: "Impressões",
      value: formatCount(current.totals.impressions),
      comparison: buildPercentChangeComparison(current.totals.impressions, previous?.totals.impressions ?? null, "neutral"),
    },
    {
      id: "reach",
      label: "Alcance",
      value: reachCurrent.status === "ok" ? formatCount(reachCurrent.reach) : reachUnavailableLabel(reachCurrent),
      comparison:
        reachCurrent.status === "ok"
          ? buildPercentChangeComparison(reachCurrent.reach, reachPrevious.status === "ok" ? reachPrevious.reach : null, "neutral")
          : null,
    },
    {
      id: "frequency",
      label: "Frequência",
      value:
        reachCurrent.status === "ok"
          ? reachCurrent.frequency !== null
            ? formatRatio(reachCurrent.frequency)
            : "—"
          : reachUnavailableLabel(reachCurrent),
      comparison:
        reachCurrent.status === "ok" && reachCurrent.frequency !== null
          ? buildPercentChangeComparison(reachCurrent.frequency, previousFrequency, "neutral")
          : null,
    },
    {
      id: "clicks",
      label: "Cliques",
      value: formatCount(current.totals.clicks),
      comparison: buildPercentChangeComparison(current.totals.clicks, previous?.totals.clicks ?? null, "neutral"),
    },
    {
      id: "cpc",
      label: "CPC",
      value: current.derived.cpc !== null ? formatCurrency(current.derived.cpc) : "—",
      comparison:
        current.derived.cpc !== null
          ? buildPercentChangeComparison(current.derived.cpc, previous?.derived.cpc ?? null, "lower_is_better")
          : null,
    },
    {
      id: "ctr",
      label: "CTR",
      value: current.derived.ctr !== null ? formatPercent(current.derived.ctr * 100) : "—",
      comparison:
        current.derived.ctr !== null
          ? buildPercentChangeComparison(current.derived.ctr, previous?.derived.ctr ?? null, "higher_is_better")
          : null,
    },
    {
      id: "cpm",
      label: "CPM",
      value: current.derived.cpm !== null ? formatCurrency(current.derived.cpm) : "—",
      comparison:
        current.derived.cpm !== null
          ? buildPercentChangeComparison(current.derived.cpm, previous?.derived.cpm ?? null, "lower_is_better")
          : null,
    },
    {
      id: "roas",
      label: "ROAS",
      value: current.derived.roas !== null ? `${current.derived.roas.toFixed(2)}x` : "—",
      comparison:
        current.derived.roas !== null
          ? buildPercentChangeComparison(current.derived.roas, previous?.derived.roas ?? null, "higher_is_better")
          : null,
    },
  ];
}
