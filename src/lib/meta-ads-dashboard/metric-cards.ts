import { buildPercentChangeComparison, type AnalyticsKpiComparison } from "@/lib/analytics";
import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { MetaAdsDashboardData, MetaAdsReachSnapshot } from "./dashboard-data";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.2 (Cards de KPI configuráveis),
 * estendida na Etapa 2.4 (cliques no link/CTR do link/CPC do link). Núcleo
 * puro: recebe o `MetaAdsDashboardData` já montado (Camada 1) e devolve os
 * 14 cards prontos pra exibição (valor já formatado + variação já
 * calculada) — nenhum componente de tela recalcula nada, só apresenta.
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
  | "linkClicks"
  | "cpc"
  | "linkCpc"
  | "ctr"
  | "linkCtr"
  | "cpm"
  | "roas";

/** Ordem canônica de apresentação — a mesma ordem usada na lista de
 * personalização e como ordem inicial dos cards selecionados. Agrupada por
 * categoria (Entrega/Tráfego/Receita): Entrega (impressões/alcance/
 * frequência/CPM) → Tráfego (cliques e suas variantes de LINK, sempre o par
 * "geral" antes do par "do link") → Receita.
 *
 * KOFF Analytics — Redesign definitivo do Cockpit: "investment"/"results"/
 * "costPerResult" SAÍRAM desta lista (removidos, não só escondidos do
 * padrão) — a nova "Visão executiva" sempre mostra Investimento/Resultado/
 * Custo por resultado consolidados (`cockpit-goal-card.tsx`) bem ao lado
 * destes cards, na MESMA área da tela; oferecê-los de novo aqui via
 * personalização seria a duplicação exata que o redesign pediu pra
 * eliminar. `buildMetricCardViewModels` continua calculando os 3 (histórico
 * preservado pra quem ainda lê esse view-model em outro lugar), só a UI de
 * seleção não os oferece mais. */
export const ALL_METRIC_CARD_IDS: MetricCardId[] = [
  "impressions",
  "reach",
  "frequency",
  "cpm",
  "clicks",
  "linkClicks",
  "ctr",
  "linkCtr",
  "cpc",
  "linkCpc",
  "roas",
];

/** Seleção inicial (~6 métricas principais) — cobre Entrega+Tráfego+Receita
 * sem repetir nada, todos degradam pra "—" quando indisponíveis (nunca a
 * mensagem longa de indisponibilidade de integração). Alcance/Frequência/
 * Cliques no link/CTR do link/CPC do link ficam de fora do padrão: dependem
 * da integração direta Meta ou de uma migração recente, podem chegar
 * "indisponível" — melhor como opção explícita de personalização do que
 * forçados na primeira experiência. */
export const DEFAULT_SELECTED_METRIC_IDS: MetricCardId[] = ["impressions", "cpm", "clicks", "ctr", "cpc", "roas"];

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

/** Texto do card quando cliques no link/CTR do link/CPC do link não têm
 * dado disponível — SEMPRE por limitação de histórico (coluna nova, Etapa
 * 2.4: dias sincronizados antes dela nunca têm esse campo) ou fonte sem o
 * campo configurado (todo Stract hoje), nunca indisponibilidade de API —
 * motivo DIFERENTE do de alcance/frequência, por isso mensagem própria. */
const LINK_METRIC_UNAVAILABLE_LABEL = "Sem dado de cliques no link neste período";

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
 * Monta os 14 cards, na ordem canônica, a partir dos dados já buscados.
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
      id: "cpm",
      label: "CPM",
      value: current.derived.cpm !== null ? formatCurrency(current.derived.cpm) : "—",
      comparison:
        current.derived.cpm !== null
          ? buildPercentChangeComparison(current.derived.cpm, previous?.derived.cpm ?? null, "lower_is_better")
          : null,
    },
    {
      id: "clicks",
      label: "Cliques totais",
      value: formatCount(current.totals.clicks),
      comparison: buildPercentChangeComparison(current.totals.clicks, previous?.totals.clicks ?? null, "neutral"),
    },
    {
      id: "linkClicks",
      label: "Cliques no link",
      value: current.totals.linkClicks !== null ? formatCount(current.totals.linkClicks) : LINK_METRIC_UNAVAILABLE_LABEL,
      comparison:
        current.totals.linkClicks !== null
          ? buildPercentChangeComparison(current.totals.linkClicks, previous?.totals.linkClicks ?? null, "neutral")
          : null,
    },
    {
      id: "ctr",
      label: "CTR geral",
      value: current.derived.ctr !== null ? formatPercent(current.derived.ctr * 100) : "—",
      comparison:
        current.derived.ctr !== null
          ? buildPercentChangeComparison(current.derived.ctr, previous?.derived.ctr ?? null, "higher_is_better")
          : null,
    },
    {
      id: "linkCtr",
      label: "CTR do link",
      value: current.derived.linkCtr !== null ? formatPercent(current.derived.linkCtr * 100) : LINK_METRIC_UNAVAILABLE_LABEL,
      comparison:
        current.derived.linkCtr !== null
          ? buildPercentChangeComparison(current.derived.linkCtr, previous?.derived.linkCtr ?? null, "higher_is_better")
          : null,
    },
    {
      id: "cpc",
      label: "CPC geral",
      value: current.derived.cpc !== null ? formatCurrency(current.derived.cpc) : "—",
      comparison:
        current.derived.cpc !== null
          ? buildPercentChangeComparison(current.derived.cpc, previous?.derived.cpc ?? null, "lower_is_better")
          : null,
    },
    {
      id: "linkCpc",
      label: "CPC do link",
      value: current.derived.linkCpc !== null ? formatCurrency(current.derived.linkCpc) : LINK_METRIC_UNAVAILABLE_LABEL,
      comparison:
        current.derived.linkCpc !== null
          ? buildPercentChangeComparison(current.derived.linkCpc, previous?.derived.linkCpc ?? null, "lower_is_better")
          : null,
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
