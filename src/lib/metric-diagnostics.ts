import { PERFORMANCE_STATUS_MARGIN } from "./performance";
import { SPEND_STATUS_MARGIN } from "./spend-status";

/**
 * MITZA 2.0 — Motor de Diagnóstico Único. Antes desta etapa, quatro
 * sistemas de threshold coexistiam sem se conhecer (SPEND_STATUS_MARGIN
 * ±20% pro ritmo financeiro, o Motor de Saúde 15/30/50% pra investimento e
 * 10/30/50% pra custo, PERFORMANCE_STATUS_MARGIN ±10% pra eficiência) —
 * nenhum foi descartado aqui (cada tolerância continua vindo de quem já a
 * possuía, nunca duplicada como número mágico novo), mas a partir de agora
 * só ESTE módulo decide, dado um valor/esperado/regra, três coisas que
 * antes eram decididas soltas em cada tela: a DIREÇÃO da variação (só
 * aritmética), o TOM/cor (sempre pela regra do indicador, nunca pela
 * seta) e se aquilo conta como "fora do esperado" pra fins de
 * filtro/badge. Telas nunca devem reimplementar essa decisão — só
 * consomem o resultado.
 */

export type MetricRule = "lower_is_better" | "higher_is_better" | "any_deviation_is_bad";
export type MetricDirection = "up" | "down" | "flat";
export type MetricTone = "positive" | "negative" | "neutral";

export interface MetricDiagnostic {
  value: number;
  expected: number | null;
  /** `(value - expected) / expected` — `null` quando não há base de
   * comparação (sem meta/esperado configurado, ou esperado <= 0). Nunca
   * inventa um desvio sem uma base real. */
  deviationPct: number | null;
  /** Só a direção matemática — nunca decide cor sozinha. */
  direction: MetricDirection;
  /** A cor de verdade — sempre resolvida pela regra do indicador
   * (`MetricRuleConfig.rule`), nunca pela direção isolada. */
  tone: MetricTone;
  /** Desvio absoluto maior que a tolerância do indicador — critério único
   * pra "este indicador deve aparecer num filtro/badge de diagnóstico".
   * Nunca o mesmo que `tone !== "neutral"` só por coincidência: é a MESMA
   * regra, calculada uma vez só, aqui. */
  isOutOfRange: boolean;
}

interface MetricRuleConfig {
  rule: MetricRule;
  /** Desvio absoluto até este valor ainda conta como "dentro" — cada
   * indicador injeta a própria tolerância (nunca uma constante genérica
   * compartilhada entre indicadores diferentes). */
  tolerance: number;
}

/** Núcleo puro — qualquer indicador futuro (não só CPA/Investimento) deve
 * passar por aqui, nunca reimplementar a decisão de direção/cor por conta
 * própria. */
export function evaluateMetricDiagnostic(
  value: number,
  expected: number | null,
  config: MetricRuleConfig,
): MetricDiagnostic {
  if (expected === null || expected <= 0) {
    return { value, expected, deviationPct: null, direction: "flat", tone: "neutral", isOutOfRange: false };
  }

  const deviationPct = (value - expected) / expected;
  const direction: MetricDirection = deviationPct > 0 ? "up" : deviationPct < 0 ? "down" : "flat";
  const isOutOfRange = Math.abs(deviationPct) > config.tolerance;

  const tone: MetricTone = !isOutOfRange
    ? "neutral"
    : config.rule === "any_deviation_is_bad"
      ? "negative"
      : config.rule === "lower_is_better"
        ? direction === "up"
          ? "negative"
          : "positive"
        : direction === "up"
          ? "positive"
          : "negative";

  return { value, expected, deviationPct, direction, tone, isOutOfRange };
}

/**
 * CPA/CPL — "menor é melhor": custo acima da meta é sempre ruim (vermelho),
 * abaixo é sempre bom (verde). Tolerância reaproveitada de
 * `PERFORMANCE_STATUS_MARGIN` (performance.ts, ±10%) — a mesma margem que
 * já classifica "dentro da meta" em `getPerformanceStatus`, nunca uma
 * segunda ±X% inventada aqui.
 */
export function evaluateCpaDiagnostic(
  costPerResult: number | null,
  targetCostPerResult: number | null,
): MetricDiagnostic | null {
  if (costPerResult === null) return null;
  return evaluateMetricDiagnostic(costPerResult, targetCostPerResult, {
    rule: "lower_is_better",
    tolerance: PERFORMANCE_STATUS_MARGIN,
  });
}

/**
 * Investimento — "qualquer desvio é ruim": diferente de CPA, aqui a
 * direção nunca decide se é bom ou ruim (gastar rápido demais ou devagar
 * demais são os dois um problema de ritmo). Tolerância reaproveitada de
 * `SPEND_STATUS_MARGIN` (spend-status.ts, ±20%) — a mesma margem que já
 * classifica "dentro"/"acima"/"abaixo" em `classifySpendStatus`.
 */
export function evaluateInvestmentDiagnostic(actualSpend: number, expectedToDate: number | null): MetricDiagnostic {
  return evaluateMetricDiagnostic(actualSpend, expectedToDate, {
    rule: "any_deviation_is_bad",
    tolerance: SPEND_STATUS_MARGIN,
  });
}

// ---------------------------------------------------------------------------
// Pendências — não é um desvio (não tem "valor atual vs. esperado"), é uma
// contagem de obrigações operacionais em aberto (tarefas como checar
// saldo, enviar report etc.). Deliberadamente NÃO inclui revisão/otimização
// atrasada — essa é uma dimensão independente (ver Acompanhamento, abaixo):
// uma conta pode não ter nenhuma pendência e ainda estar dias sem
// otimização registrada, e vice-versa. O hook (`PendenciaType`) existe pra
// caber qualquer obrigação futura além de tarefa sem precisar reabrir este
// arquivo.
// ---------------------------------------------------------------------------

export type PendenciaType = "tarefas_abertas";

export interface PendenciaItem {
  type: PendenciaType;
  label: string;
}

export interface PendenciasDiagnostic {
  /** Nº de obrigações em aberto (cada tarefa aberta conta 1). */
  count: number;
  items: PendenciaItem[];
  hasPendencias: boolean;
}

export function evaluatePendencias(input: { openTasksCount: number }): PendenciasDiagnostic {
  const items: PendenciaItem[] = [];

  if (input.openTasksCount > 0) {
    items.push({
      type: "tarefas_abertas",
      label: `${input.openTasksCount} tarefa${input.openTasksCount === 1 ? "" : "s"} em aberto`,
    });
  }

  return {
    count: input.openTasksCount,
    items,
    hasPendencias: items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Acompanhamento — eixo independente de Pendências: não é "o que falta
// fazer", é "há quanto tempo o gestor está de fato atuando nesta conta"
// (última otimização registrada, dias desde então, em dia ou atrasado
// frente à cadência configurada). A descoberta desta etapa: Performance
// (CPA/Investimento), Pendências e Acompanhamento são três eixos
// independentes entre si — uma conta pode estar com Acompanhamento
// atrasado sem ter nenhuma Pendência aberta, e o inverso também é
// possível. Motor já nasce preparado pra responder isto mesmo que nenhuma
// tela ainda exponha o resultado.
// ---------------------------------------------------------------------------

export interface AcompanhamentoDiagnostic {
  lastOptimizationAt: string | null;
  daysSinceLastOptimization: number | null;
  /** `null` quando não há como avaliar (sem cadência ativa configurada, ou
   * nenhuma otimização registrada ainda) — nunca um "em dia" fabricado sem
   * base de comparação. */
  isOverdue: boolean | null;
  maxDaysAllowed: number | null;
}

export function evaluateAcompanhamento(input: {
  lastOptimizationAt: string | null;
  daysSinceLastOptimization: number | null;
  maxDaysAllowed: number | null;
}): AcompanhamentoDiagnostic {
  const isOverdue =
    input.maxDaysAllowed !== null && input.daysSinceLastOptimization !== null
      ? input.daysSinceLastOptimization > input.maxDaysAllowed
      : null;

  return {
    lastOptimizationAt: input.lastOptimizationAt,
    daysSinceLastOptimization: input.daysSinceLastOptimization,
    isOverdue,
    maxDaysAllowed: input.maxDaysAllowed,
  };
}

// ---------------------------------------------------------------------------
// Agregado por cliente — o formato único que qualquer tela (Operação,
// Dashboard, Prontuário) deve consumir dese agora em diante, em vez de
// montar sua própria combinação de CPA/Investimento/Pendências.
// ---------------------------------------------------------------------------

export interface ClientDiagnosticsInput {
  cpa: { costPerResult: number | null; targetCostPerResult: number | null };
  investment: { actualSpend: number; expectedToDate: number | null };
  pendencias: { openTasksCount: number };
  acompanhamento: { lastOptimizationAt: string | null; daysSinceLastOptimization: number | null; maxDaysAllowed: number | null };
}

export interface ClientDiagnostics {
  cpa: MetricDiagnostic | null;
  investment: MetricDiagnostic;
  pendencias: PendenciasDiagnostic;
  acompanhamento: AcompanhamentoDiagnostic;
}

export function evaluateClientDiagnostics(input: ClientDiagnosticsInput): ClientDiagnostics {
  return {
    cpa: evaluateCpaDiagnostic(input.cpa.costPerResult, input.cpa.targetCostPerResult),
    investment: evaluateInvestmentDiagnostic(input.investment.actualSpend, input.investment.expectedToDate),
    pendencias: evaluatePendencias(input.pendencias),
    acompanhamento: evaluateAcompanhamento(input.acompanhamento),
  };
}

/** Os motivos de atenção da Operação (Etapa "Novo Conceito de
 * Monitoramento Operacional") — nunca "Saudável"/"Atenção"/"Crítico"
 * genéricos: cada filtro responde por um fato objetivo específico. Uma
 * tela de filtro consome só isto, nunca reimplementa os limites acima.
 * `acompanhamento` já está pronto no motor, mesmo que nenhuma tela ainda o
 * use como filtro. */
export type ClientDiagnosticFilter = "cpa" | "investimento" | "pendencias" | "acompanhamento";

export function getActiveDiagnosticFilters(diagnostics: ClientDiagnostics): ClientDiagnosticFilter[] {
  const active: ClientDiagnosticFilter[] = [];
  if (diagnostics.cpa?.isOutOfRange) active.push("cpa");
  if (diagnostics.investment.isOutOfRange) active.push("investimento");
  if (diagnostics.pendencias.hasPendencias) active.push("pendencias");
  if (diagnostics.acompanhamento.isOverdue) active.push("acompanhamento");
  return active;
}
