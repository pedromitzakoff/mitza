import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

/**
 * Núcleo puro da camada de PERFORMANCE (Etapa 71) — consome os valores
 * financeiros JÁ existentes (realizado, recomendação de sprint) pra
 * calcular custo por resultado; nunca cria uma fonte de verdade nova pra
 * investimento, nunca recalcula orçamento/saldo/recomendação. Investimento
 * entra aqui sempre como parâmetro já resolvido pelas funções centrais
 * financeiras (`sumActualSpendForMonth`, `computeSprintEffectiveSpend`
 * etc.), nunca recomputado.
 */

export type PerformanceSource = "manual" | "meta" | "google";

/** Uma linha de `performance_records` já buscada do banco — resultado de UM
 * canal, UM tipo, UM período. */
export interface PerformanceRecordRow {
  channel: TrafficChannel;
  resultType: PerformanceGoal;
  resultCount: number;
  source: PerformanceSource;
  sourceUpdatedAt: string;
}

export interface AggregatedPerformance {
  resultCount: number;
  /** `false` = nenhum registro de performance existe pro escopo pedido
   * (diferente de "existe registro, mas resultCount é 0" — Etapa 71, seção
   * 36/37: "sem dados" e "zero resultados registrados" são estados
   * diferentes, nunca confundidos). */
  hasAnyRecord: boolean;
  /** Fonte do registro mais recentemente atualizado no escopo — `null`
   * quando `hasAnyRecord` é `false`. */
  latestSource: PerformanceSource | null;
  /** `source_updated_at` mais recente no escopo — `null` quando
   * `hasAnyRecord` é `false`. */
  latestUpdatedAt: string | null;
}

/**
 * Soma os resultados de UM tipo (leads OU vendas — nunca os dois juntos),
 * opcionalmente restrito a UM canal. Etapa 71, seção 32: consolidação entre
 * canais é sempre SOMA de contagens, nunca média de custos — esta função só
 * lida com a soma de resultados; o custo consolidado (`computeCostPerResult`)
 * sempre divide o investimento consolidado pela soma daqui, nunca combina
 * custos já calculados por canal.
 */
export function aggregatePerformanceResults(
  records: PerformanceRecordRow[],
  resultType: PerformanceGoal,
  channel?: TrafficChannel,
): AggregatedPerformance {
  const relevant = records.filter((r) => r.resultType === resultType && (channel === undefined || r.channel === channel));

  if (relevant.length === 0) {
    return { resultCount: 0, hasAnyRecord: false, latestSource: null, latestUpdatedAt: null };
  }

  const resultCount = relevant.reduce((sum, r) => sum + r.resultCount, 0);
  const latest = relevant.reduce((latest, r) => (!latest || r.sourceUpdatedAt > latest.sourceUpdatedAt ? r : latest));

  return { resultCount, hasAnyRecord: true, latestSource: latest.source, latestUpdatedAt: latest.sourceUpdatedAt };
}

/**
 * Custo por resultado — SEMPRE derivado (Etapa 71, seção 12: nunca inserido
 * manualmente). `actualSpend` já vem calculado pela camada financeira
 * central pro MESMO escopo do resultado (seção 13 — "regra crítica: mesmo
 * escopo"); esta função nunca sabe de onde `actualSpend` veio, só garante
 * que a divisão nunca produz `0`/`NaN`/`Infinity`:
 *
 * - `actualSpend === null` (investimento indisponível pro escopo, ex.:
 *   canal sem investimento separado ainda) → `null`.
 * - `!hasAnyRecord` (nenhum dado de performance registrado) → `null`.
 * - `resultCount === 0` (dado registrado, mas zero resultados) → `null`
 *   (nunca `0`/`Infinity` — "custo por zero resultados" não é um número).
 * - Caso contrário → `actualSpend / resultCount`.
 */
export function computeCostPerResult(
  actualSpend: number | null,
  resultCount: number,
  hasAnyRecord: boolean,
): number | null {
  if (actualSpend === null) return null;
  if (!hasAnyRecord) return null;
  if (resultCount === 0) return null;
  return actualSpend / resultCount;
}

/** Por que `costPerResult` é `null` num escopo — pra interface escolher o
 * texto auxiliar certo (seção 16) sem duplicar a mesma cadeia de ifs em
 * cada componente. */
export type CostPerResultUnavailableReason =
  | "no_spend_for_scope"
  | "no_performance_data"
  | "zero_results"
  | "available";

export function getCostPerResultUnavailableReason(
  actualSpend: number | null,
  resultCount: number,
  hasAnyRecord: boolean,
): CostPerResultUnavailableReason {
  if (actualSpend === null) return "no_spend_for_scope";
  if (!hasAnyRecord) return "no_performance_data";
  if (resultCount === 0) return "zero_results";
  return "available";
}

/** Variação percentual do custo atual em relação à meta — negativa = custo
 * MENOR que a meta (melhor, já que em métricas de custo "menor é melhor").
 * `null` quando não há como comparar (custo ou meta indisponíveis, ou meta
 * inválida). */
export function computeVariationFromTarget(
  costPerResult: number | null,
  targetCostPerResult: number | null,
): number | null {
  if (costPerResult === null || targetCostPerResult === null || targetCostPerResult <= 0) return null;
  return (costPerResult - targetCostPerResult) / targetCostPerResult;
}

/** Margem de tolerância central pra "dentro da meta" — mesma ideia
 * conceitual de `SPEND_STATUS_MARGIN` (spend-status.ts), mas uma constante
 * PRÓPRIA da performance: os dois domínios (financeiro/performance) nunca
 * compartilham a mesma classificação (Etapa 71, seção 18 — "não confundir
 * status financeiro e performance"), então nunca importamos uma tolerância
 * da outra, mesmo que o valor numérico coincida hoje. */
export const PERFORMANCE_STATUS_MARGIN = 0.1; // ±10%

export type PerformanceStatus = "better" | "on_target" | "worse" | "not_available";

/**
 * Status semântico central de eficiência — nunca um threshold espalhado em
 * componente. "menor é melhor" pra métricas de custo: variação POSITIVA
 * (custo acima da meta) é `worse`; variação NEGATIVA (custo abaixo da meta)
 * é `better`; dentro da margem é `on_target`.
 */
export function getPerformanceStatus(costPerResult: number | null, targetCostPerResult: number | null): PerformanceStatus {
  const variation = computeVariationFromTarget(costPerResult, targetCostPerResult);
  if (variation === null) return "not_available";
  if (variation > PERFORMANCE_STATUS_MARGIN) return "worse";
  if (variation < -PERFORMANCE_STATUS_MARGIN) return "better";
  return "on_target";
}

/** Compara custo atual à meta e devolve os 3 dados que a interface precisa
 * juntos (variação, status, nunca recalculados separadamente em dois
 * lugares). */
export interface CostComparison {
  variation: number | null;
  status: PerformanceStatus;
}

export function compareCostToTarget(costPerResult: number | null, targetCostPerResult: number | null): CostComparison {
  return {
    variation: computeVariationFromTarget(costPerResult, targetCostPerResult),
    status: getPerformanceStatus(costPerResult, targetCostPerResult),
  };
}

/** Texto pronto da comparação ("25% acima da meta" / "16,7% melhor que a
 * meta" / "Dentro da meta" / null quando não há meta ou custo disponível)
 * — Etapa 71, seção 17, mesmos exemplos do pedido original. */
export function formatPerformanceComparisonText(
  comparison: CostComparison,
  formatPercentValue: (value: number) => string,
): string | null {
  if (comparison.status === "not_available" || comparison.variation === null) return null;
  if (comparison.status === "on_target") return "Dentro da meta";
  const absVariationPct = Math.abs(comparison.variation) * 100;
  if (comparison.status === "worse") return `${formatPercentValue(absVariationPct)} acima da meta`;
  return `${formatPercentValue(absVariationPct)} melhor que a meta`;
}

/** Escopo de investimento pra um cálculo de custo por resultado — Etapa 71,
 * seção 15: as funções já nasceram preparadas pra `channelScope`. Desde a
 * Etapa 2/3 (MVP plataformas) já existe uma fonte real de investimento por
 * canal (`lib/channel-spend.ts`, alimentada por `daily_spend.channel` +
 * `sprint_channel_spend`) — `channelActualSpend` é esse valor já resolvido
 * por quem chama. Nunca dividir o investimento consolidado pelos resultados
 * de um único canal: por isso, mesmo agora, um escopo não-consolidado sem
 * entrada correspondente em `channelActualSpend` (cliente sem essa
 * plataforma configurada/sem dado) continua devolvendo `null`, nunca um
 * fallback pro valor consolidado. */
export type PerformanceChannelScope = "consolidated" | TrafficChannel;

export function resolveActualSpendForScope(
  scope: PerformanceChannelScope,
  consolidatedActualSpend: number,
  channelActualSpend?: Partial<Record<TrafficChannel, number>>,
): number | null {
  if (scope === "consolidated") return consolidatedActualSpend;
  const value = channelActualSpend?.[scope];
  return value !== undefined ? value : null;
}

/** Resumo completo de performance de UM escopo (mês ou sprint, consolidado
 * ou por canal) — a estrutura que qualquer tela (Visão Geral, página do
 * cliente, card de sprint) consome pra exibir os 8 dados que o gestor
 * precisa responder (seção 0 do pedido: investido/resultados/custo/meta/
 * eficiência/atualização/fonte/canal). */
export interface PerformanceSummary {
  scope: PerformanceChannelScope;
  resultType: PerformanceGoal;
  resultCount: number;
  hasAnyRecord: boolean;
  actualSpend: number | null;
  costPerResult: number | null;
  costUnavailableReason: CostPerResultUnavailableReason;
  targetCostPerResult: number | null;
  comparison: CostComparison;
  latestSource: PerformanceSource | null;
  latestUpdatedAt: string | null;
}

export function computePerformanceSummary(input: {
  scope: PerformanceChannelScope;
  records: PerformanceRecordRow[];
  resultType: PerformanceGoal;
  consolidatedActualSpend: number;
  targetCostPerResult: number | null;
  /** Investimento já resolvido por canal (Etapa 2/3) — só relevante quando
   * `scope` não é `consolidated`; ausente/sem entrada = `null` (nunca usa o
   * consolidado como fallback). */
  channelActualSpend?: Partial<Record<TrafficChannel, number>>;
}): PerformanceSummary {
  const { scope, records, resultType, consolidatedActualSpend, targetCostPerResult, channelActualSpend } = input;
  const channel = scope === "consolidated" ? undefined : scope;
  const aggregated = aggregatePerformanceResults(records, resultType, channel);
  const actualSpend = resolveActualSpendForScope(scope, consolidatedActualSpend, channelActualSpend);
  const costPerResult = computeCostPerResult(actualSpend, aggregated.resultCount, aggregated.hasAnyRecord);
  const costUnavailableReason = getCostPerResultUnavailableReason(actualSpend, aggregated.resultCount, aggregated.hasAnyRecord);
  const comparison = compareCostToTarget(costPerResult, targetCostPerResult);

  return {
    scope,
    resultType,
    resultCount: aggregated.resultCount,
    hasAnyRecord: aggregated.hasAnyRecord,
    actualSpend,
    costPerResult,
    costUnavailableReason,
    targetCostPerResult,
    comparison,
    latestSource: aggregated.latestSource,
    latestUpdatedAt: aggregated.latestUpdatedAt,
  };
}

/** Texto da última atualização — mesmo espírito de `describeSpendSourceTimestamp`
 * (sprint-financials.ts), nunca `created_at` como fallback de "atualizado
 * em" e nunca a data de hoje como valor fictício (Etapa 71, seção 10). */
export function getLatestPerformanceUpdateText(
  latestSource: PerformanceSource | null,
  latestUpdatedAt: string | null,
  formatShortDateTime: (value: string) => string,
): string {
  if (!latestSource || !latestUpdatedAt) return "Sem atualização registrada";
  if (latestSource === "manual") return `Manual · Atualizado em ${formatShortDateTime(latestUpdatedAt)}`;
  const label = latestSource === "meta" ? "Meta" : "Google";
  return `${label} · Sincronizado em ${formatShortDateTime(latestUpdatedAt)}`;
}

/** Formata um valor monetário de custo por resultado, ou "—" quando
 * indisponível — nunca "R$ 0"/"Infinity"/"NaN" (Etapa 71, seção 16). */
export function formatCostMetric(costPerResult: number | null, formatCurrencyValue: (value: number) => string): string {
  return costPerResult !== null ? formatCurrencyValue(costPerResult) : "—";
}

/**
 * Estado completo de performance de UMA sprint pra interface — os 4 estados
 * do pedido nunca são confundidos entre si (seção 25/36/37):
 * - `not_configured`: cliente sem `performance_goal` (interface mostra
 *   "Objetivo de performance não configurado").
 * - `not_started`: sprint futura — nunca mostra "0 leads"/projeção nenhuma.
 * - `no_data`: objetivo configurado, sprint já começou, mas nenhum registro
 *   existe ainda pro tipo de resultado atual do cliente.
 * - `has_data`: existe pelo menos 1 registro (inclui o caso "0 resultados
 *   registrados explicitamente", que o próprio `summary.hasAnyRecord`/
 *   `resultCount` já distingue de `no_data`).
 */
export type SprintPerformanceView =
  | { kind: "not_configured" }
  | { kind: "not_started" }
  | { kind: "no_data"; goal: PerformanceGoal }
  | { kind: "has_data"; goal: PerformanceGoal; summary: PerformanceSummary };

export function buildSprintPerformanceView(input: {
  performanceGoal: PerformanceGoal | null;
  isFuture: boolean;
  records: PerformanceRecordRow[];
  actualSpend: number;
  targetCostPerResult: number | null;
}): SprintPerformanceView {
  const { performanceGoal, isFuture, records, actualSpend, targetCostPerResult } = input;
  if (!performanceGoal) return { kind: "not_configured" };
  if (isFuture) return { kind: "not_started" };

  const summary = computePerformanceSummary({
    scope: "consolidated",
    records,
    resultType: performanceGoal,
    consolidatedActualSpend: actualSpend,
    targetCostPerResult,
  });

  if (!summary.hasAnyRecord) return { kind: "no_data", goal: performanceGoal };
  return { kind: "has_data", goal: performanceGoal, summary };
}

/** Valor já lançado de cada canal SELECIONÁVEL, pro tipo de resultado atual
 * do cliente — pré-preenche o formulário de "Editar resultados" (seção 28)
 * sem duplicar a lógica de busca em cada tela que precisar dele. `null` =
 * canal nunca teve um lançamento pra esta sprint (input nasce vazio, nunca
 * "0" fabricado). */
export function buildEditableChannelValues(
  records: PerformanceRecordRow[],
  resultType: PerformanceGoal,
  channels: TrafficChannel[],
): { channel: TrafficChannel; existingCount: number | null }[] {
  return channels.map((channel) => {
    const match = records.find((r) => r.channel === channel && r.resultType === resultType);
    return { channel, existingCount: match ? match.resultCount : null };
  });
}

/** Os 3 textos prontos de "Principais KPIs do mês" (Etapa 72) — central pra
 * nunca duplicar esta lógica entre o card do Acompanhamento da Conta e
 * qualquer outro lugar que precise do mesmo resumo compacto. Nunca formata
 * o investimento (esse número já vem pronto de `formatCurrencyValue`
 * direto no componente — aqui só resultado/custo, que dependem do
 * objetivo/registro). */
export interface MonthlyKpiTexts {
  resultsValue: string;
  resultsAuxiliary: string | null;
  costValue: string;
}

export function deriveMonthlyKpiTexts(
  performanceGoal: PerformanceGoal | null,
  summary: PerformanceSummary | null,
  formatCurrencyValue: (value: number) => string,
): MonthlyKpiTexts {
  if (!performanceGoal || !summary) {
    return { resultsValue: "—", resultsAuxiliary: "Objetivo não configurado", costValue: "—" };
  }
  if (!summary.hasAnyRecord) {
    return { resultsValue: "—", resultsAuxiliary: "Sem dados registrados", costValue: "—" };
  }

  const resultsValue = formatPerformanceResult(summary.resultCount, performanceGoal);
  const resultsAuxiliary = summary.resultCount === 0 ? "Nenhum resultado gerado no período" : null;
  const costValue =
    summary.costPerResult !== null
      ? `${PERFORMANCE_GOALS[performanceGoal].costMetricShortLabel} ${formatCurrencyValue(summary.costPerResult)}`
      : "—";

  return { resultsValue, resultsAuxiliary, costValue };
}
