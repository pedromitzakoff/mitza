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

/** Uma linha de `performance_records`/`daily_performance` já buscada do
 * banco — resultado de UM canal, UM tipo, UM período. `revenue` só é
 * populado quando a linha vier de `daily_performance` de um cliente com
 * objetivo de vendas E `metric_mappings.value_column` configurado — `null`
 * em qualquer outro caso (leads/seguidores, ou fluxo manual, que não tem
 * essa coluna). */
export interface PerformanceRecordRow {
  channel: TrafficChannel;
  resultType: PerformanceGoal;
  resultCount: number;
  /** Opcional: omitido (nunca `undefined` explícito é exigido) por toda
   * linha que não vem de `daily_performance` de um cliente com receita
   * configurada — tratado exatamente igual a `null` por
   * `aggregatePerformanceResults` (nenhuma contribuição de faturamento). */
  revenue?: number | null;
  source: PerformanceSource;
  sourceUpdatedAt: string;
}

export interface AggregatedPerformance {
  resultCount: number;
  /** Soma de `revenue` das linhas do escopo — `null` quando nenhuma linha
   * relevante tiver `revenue` (nunca fabrica `0`: "sem faturamento
   * registrado" é um estado diferente de "faturou zero"). */
  revenue: number | null;
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
    return { resultCount: 0, revenue: null, hasAnyRecord: false, latestSource: null, latestUpdatedAt: null };
  }

  const resultCount = relevant.reduce((sum, r) => sum + r.resultCount, 0);
  const revenueRows = relevant.filter((r) => r.revenue !== null && r.revenue !== undefined);
  const revenue = revenueRows.length > 0 ? revenueRows.reduce((sum, r) => sum + (r.revenue ?? 0), 0) : null;
  const latest = relevant.reduce((latest, r) => (!latest || r.sourceUpdatedAt > latest.sourceUpdatedAt ? r : latest));

  return { resultCount, revenue, hasAnyRecord: true, latestSource: latest.source, latestUpdatedAt: latest.sourceUpdatedAt };
}

/** Divisão seguindo a mesma régua de segurança usada por qualquer indicador
 * derivado da MITZA (CPA, CPL, ROAS, Ticket Médio, e qualquer futuro): nunca
 * `NaN`/`Infinity`, nunca divide por zero, `null` quando faltar qualquer um
 * dos dois lados. Único lugar que decide "o que é uma divisão segura" —
 * toda métrica derivada chama esta função em vez de reimplementar a mesma
 * checagem. */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Custo por resultado — SEMPRE derivado (Etapa 71, seção 12: nunca inserido
 * manualmente). `actualSpend` já vem calculado pela camada financeira
 * central pro MESMO escopo do resultado (seção 13 — "regra crítica: mesmo
 * escopo"); esta função nunca sabe de onde `actualSpend` veio, só garante
 * que a divisão nunca produz `0`/`NaN`/`Infinity`:
 *
 * - `actualSpend === null` (investimento indisponível pro escopo, ex.:
 *   canal sem investimento separado ainda) → `null` (via `safeDivide`).
 * - `!hasAnyRecord` (nenhum dado de performance registrado) → `null`.
 * - `resultCount === 0` (dado registrado, mas zero resultados) → `null`
 *   (via `safeDivide` — nunca `0`/`Infinity`, "custo por zero resultados"
 *   não é um número).
 * - Caso contrário → `actualSpend / resultCount`.
 */
export function computeCostPerResult(
  actualSpend: number | null,
  resultCount: number,
  hasAnyRecord: boolean,
): number | null {
  if (!hasAnyRecord) return null;
  return safeDivide(actualSpend, resultCount);
}

/** ROAS (Return on Ad Spend) — receita ÷ investimento. `null` quando não há
 * receita registrada pro escopo (objetivo não é vendas, ou sem
 * `value_column` configurado) ou investimento indisponível — nunca `0`
 * fabricado. */
export function computeRoas(revenue: number | null, actualSpend: number | null): number | null {
  return safeDivide(revenue, actualSpend);
}

/** Ticket médio — receita ÷ vendas. `null` quando não há receita ou zero
 * vendas no escopo. */
export function computeAverageTicket(revenue: number | null, resultCount: number): number | null {
  return safeDivide(revenue, resultCount);
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

/**
 * MVP "Regras centrais de saúde da conta" — limiar de ENTRADA em prioridade
 * por custo por resultado: só custo 30%+ acima da meta vira alerta
 * acionável ("CPA 38% acima da meta"). Deliberadamente uma constante
 * PRÓPRIA, distinta de `PERFORMANCE_STATUS_MARGIN` (±10%, "dentro da
 * meta"/`getPerformanceStatus` — usada pra classificar/exibir eficiência em
 * qualquer tela): os dois domínios respondem perguntas diferentes ("esse
 * custo está bom?" vs. "isso precisa virar uma ação hoje?") e nunca devem
 * compartilhar o mesmo número, mesmo que hoje pareçam relacionados.
 */
export const COST_PRIORITY_DEVIATION_THRESHOLD = 0.3; // 30%

/**
 * Esta conta deve entrar na fila de prioridades por custo por resultado?
 * `false` sempre que não há como calcular com confiança: sem meta
 * configurada, sem custo disponível pro escopo, ou (quando
 * `minReliableResultCount` for passado) amostra insuficiente — nunca
 * classifica "acima da meta" sem uma base de comparação real.
 *
 * `minReliableResultCount` é um HOOK, não uma regra: auditoria desta etapa
 * confirmou que o sistema ainda não tem nenhum critério de "amostra mínima
 * pra um CPL/CPA confiável" em lugar nenhum (nada equivalente a
 * `SPEND_STATUS_MARGIN` pra tamanho de amostra) — por isso esta função
 * nunca inventa um número fixo (tipo "mínimo de 5 leads") por conta própria.
 * O parâmetro existe pra centralizar ONDE esse critério entraria no dia em
 * que a agência decidir um valor real (viraria, por exemplo, uma
 * configuração por cliente ou por objetivo) — até lá, omitir o parâmetro
 * (padrão `undefined`) preserva o comportamento atual: qualquer
 * `resultCount > 0` já é considerado suficiente (mesma régua de
 * `hasAnyRecord`/`resultCount === 0` já usada por `computeCostPerResult`).
 */
export function isCostAboveTargetPriority(
  costPerResult: number | null,
  targetCostPerResult: number | null,
  resultCount: number,
  minReliableResultCount?: number,
): boolean {
  if (minReliableResultCount !== undefined && resultCount < minReliableResultCount) return false;
  const variation = computeVariationFromTarget(costPerResult, targetCostPerResult);
  if (variation === null) return false;
  return variation > COST_PRIORITY_DEVIATION_THRESHOLD;
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
  /** Faturamento/ROAS/Ticket Médio — todos `null` quando o escopo não tem
   * `revenue` registrado (objetivo não é vendas, ou sem `value_column`
   * configurado no mapeamento) — nunca calculado a partir de um objetivo
   * diferente de vendas, nunca precisa de checagem `goal === 'sales'`
   * explícita em nenhum consumidor: a ausência de `revenue` já resolve isso
   * sozinha. */
  revenue: number | null;
  roas: number | null;
  averageTicket: number | null;
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
  const roas = computeRoas(aggregated.revenue, actualSpend);
  const averageTicket = computeAverageTicket(aggregated.revenue, aggregated.resultCount);

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
    revenue: aggregated.revenue,
    roas,
    averageTicket,
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
