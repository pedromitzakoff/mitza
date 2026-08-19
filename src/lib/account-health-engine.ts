import { computeRelativeDeviation } from "@/lib/spend-status";
import { computeVariationFromTarget } from "@/lib/performance";
import { businessDaysSince } from "@/lib/business-days";
import {
  COST_DEVIATION_GRAVE,
  COST_DEVIATION_LEVE,
  COST_DEVIATION_RELEVANTE,
  MIN_RELIABLE_RESULT_COUNT,
  INVESTMENT_DEVIATION_GRAVE,
  INVESTMENT_DEVIATION_LEVE,
  INVESTMENT_DEVIATION_RELEVANTE,
  RESULT_DEVIATION_GRAVE,
  RESULT_DEVIATION_LEVE,
  RESULT_DEVIATION_RELEVANTE,
  REVIEW_OVERDUE_GRAVE,
  REVIEW_OVERDUE_LEVE,
  REVIEW_OVERDUE_RELEVANTE,
  DEFAULT_REVIEW_MAX_BUSINESS_DAYS,
} from "@/lib/operation-health-thresholds";

/**
 * Motor de Saúde da Conta — substitui inteiramente o score ponderado
 * provisório de `operation-triage.ts` (Etapa "Operação 1.0"). Função pura,
 * sem Supabase: recebe tudo já resolvido pela camada de dados
 * (`operation-triage-data.ts`) — planejamento mensal
 * (`resolveMonthlyPlanSnapshot`), realizado, cadência de revisão — e nunca
 * decide sozinho de onde um número vem.
 *
 * Filosofia (aprovada): a saúde geral NUNCA é uma soma/média ponderada de
 * sinais — é sempre a PIOR dimensão entre as cinco avaliadas. Cada
 * dimensão calcula sua própria severidade contra os limiares centrais de
 * `operation-health-thresholds.ts`; a UI nunca recalcula nada, só
 * renderiza o resultado já pronto.
 *
 * As cinco dimensões de hoje (investimento/resultado/custo/revisão/
 * qualidade dos dados) não são as únicas que este motor um dia vai ter —
 * o nome "account-health" (não "operation-deviation") é deliberado: outras
 * dimensões (tarefas, integrações, IA) podem entrar depois sem quebrar a
 * forma do objeto devolvido.
 */

export type DimensionSeverity = "nenhum" | "leve" | "relevante" | "grave";

export type HealthStatus = "saudavel" | "em_acompanhamento" | "em_risco" | "acao_necessaria";

/** Peso de comparação entre severidades — exportado (Etapa "Redesenho da
 * Operação") pra quem ordena clientes fora deste arquivo (ex.: desempate
 * "severidade da dimensão principal" na lista da Operação) nunca duplicar
 * este mapeamento; usado aqui pra achar a pior severidade e, em empate,
 * resolver a ordem de prioridade. */
export const DIMENSION_SEVERITY_RANK: Record<DimensionSeverity, number> = { nenhum: 0, leve: 1, relevante: 2, grave: 3 };

const HEALTH_STATUS_BY_SEVERITY: Record<DimensionSeverity, HealthStatus> = {
  nenhum: "saudavel",
  leve: "em_acompanhamento",
  relevante: "em_risco",
  grave: "acao_necessaria",
};

/** Mapeamento FIXO status → número — nunca uma média/soma de sinais
 * (aprovado explicitamente: "não quero score ponderado"). Existe só pra
 * telas que precisem de um valor numérico pra ordenar/exibir (ex.: uma
 * futura visualização compacta) sem reintroduzir heurística nenhuma — é
 * puramente decorativo, nunca entra em nenhum cálculo deste motor. */
const HEALTH_SCORE_BY_STATUS: Record<HealthStatus, number> = {
  saudavel: 100,
  em_acompanhamento: 75,
  em_risco: 50,
  acao_necessaria: 25,
};

function severityFromAbsoluteDeviation(
  deviation: number | null,
  leve: number,
  relevante: number,
  grave: number,
): DimensionSeverity {
  if (deviation === null) return "nenhum";
  const magnitude = Math.abs(deviation);
  if (magnitude > grave) return "grave";
  if (magnitude > relevante) return "relevante";
  if (magnitude > leve) return "leve";
  return "nenhum";
}

/** Severidade "de um lado só": só o desvio na direção ruim conta (ex.:
 * resultado abaixo do esperado, custo acima da meta) — a direção oposta
 * nunca é penalizada. */
function severityFromOneSidedDeviation(
  deviation: number | null,
  badDirection: "positive" | "negative",
  leve: number,
  relevante: number,
  grave: number,
): DimensionSeverity {
  if (deviation === null) return "nenhum";
  const isBad = badDirection === "positive" ? deviation > 0 : deviation < 0;
  if (!isBad) return "nenhum";
  return severityFromAbsoluteDeviation(deviation, leve, relevante, grave);
}

export interface InvestmentDimension {
  status: DimensionSeverity;
  deviation: number | null;
  actual: number;
  planned: number | null;
  expected: number | null;
  /** `false` quando não existe NENHUMA linha de `daily_spend` pro cliente
   * neste mês (mesmo flag de `AccountHealthInput.investmentHasSyncedData`,
   * só exposto aqui também) — distingue pra UI "Planejamento não definido"
   * (`planned === null`) de "Sem dados de investimento" (`!hasSyncedData`):
   * são dois estados de ausência diferentes, podem ocorrer juntos ou
   * isolados, nenhum dos dois nunca é inferido de `actual === 0`. */
  hasSyncedData: boolean;
}

export interface ResultDimension {
  status: DimensionSeverity;
  deviation: number | null;
  actual: number;
  planned: number | null;
  expected: number | null;
  hasPerformanceData: boolean;
}

export interface CostDimension {
  status: DimensionSeverity;
  deviation: number | null;
  actual: number | null;
  planned: number | null;
  expected: number | null;
  /** Quantidade de resultados que sustentam `actual` (mesma contagem de
   * `resultActual` do input) — guardada aqui pra `describeCostReason`
   * compor a mensagem de amostra insuficiente sem precisar de um segundo
   * parâmetro. */
  sampleSize: number;
  /** `false` = amostra menor que `MIN_RELIABLE_RESULT_COUNT` — nesse caso
   * `status` fica travado em "nenhum": ausência de evidência nunca é
   * tratada como desempenho ruim (aprovado explicitamente — "não quero
   * avaliar custo quando ainda não existe volume suficiente de
   * resultados"). O motivo ainda é comunicado ao gestor via
   * `describeCostReason`, só não conta como severidade. */
  hasReliableSample: boolean;
  /** `false` = o conjunto de canais do planejamento (`costPlanned`) diverge
   * do conjunto de canais do realizado (`costActual`) — Auditoria de
   * Comparabilidade de Escopo de Custo: comparar os dois consolidados como
   * desvio da meta, nesse caso, mistura universos diferentes (ex.: só Meta
   * tem plano, mas Google também investiu/performou este mês). `status`
   * fica travado em "nenhum", mesmo padrão de `hasReliableSample` — não é
   * falta de amostra, é falta de uma base COMPARÁVEL. `true` sempre que
   * `costPlanned` vem do fallback global (`clients.target_cost_per_result`,
   * nunca escopado a canal nenhum) ou quando os dois conjuntos batem —
   * calculado fora deste arquivo (`resolveChannelScopeComparison`,
   * channel-metrics.ts), o motor nunca decide sozinho quais canais
   * existem. */
  hasComparableScope: boolean;
}

export interface ReviewDimension {
  status: DimensionSeverity;
  deviation: number | null;
  actual: number | null;
  planned: number;
  expected: number;
  /** `false` = cadência desativada (`account_review_cadences.is_active =
   * false`) — a dimensão simplesmente não participa (não é saudável, não é
   * ruim, não existe pra este cliente). `planned`/`expected` ficam em `0`
   * só como valor de preenchimento nesse caso; a UI nunca deve lê-los sem
   * checar `enabled` primeiro. */
  enabled: boolean;
}

export interface DataQualityDimension {
  status: DimensionSeverity;
  issues: string[];
}

export interface AccountHealthEvaluation {
  healthStatus: HealthStatus;
  /** Decorativo — ver `HEALTH_SCORE_BY_STATUS`. Nunca usado por este
   * arquivo pra decidir `healthStatus` (é o inverso: deriva DELE). */
  healthScore: number;
  /** Auditoria de Frescor/Confiabilidade de Dados — repasse cru de
   * `AccountHealthInput.lastDataSyncAt`, nunca recalculado aqui. Deliberadamente
   * NÃO é uma dimensão (não participa de `DIMENSION_PRIORITY_ORDER`, não tem
   * `status`/severidade própria, não influencia `healthStatus`/`primaryReason`
   * de forma nenhuma) — a auditoria encontrou o fato (o timestamp já existe,
   * já calculado em `client-operational-state-data.ts`) mas nenhuma regra
   * oficial de frescor pro Motor de Saúde ainda foi decidida. Expor aqui é só
   * o primeiro passo (menor intervenção segura): tornar o fato acessível a
   * quem consome `AccountHealthEvaluation`, sem inventar severidade no
   * escuro. `null` = nenhum dado de investimento OU performance sincronizado
   * ainda pro cliente/mês (mesmo significado de `lastDataSyncAt` em
   * `ClientOperationalState`). */
  lastDataSyncAt: string | null;
  primaryReason: string;
  /** Chave de `dimensions` que originou `primaryReason` — `null` só quando
   * `healthStatus === "saudavel"` (nenhuma dimensão tem motivo pra ser
   * "principal" quando não há nenhum sinal). Exposta (Etapa "Redesenho da
   * Operação") pra quem consome o motivo estruturado (filtro por dimensão,
   * desempate de ordenação) nunca precisar dar parse no texto de
   * `primaryReason`. */
  primaryDimension: keyof AccountHealthEvaluation["dimensions"] | null;
  dimensions: {
    investment: InvestmentDimension;
    results: ResultDimension;
    cost: CostDimension;
    review: ReviewDimension;
    dataQuality: DataQualityDimension;
  };
}

/**
 * Ordem de prioridade em caso de empate de severidade entre dimensões
 * (aprovada): qualidade dos dados > custo > resultado > investimento >
 * revisão — "sem dados confiáveis não existe operação", depois eficiência,
 * depois volume, depois orçamento, depois rotina. Fonte única — tanto
 * `evaluateAccountHealth` (decide `primaryReason`/`primaryDimension`) quanto
 * `collectAccountHealthReasons` (lista completa) quanto quem ordena a fila
 * da Operação por fora deste arquivo usam exatamente este array, nunca uma
 * cópia paralela.
 */
export const DIMENSION_PRIORITY_ORDER: (keyof AccountHealthEvaluation["dimensions"])[] = [
  "dataQuality",
  "cost",
  "results",
  "investment",
  "review",
];

export interface AccountHealthInput {
  /** Investido no mês até hoje (soma real de `daily_spend`). */
  investmentActual: number;
  /** Orçamento mensal vigente (`resolveMonthlyPlanSnapshot`) — `null` = sem
   * planejamento definido pra este cliente/mês (vira issue de qualidade dos
   * dados, nunca um desvio de investimento). */
  investmentPlanned: number | null;
  /** `false` quando não existe NENHUMA linha de `daily_spend` pro cliente
   * neste mês — distingue "ainda não sincronizou" de "sincronizou e o
   * investimento real é zero" (só o segundo caso é um valor legítimo). */
  investmentHasSyncedData: boolean;

  /** Resultado do mês (soma de `performance_records` do tipo que bate com
   * `performanceGoal` do cliente). */
  resultActual: number;
  /** Meta de quantidade vigente (`resolveMonthlyPlanSnapshot`) — `null` =
   * sem meta definida. */
  resultPlanned: number | null;
  /** `false` = nenhum registro de performance existe pro escopo (distinto
   * de "existe registro, resultActual é 0"). */
  hasPerformanceData: boolean;
  /** `false` = cliente sem `performance_goal` configurado — dimensão de
   * resultado/custo não pode ser avaliada, vira issue de qualidade. */
  performanceGoalConfigured: boolean;

  /** Custo por resultado do mês, já dividido (`computeCostPerResult`) —
   * `null` quando não há como calcular (sem spend ou sem resultado). */
  costActual: number | null;
  /** Meta de custo vigente, já com fallback pro campo permanente aplicado
   * (`resolveMonthlyPlanSnapshot`) — `null` = nenhuma meta em lugar
   * nenhum. */
  costPlanned: number | null;
  /** Auditoria de Comparabilidade de Escopo de Custo: `true` (padrão,
   * omitir preserva o comportamento de sempre) quando o conjunto de canais
   * que sustenta `costPlanned` bate com o conjunto de canais que sustenta
   * `costActual` — `false` só quando divergem de verdade. Quem chama
   * calcula isso com `resolveChannelScopeComparison` (channel-metrics.ts)
   * sobre `resolveClientMonthlyPlan(...).byChannel`/
   * `resolveClientMonthlyActuals(...).byChannel`, nunca este arquivo (que
   * não sabe o que é um "canal"). Opcional pra nenhum chamador existente
   * precisar mudar se um dia não tiver como calcular isso. */
  costScopeComparable?: boolean;

  /** % do mês já decorrido (`computeMonthlyExpectedPct`), 0–100 — usado só
   * pra prorateamento de investimento/resultado esperado até hoje. */
  monthExpectedPct: number;

  /** Dias ÚTEIS desde a última `account_reviews.reviewed_at` — `null` =
   * nunca revisada (mais grave que qualquer atraso numérico). */
  reviewBusinessDaysAgo: number | null;
  /** Prazo máximo configurado (`account_review_cadences.max_business_days_without_review`,
   * com fallback pro padrão da agência quando o cliente não tem cadência
   * própria ainda). `null` = cadência existe mas está desativada
   * (`is_active = false`) — dimensão não avaliada, decisão deliberada do
   * time de não exigir revisão regular deste cliente. */
  reviewMaxBusinessDays: number | null;

  /** Recorte em que esta avaliação está sendo feita (Etapa "Consolidação da
   * Arquitetura — Fase B", Prioridade 1) — `"consolidated"` (padrão, omitir
   * o campo produz exatamente o comportamento de sempre pra todo chamador
   * existente, ex.: a Operação nunca define este campo) ou `"channel"`
   * (avaliação por Meta/Google isolado). Neste modelo de dados não existe
   * plano de investimento nem meta de resultado por canal — só no
   * Consolidado (mesma decisão já registrada em `client-priority.ts`:
   * "ritmo financeiro continua uma exclusividade do Consolidado"). Em
   * `"channel"`, `evaluateDataQuality` sabe que `investmentPlanned`/
   * `resultPlanned` virem `null` é esperado (não é lacuna de dado), nunca
   * gera a issue de qualidade correspondente. Aditivo por construção — nunca
   * um segundo motor, a mesma `evaluateAccountHealth` com um contexto a
   * mais. */
  evaluationScope?: "consolidated" | "channel";

  /** Auditoria de Frescor/Confiabilidade de Dados: MAX(`spend.lastUpdatedAt`,
   * `performanceResult.latestUpdatedAt`) do mês, já calculado por quem chama
   * (`client-operational-state-data.ts` — mesmo valor que já alimenta
   * `ClientOperationalState.lastDataSyncAt`, nunca uma segunda conta).
   * Opcional (padrão `null`, omitir preserva o comportamento de sempre pra
   * qualquer chamador existente) — este arquivo só REPASSA o valor pra
   * `AccountHealthEvaluation.lastDataSyncAt`, nunca o lê pra decidir
   * severidade nenhuma. Nenhuma dimensão, nenhum threshold, nenhuma
   * classificação muda por causa deste campo — essa é exatamente a etapa
   * "menor intervenção segura" da auditoria, antes de qualquer política
   * oficial de frescor ser decidida. */
  lastDataSyncAt?: string | null;
}

function evaluateInvestment(input: AccountHealthInput): InvestmentDimension {
  const { investmentActual, investmentPlanned, investmentHasSyncedData, monthExpectedPct } = input;
  if (investmentPlanned === null) {
    return {
      status: "nenhum",
      deviation: null,
      actual: investmentActual,
      planned: null,
      expected: null,
      hasSyncedData: investmentHasSyncedData,
    };
  }
  const expected = investmentPlanned * (monthExpectedPct / 100);
  const deviation = computeRelativeDeviation(investmentActual, expected);
  const status = severityFromAbsoluteDeviation(
    deviation,
    INVESTMENT_DEVIATION_LEVE,
    INVESTMENT_DEVIATION_RELEVANTE,
    INVESTMENT_DEVIATION_GRAVE,
  );
  return {
    status,
    deviation,
    actual: investmentActual,
    planned: investmentPlanned,
    expected,
    hasSyncedData: investmentHasSyncedData,
  };
}

function evaluateResults(input: AccountHealthInput): ResultDimension {
  const { resultActual, resultPlanned, monthExpectedPct, hasPerformanceData, performanceGoalConfigured } = input;
  if (!performanceGoalConfigured || resultPlanned === null) {
    return {
      status: "nenhum",
      deviation: null,
      actual: resultActual,
      planned: resultPlanned,
      expected: null,
      hasPerformanceData,
    };
  }
  const expected = resultPlanned * (monthExpectedPct / 100);
  const deviation = computeRelativeDeviation(resultActual, expected);
  // Só desvio ABAIXO do esperado é problema — superar a meta nunca penaliza.
  const status = severityFromOneSidedDeviation(
    deviation,
    "negative",
    RESULT_DEVIATION_LEVE,
    RESULT_DEVIATION_RELEVANTE,
    RESULT_DEVIATION_GRAVE,
  );
  return { status, deviation, actual: resultActual, planned: resultPlanned, expected, hasPerformanceData };
}

function evaluateCost(input: AccountHealthInput): CostDimension {
  const { costActual, costPlanned, resultActual, costScopeComparable = true } = input;
  if (costPlanned === null || costActual === null) {
    return {
      status: "nenhum",
      deviation: null,
      actual: costActual,
      planned: costPlanned,
      expected: costPlanned,
      sampleSize: resultActual,
      hasReliableSample: true, // nada a avaliar aqui — falta de dado, não de amostra (ver dataQuality)
      hasComparableScope: true, // idem — sem os dois números, escopo nem chega a ser a questão
    };
  }
  if (resultActual < MIN_RELIABLE_RESULT_COUNT) {
    return {
      status: "nenhum",
      deviation: null,
      actual: costActual,
      planned: costPlanned,
      expected: costPlanned,
      sampleSize: resultActual,
      hasReliableSample: false,
      hasComparableScope: true,
    };
  }
  // Auditoria de Comparabilidade de Escopo de Custo: ausência de evidência
  // COMPARÁVEL nunca é tratada como desempenho ruim — mesmo princípio já
  // aplicado à amostra insuficiente acima, agora pro escopo de canal.
  // "Prefiro ausência de diagnóstico de custo a um diagnóstico numericamente
  // preciso, mas semanticamente incorreto" (pedido explícito): `status`
  // trava em "nenhum", `deviation` nunca é calculado — a comparação nem
  // chega a acontecer, não é só escondida.
  if (!costScopeComparable) {
    return {
      status: "nenhum",
      deviation: null,
      actual: costActual,
      planned: costPlanned,
      expected: costPlanned,
      sampleSize: resultActual,
      hasReliableSample: true,
      hasComparableScope: false,
    };
  }
  const deviation = computeVariationFromTarget(costActual, costPlanned);
  // "Menor é melhor" — só desvio ACIMA da meta é problema.
  const status = severityFromOneSidedDeviation(
    deviation,
    "positive",
    COST_DEVIATION_LEVE,
    COST_DEVIATION_RELEVANTE,
    COST_DEVIATION_GRAVE,
  );
  return {
    status,
    deviation,
    actual: costActual,
    planned: costPlanned,
    expected: costPlanned,
    sampleSize: resultActual,
    hasReliableSample: true,
    hasComparableScope: true,
  };
}

/**
 * Núcleo puro da dimensão de Revisão — extraído (Convergência da Regra de
 * Revisão de Conta) pra ser a fonte única também FORA do Motor de Saúde
 * (Dashboard/Sprints, via `resolveReviewComplianceStatus`/`isReviewOverdue`
 * abaixo), sem duplicar a matemática em outro arquivo. Recebe só os dois
 * números já resolvidos — nunca sabe de onde vieram (`account_reviews`,
 * `account_review_cadences`, fallback), mesma separação já usada por
 * `evaluateCost`/`resolveCostScopeComparability` (channel-metrics.ts).
 * `evaluateReview`, logo abaixo, é hoje só um repasse de `input` pra cá —
 * nenhuma segunda cópia desta matemática em lugar nenhum.
 */
export function resolveReviewDimension(reviewBusinessDaysAgo: number | null, reviewMaxBusinessDays: number | null): ReviewDimension {
  if (reviewMaxBusinessDays === null) {
    return { status: "nenhum", deviation: null, actual: reviewBusinessDaysAgo, planned: 0, expected: 0, enabled: false };
  }
  if (reviewBusinessDaysAgo === null) {
    // Nunca revisada — sempre o pior caso, sem depender de fração nenhuma.
    return {
      status: "grave",
      deviation: null,
      actual: null,
      planned: reviewMaxBusinessDays,
      expected: reviewMaxBusinessDays,
      enabled: true,
    };
  }
  const deviation = computeRelativeDeviation(reviewBusinessDaysAgo, reviewMaxBusinessDays);
  // Só ultrapassar o prazo é problema — revisar antes nunca penaliza.
  const status = severityFromOneSidedDeviation(
    deviation,
    "positive",
    REVIEW_OVERDUE_LEVE,
    REVIEW_OVERDUE_RELEVANTE,
    REVIEW_OVERDUE_GRAVE,
  );
  return {
    status,
    deviation,
    actual: reviewBusinessDaysAgo,
    planned: reviewMaxBusinessDays,
    expected: reviewMaxBusinessDays,
    enabled: true,
  };
}

function evaluateReview(input: AccountHealthInput): ReviewDimension {
  return resolveReviewDimension(input.reviewBusinessDaysAgo, input.reviewMaxBusinessDays);
}

/**
 * Resposta booleana única pra "esta conta está em dia com a revisão?" —
 * `true` em qualquer grau de atraso (leve/relevante/grave), `false` tanto
 * quando está em dia quanto quando a cadência está desativada
 * (`enabled:false`, ver `ReviewDimension`). Substitui
 * `optimizationRecentlyDone`/`OPTIMIZATION_LOOKBACK_DAYS` (motor legado,
 * `attention-alerts.ts`/`operation-data.ts`) onde for consumida — nenhum
 * consumidor decide "em dia" por conta própria a partir daqui em diante.
 */
export function isReviewOverdue(review: ReviewDimension): boolean {
  return review.status !== "nenhum";
}

export interface AccountReviewCadenceRow {
  max_business_days_without_review: number;
  is_active: boolean;
}

/**
 * Resolve os dois números crus que `resolveReviewDimension` consome, a
 * partir da última revisão (`account_reviews.reviewed_at`) e da cadência
 * configurada (`account_review_cadences`) — extraído de
 * `client-operational-state-data.ts` (onde essa conta vivia embutida) pra
 * qualquer consumidor que não carregue `ClientOperationalState` inteiro
 * (ex.: Sprints) resolver a MESMA decisão sem reimplementar
 * `businessDaysSince`/`DEFAULT_REVIEW_MAX_BUSINESS_DAYS`/o fallback.
 * `cadence: null` = nenhuma linha em `account_review_cadences` pra este
 * cliente (usa o fallback da agência); `cadence` com `is_active:false` =
 * cadência desativada (`reviewMaxBusinessDays` vira `null`, dimensão sai do
 * ar em `resolveReviewDimension`).
 */
export function resolveReviewCadenceInputs(
  lastReviewAt: string | null,
  cadence: AccountReviewCadenceRow | null,
  today: Date,
): { reviewBusinessDaysAgo: number | null; reviewMaxBusinessDays: number | null } {
  const reviewBusinessDaysAgo = lastReviewAt ? businessDaysSince(new Date(lastReviewAt), today) : null;
  const reviewMaxBusinessDays = cadence
    ? cadence.is_active
      ? cadence.max_business_days_without_review
      : null
    : DEFAULT_REVIEW_MAX_BUSINESS_DAYS;
  return { reviewBusinessDaysAgo, reviewMaxBusinessDays };
}

/**
 * Composição de conveniência dos dois helpers acima — a resposta completa
 * (dimensão graduada + booleano) a partir só dos dados crus, pra quem (ex.:
 * Sprints) resolve a cadência oficial fora do pipeline do Motor de Saúde.
 */
export function resolveReviewComplianceStatus(
  lastReviewAt: string | null,
  cadence: AccountReviewCadenceRow | null,
  today: Date,
): { review: ReviewDimension; isOverdue: boolean } {
  const { reviewBusinessDaysAgo, reviewMaxBusinessDays } = resolveReviewCadenceInputs(lastReviewAt, cadence, today);
  const review = resolveReviewDimension(reviewBusinessDaysAgo, reviewMaxBusinessDays);
  return { review, isOverdue: isReviewOverdue(review) };
}

/**
 * Data Quality is intentionally extensible.
 *
 * Missing planning is only the first rule.
 * Future integrations may contribute
 * additional health signals.
 */
function evaluateDataQuality(input: AccountHealthInput, hasCostTarget: boolean): DataQualityDimension {
  const issues: string[] = [];
  // Em recorte por canal, ausência de plano/meta é esperada (só existem no
  // Consolidado neste modelo de dados) — nunca uma lacuna de qualidade.
  const isChannelScope = input.evaluationScope === "channel";

  if (isChannelScope) {
    if (!input.investmentHasSyncedData) {
      issues.push("Sem sincronização de investimento este mês");
    }
  } else if (input.investmentPlanned === null) {
    issues.push("Planejamento mensal não definido");
  } else if (!input.investmentHasSyncedData) {
    issues.push("Sem sincronização de investimento este mês");
  }

  if (!input.performanceGoalConfigured) {
    issues.push("Objetivo de performance não configurado");
  } else {
    if (!isChannelScope && input.resultPlanned === null) issues.push("Meta de resultado não definida");
    if (!input.hasPerformanceData) issues.push("Sem dados de performance registrados este mês");
    if (!hasCostTarget) issues.push("Meta de custo não definida");
  }

  // Binário, não gradual: "sem dados confiáveis não existe operação" — a
  // presença de qualquer lacuna já é grave o bastante pra dominar a
  // prioridade (ver ordem de desempate abaixo), nunca uma "qualidade
  // parcial".
  return { status: issues.length > 0 ? "grave" : "nenhum", issues };
}

function describeInvestmentReason(dimension: InvestmentDimension): string | null {
  if (dimension.status === "nenhum" || dimension.deviation === null) return null;
  const pct = Math.round(Math.abs(dimension.deviation) * 100);
  const direction = dimension.deviation > 0 ? "acima" : "abaixo";
  return `Investimento ${pct}% ${direction} do esperado`;
}

function describeResultReason(dimension: ResultDimension): string | null {
  if (dimension.status === "nenhum" || dimension.deviation === null) return null;
  const pct = Math.round(Math.abs(dimension.deviation) * 100);
  return `Resultado ${pct}% abaixo do esperado`;
}

function describeCostReason(dimension: CostDimension): string | null {
  if (!dimension.hasReliableSample) {
    return `Aguardando amostra suficiente para avaliar custo (${dimension.sampleSize} de ${MIN_RELIABLE_RESULT_COUNT} resultados)`;
  }
  if (!dimension.hasComparableScope) {
    return "Custo por resultado sem base comparável — planejamento e realizado não cobrem os mesmos canais";
  }
  if (dimension.status === "nenhum" || dimension.deviation === null) return null;
  const pct = Math.round(Math.abs(dimension.deviation) * 100);
  return `Custo por resultado ${pct}% acima da meta`;
}

function describeReviewReason(dimension: ReviewDimension): string | null {
  if (dimension.status === "nenhum") return null;
  if (dimension.actual === null) return "Nenhuma revisão registrada ainda";
  return `Revisão atrasada há ${dimension.actual} dias úteis (prazo: ${dimension.planned})`;
}

function describeDataQualityReason(dimension: DataQualityDimension): string | null {
  return dimension.issues[0] ?? null;
}

function describeDimensionReason(
  key: keyof AccountHealthEvaluation["dimensions"],
  dimensions: AccountHealthEvaluation["dimensions"],
): string | null {
  switch (key) {
    case "dataQuality":
      return describeDataQualityReason(dimensions.dataQuality);
    case "cost":
      return describeCostReason(dimensions.cost);
    case "results":
      return describeResultReason(dimensions.results);
    case "investment":
      return describeInvestmentReason(dimensions.investment);
    case "review":
      return describeReviewReason(dimensions.review);
  }
}

interface DimensionRankedEntry {
  key: keyof AccountHealthEvaluation["dimensions"];
  severity: DimensionSeverity;
  reason: string | null;
}

function rankDimensions(dimensions: AccountHealthEvaluation["dimensions"]): DimensionRankedEntry[] {
  return DIMENSION_PRIORITY_ORDER.map((key) => ({
    key,
    severity: dimensions[key].status,
    reason: describeDimensionReason(key, dimensions),
  }));
}

export function evaluateAccountHealth(input: AccountHealthInput): AccountHealthEvaluation {
  const dimensions = {
    investment: evaluateInvestment(input),
    results: evaluateResults(input),
    cost: evaluateCost(input),
    review: evaluateReview(input),
    dataQuality: evaluateDataQuality(input, input.costPlanned !== null),
  };

  const ordered = rankDimensions(dimensions);

  const worstSeverity = ordered.reduce<DimensionSeverity>(
    (worst, entry) => (DIMENSION_SEVERITY_RANK[entry.severity] > DIMENSION_SEVERITY_RANK[worst] ? entry.severity : worst),
    "nenhum",
  );

  const primaryEntry = ordered.find((entry) => entry.severity === worstSeverity && entry.reason !== null);
  const healthStatus = HEALTH_STATUS_BY_SEVERITY[worstSeverity];

  return {
    healthStatus,
    healthScore: HEALTH_SCORE_BY_STATUS[healthStatus],
    lastDataSyncAt: input.lastDataSyncAt ?? null,
    primaryReason: primaryEntry?.reason ?? "Nenhum sinal de atenção no momento",
    primaryDimension: primaryEntry?.key ?? null,
    dimensions,
  };
}

/** Todos os motivos ativos (não só o primário), ordenados por severidade
 * (pior primeiro) e, em empate, pela mesma ordem de prioridade de
 * `evaluateAccountHealth` — garante `reasons[0] === primaryReason` sempre,
 * nunca uma dimensão mais leve aparecendo antes de uma mais grave só porque
 * vem antes na lista de prioridade. `sort` é estável (ES2019+), então o
 * empate preserva a ordem de prioridade de `DIMENSION_PRIORITY_ORDER`. Pra
 * listas que queiram mostrar "+N motivos" além do protagonista (mesmo
 * padrão visual que a Operação já usa hoje). */
export function collectAccountHealthReasons(evaluation: AccountHealthEvaluation): string[] {
  return rankDimensions(evaluation.dimensions)
    .filter((entry): entry is DimensionRankedEntry & { reason: string } => entry.reason !== null)
    .sort((a, b) => DIMENSION_SEVERITY_RANK[b.severity] - DIMENSION_SEVERITY_RANK[a.severity])
    .map((entry) => entry.reason);
}

/**
 * Achado P0 da Auditoria do Motor Operacional: quando `dataQuality` vence o
 * desempate ("Sem dados"), as outras quatro dimensões já foram calculadas
 * inteiramente — só não venceram porque "sem dado confiável" é sempre a
 * prioridade estrutural do motor (`DIMENSION_PRIORITY_ORDER`). Essa
 * severidade real fica descartada hoje: a conta pode estar com investimento
 * gravemente fora do ritmo e, mesmo assim, aparecer só como "Sem dados",
 * sem nenhum indício de que já existe uma conclusão operacional pronta.
 *
 * Não recalcula nada e não muda `healthStatus`/`primaryReason`/
 * `primaryDimension` — só olha o que `evaluateAccountHealth` já produziu e
 * escolhe, entre as quatro dimensões OPERACIONAIS (nunca a própria
 * `dataQuality`), a pior com severidade `relevante` ou `grave` (`leve`
 * nunca aparece aqui — ruído, não sinal). Em empate de severidade, usa a
 * MESMA ordem de `DIMENSION_PRIORITY_ORDER` que todo o resto do motor já
 * usa para desempate — nenhuma ordem nova. O texto devolvido é sempre o
 * que a própria dimensão já produz via `describeDimensionReason` (a mesma
 * função que compõe `primaryReason`/`collectAccountHealthReasons`) — nunca
 * uma frase nova.
 *
 * `null` sempre que `primaryDimension` não é `dataQuality`, ou quando
 * nenhuma dimensão operacional passa de `leve` — nesses casos não há
 * contexto secundário a mostrar.
 */
export function describeSecondaryOperationalContext(evaluation: AccountHealthEvaluation): string | null {
  if (evaluation.primaryDimension !== "dataQuality") return null;

  const candidates = DIMENSION_PRIORITY_ORDER.filter((key) => key !== "dataQuality").map((key) => ({
    key,
    severity: evaluation.dimensions[key].status,
  }));

  const worst = candidates.reduce<DimensionRankedEntry["key"] | null>((worstKey, entry) => {
    if (DIMENSION_SEVERITY_RANK[entry.severity] < DIMENSION_SEVERITY_RANK.relevante) return worstKey;
    if (worstKey === null) return entry.key;
    return DIMENSION_SEVERITY_RANK[entry.severity] > DIMENSION_SEVERITY_RANK[evaluation.dimensions[worstKey].status]
      ? entry.key
      : worstKey;
  }, null);

  return worst ? describeDimensionReason(worst, evaluation.dimensions) : null;
}
