import type { PerformanceGoal } from "./performance-goals";
import type { ChartMetricUnit, ChartSeriesPoint } from "./meta-ads-dashboard/evolution-data";
import type { CockpitDailyEvolutionPoint } from "./cockpit-daily-evolution";

/**
 * KOFF Analytics — Redesign definitivo do Cockpit: "Evolução da performance"
 * passa a ser UM módulo só, em vez de dois gráficos separados (Evolução
 * Diária, SVG artesanal, por objetivo; Evolução Meta Ads, Recharts, métricas
 * de mídia). Este arquivo é só a PONTE de dados — nenhum cálculo novo, nunca
 * uma segunda fórmula: `buildGoalEvolutionSeries` converte os MESMOS pontos
 * já calculados por `buildCockpitDailyEvolutionPoints` (`cockpit-daily-evolution.ts`)
 * pro formato genérico (`EvolutionSeriesOption`) que o gráfico Recharts já
 * usado pela Evolução Meta Ads (`buildEvolutionSeries`,
 * `meta-ads-dashboard/evolution-data.ts`) consome — as duas listas são só
 * concatenadas por quem monta a página, nunca misturadas aqui.
 *
 * `state !== "result"` (dia futuro ou sem dado) sempre vira `null` — mesmo
 * "vão real na linha, nunca interpolado" que o gráfico SVG antigo já
 * respeitava (`buildNormalizedLineSegments`); o Recharts (`connectNulls={false}`
 * no componente) preserva exatamente o mesmo comportamento visual.
 */

export interface EvolutionSeriesOption {
  id: string;
  label: string;
  unit: ChartMetricUnit;
  current: ChartSeriesPoint[];
}

interface GoalDailySeriesInput {
  resultType: PerformanceGoal;
  resultLabel: string;
  costLabel: string;
  channelsLabel: string | null;
  points: CockpitDailyEvolutionPoint[];
}

function pointsToSeries(points: CockpitDailyEvolutionPoint[], pick: (point: CockpitDailyEvolutionPoint) => number | null): ChartSeriesPoint[] {
  return points.map((point) => ({ date: point.date, value: point.state === "result" ? pick(point) : null }));
}

/**
 * Um objetivo vira 3 opções selecionáveis (Resultado/Custo por
 * resultado/Investimento) — mesma composição que o card "Meta & Ritmo" já
 * mostra pro mês inteiro, aqui dia a dia. `channelsLabel` (ex.: "Meta +
 * Google") entra no rótulo pra nunca confundir com as métricas Meta-only
 * do Ads abaixo, quando as duas listas convivem no mesmo seletor.
 */
/** KOFF Analytics — "Filtro global de performance": resolve o default de
 * cada lado do seletor (esquerda = resultados, direita = investimento,
 * pedido explícito do usuário) a partir de uma lista de IDs preferidos em
 * ORDEM — o primeiro que existir na lista de séries disponíveis ganha,
 * nunca um id fixo que pode não existir pra este cliente/escopo (ex.: sem
 * filtro ativo, a série por objetivo `goal:${resultType}:result` é
 * preferida; com o filtro ativo, essa série não entra na lista por não ser
 * recalculável por campanha — cai pra `"results"`, a série Meta
 * equivalente, já corretamente filtrada por vir de `campaign_daily_metrics`
 * já filtrado). Cai pro primeiro id disponível quando nenhum preferido
 * existe — nunca uma string fixa que pode não bater com nenhuma série
 * (ex.: cliente sem nenhuma integração habilitada). */
export function resolveDefaultEvolutionSeriesId(series: EvolutionSeriesOption[], preferredIds: string[]): string {
  for (const id of preferredIds) {
    if (series.some((option) => option.id === id)) return id;
  }
  return series[0]?.id ?? "";
}

export function buildGoalEvolutionSeries(dailySeries: GoalDailySeriesInput[]): EvolutionSeriesOption[] {
  const options: EvolutionSeriesOption[] = [];
  for (const series of dailySeries) {
    const suffix = series.channelsLabel ? ` · ${series.channelsLabel}` : "";
    options.push({
      id: `goal:${series.resultType}:result`,
      label: `${series.resultLabel}${suffix}`,
      unit: "count",
      current: pointsToSeries(series.points, (p) => p.resultCount),
    });
    options.push({
      id: `goal:${series.resultType}:cost`,
      label: `${series.costLabel}${suffix}`,
      unit: "currency",
      current: pointsToSeries(series.points, (p) => p.costPerResult),
    });
    options.push({
      id: `goal:${series.resultType}:investment`,
      label: `Investimento${suffix}`,
      unit: "currency",
      current: pointsToSeries(series.points, (p) => p.spend),
    });
  }
  return options;
}
