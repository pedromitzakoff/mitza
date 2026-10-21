/**
 * MITZA 2.0 — Motor de Diagnóstico Único. Antes desta etapa, quatro
 * sistemas de threshold coexistiam sem se conhecer (SPEND_STATUS_MARGIN
 * ±20% pro ritmo financeiro, o Motor de Saúde 15/30/50% pra investimento e
 * 10/30/50% pra custo, PERFORMANCE_STATUS_MARGIN ±10% pra eficiência).
 * Etapa "Regra Única de Desvio": a SEVERIDADE (o quão longe do esperado)
 * virou uma única régua de magnitude, igual pra qualquer indicador:
 *
 *   até 10%      → normal   (sem seta, sem cor, só o valor)
 *   10% até 20%  → atenção  (amarelo)
 *   acima de 20% → crítico  (vermelho)
 *
 * O gestor aprende UMA linguagem visual de severidade, não uma por
 * métrica. O que continua variando por indicador — porque é um fato do
 * próprio indicador, não uma escolha de estilo — é QUAL direção conta
 * como desvio: Investimento é "qualquer direção" (gastar rápido demais ou
 * devagar demais são os dois problema de ritmo); CPA/CPL é "só acima da
 * meta" (custo abaixo da meta é sempre melhora de performance, nunca
 * alerta, não importa a magnitude — R$7 numa meta de R$10 é normal, não
 * "40% de melhora destacada"). Na direção que não conta como desvio pro
 * indicador, o resultado é sempre normal: sem seta, sem cor, sem
 * percentual, fora de qualquer filtro. Telas nunca devem reimplementar
 * essa decisão — só consomem o resultado.
 */

import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";

export type MetricDirection = "up" | "down" | "flat";
export type MetricTone = "normal" | "attention" | "critical";
/** Qual direção do desvio conta como "fora do esperado" pro indicador —
 * `"any"` (Investimento) ou `"increase"` (CPA/CPL: só valor ACIMA do
 * esperado). Nunca um terceiro valor "decrease" foi necessário até hoje —
 * adicionar quando/se aparecer um indicador assim. */
export type MetricDeviationSensitivity = "any" | "increase";

/** Desvio absoluto até este valor é normal — não mostra seta/cor. */
export const METRIC_DEVIATION_ATTENTION_THRESHOLD = 0.1;
/** Acima deste valor é crítico; entre o limite de atenção e este é atenção. */
export const METRIC_DEVIATION_CRITICAL_THRESHOLD = 0.2;

export interface MetricDiagnostic {
  value: number;
  expected: number | null;
  /** `(value - expected) / expected` — `null` quando não há base de
   * comparação (sem meta/esperado configurado, ou esperado <= 0). Nunca
   * inventa um desvio sem uma base real. */
  deviationPct: number | null;
  /** Só a direção matemática — nunca decide cor sozinha. */
  direction: MetricDirection;
  /** A cor de verdade — pela régua de magnitude (10%/20%) quando a
   * direção conta como desvio pro indicador (`MetricDeviationSensitivity`);
   * `"normal"` sempre que não conta, não importa a magnitude. */
  tone: MetricTone;
  /** `tone !== "normal"` — critério único pra "este indicador deve
   * aparecer num filtro/badge de diagnóstico". */
  isOutOfRange: boolean;
}

/** Núcleo puro — qualquer indicador com valor/esperado (não só CPA/
 * Investimento) deve passar por aqui, nunca reimplementar a régua de
 * magnitude por conta própria. */
export function evaluateMetricDiagnostic(
  value: number,
  expected: number | null,
  sensitivity: MetricDeviationSensitivity = "any",
): MetricDiagnostic {
  if (expected === null || expected <= 0) {
    return { value, expected, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false };
  }

  const deviationPct = (value - expected) / expected;
  const direction: MetricDirection = deviationPct > 0 ? "up" : deviationPct < 0 ? "down" : "flat";
  const countsAsDeviation = sensitivity === "any" || direction === "up";

  const tone: MetricTone = !countsAsDeviation
    ? "normal"
    : Math.abs(deviationPct) <= METRIC_DEVIATION_ATTENTION_THRESHOLD
      ? "normal"
      : Math.abs(deviationPct) <= METRIC_DEVIATION_CRITICAL_THRESHOLD
        ? "attention"
        : "critical";

  return { value, expected, deviationPct, direction, tone, isOutOfRange: tone !== "normal" };
}

/** CPA/CPL — só desvio ACIMA da meta conta (custo abaixo da meta é sempre
 * melhora, nunca alerta). Régua de magnitude (10%/20%) igual à de
 * qualquer outro indicador quando o desvio conta.
 *
 * Amostra mínima (Etapa "Auditoria do Motor Operacional", achado P0):
 * abaixo de `MIN_RELIABLE_RESULT_COUNT` resultados, o desvio nunca vira
 * `attention`/`critical` — mesma constante e mesmo critério que
 * `evaluateCost` (`account-health-engine.ts`) já usa pro Motor de Saúde,
 * nunca um segundo número mágico "3" duplicado aqui. Antes desta etapa,
 * o Motor de Saúde já suprimia CPA sem amostra suficiente, mas o Motor de
 * Diagnóstico Único (filtros/badges da Operação, "Prioridades de hoje")
 * classificava o mesmo CPA como crítico sem essa proteção — a mesma conta
 * podia aparecer como "sem amostra" num lugar e "CPA crítico" em outro.
 * `expected` continua populado (mesmo padrão de `CostDimension` quando
 * `hasReliableSample` é falso: a meta em si não desaparece, só o
 * julgamento do desvio fica em suspenso) — só `deviationPct`/`tone`
 * ficam neutros, igual ao caso "sem meta pra comparar" logo acima em
 * `evaluateMetricDiagnostic`. */
export function evaluateCpaDiagnostic(
  costPerResult: number | null,
  targetCostPerResult: number | null,
  resultCount: number,
): MetricDiagnostic | null {
  if (costPerResult === null) return null;
  if (resultCount < MIN_RELIABLE_RESULT_COUNT) {
    return { value: costPerResult, expected: targetCostPerResult, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false };
  }
  return evaluateMetricDiagnostic(costPerResult, targetCostPerResult, "increase");
}

/** Investimento — qualquer direção conta como desvio (ritmo rápido demais
 * ou devagar demais são os dois problema). Mesma régua de magnitude. */
export function evaluateInvestmentDiagnostic(actualSpend: number, expectedToDate: number | null): MetricDiagnostic {
  return evaluateMetricDiagnostic(actualSpend, expectedToDate, "any");
}

// ---------------------------------------------------------------------------
// Planejamento — não é um problema de ritmo (CPA, Investimento), é um
// problema ESTRUTURAL: a conta ainda não tem as configurações mínimas
// pro motor conseguir diagnosticá-la de verdade. Deliberadamente separado
// dos outros eixos: sem meta de custo ou sem plano mensal de investimento,
// `evaluateCpaDiagnostic`/`evaluateInvestmentDiagnostic` voltam
// `tone: "normal"` (nenhuma base de comparação, nunca um "0 esperado"
// fabricado) — o que tornaria o silêncio da interface ENGANOSO sem este
// eixo avisando que aquela conta simplesmente não foi avaliada, não que foi
// avaliada e aprovada. "Nenhum alerta = nenhuma ação necessária" só é
// verdade quando Planejamento também está limpo — por isso ele nunca fica
// silencioso: se incompleto, sempre entra no filtro, mesmo que os outros
// eixos não tenham nada a dizer (porque, tecnicamente, não conseguiram
// dizer nada).
// ---------------------------------------------------------------------------

export type PlanejamentoIssueType = "meta_custo_nao_configurada" | "plano_investimento_nao_configurado";

export interface PlanejamentoItem {
  type: PlanejamentoIssueType;
  label: string;
}

export interface PlanejamentoDiagnostic {
  items: PlanejamentoItem[];
  isIncomplete: boolean;
}

export function evaluatePlanejamento(input: {
  /** `false` = sem `performance_goal` (leads/vendas/seguidores) configurado
   * — sem isso não existe custo por resultado possível de definir, então
   * conta como meta de custo ausente. */
  hasPerformanceGoal: boolean;
  targetCostPerResult: number | null;
  investmentPlanned: number | null;
}): PlanejamentoDiagnostic {
  const items: PlanejamentoItem[] = [];

  // Rótulo goal-agnostic (Etapa "Objetivo Seguidores"): "CPA/CPL" assumia só
  // 2 objetivos possíveis — com um 3º objetivo (Seguidores) o rótulo precisa
  // valer pra qualquer um, sem enumerar as abreviações específicas.
  if (!input.hasPerformanceGoal || input.targetCostPerResult === null) {
    items.push({ type: "meta_custo_nao_configurada", label: "Meta de custo por resultado não configurada" });
  }
  if (input.investmentPlanned === null) {
    items.push({
      type: "plano_investimento_nao_configurado",
      label: "Planejamento mensal de investimento não configurado",
    });
  }

  return { items, isIncomplete: items.length > 0 };
}

// ---------------------------------------------------------------------------
// Agregado por cliente — o formato único que qualquer tela deve consumir,
// em vez de montar sua própria combinação de CPA/Investimento.
// KOFF Analytics — Etapa 1.8: o eixo Pendências (contagem de tarefas em
// aberto) foi removido por completo — a plataforma não usa mais quantidade
// de tarefas como indicador de saúde ou performance.
// KOFF Analytics — Etapa 1.9: o eixo Atividade (AtividadeDiagnostic/
// evaluateAtividade/formatAtividadeLabel) foi removido pelo mesmo motivo —
// media só execução operacional (tarefa concluída/comentada, otimização
// registrada), nunca resultado de marketing, e suas duas fontes
// (operational_activities, account_reviews) deixaram de receber eventos
// novos desde a Etapa 1.8, que removeu todo o código que as escrevia.
// ---------------------------------------------------------------------------

export interface ClientDiagnosticsInput {
  planejamento: { hasPerformanceGoal: boolean; targetCostPerResult: number | null; investmentPlanned: number | null };
  /** `resultCount`: mesma contagem que alimenta `MIN_RELIABLE_RESULT_COUNT`
   * no Motor de Saúde (`AccountHealthInput.resultActual`) — nunca uma
   * segunda fonte, ver `evaluateCpaDiagnostic`. */
  cpa: { costPerResult: number | null; targetCostPerResult: number | null; resultCount: number };
  investment: { actualSpend: number; expectedToDate: number | null };
}

export interface ClientDiagnostics {
  planejamento: PlanejamentoDiagnostic;
  cpa: MetricDiagnostic | null;
  investment: MetricDiagnostic;
}

export function evaluateClientDiagnostics(input: ClientDiagnosticsInput): ClientDiagnostics {
  return {
    planejamento: evaluatePlanejamento(input.planejamento),
    cpa: evaluateCpaDiagnostic(input.cpa.costPerResult, input.cpa.targetCostPerResult, input.cpa.resultCount),
    investment: evaluateInvestmentDiagnostic(input.investment.actualSpend, input.investment.expectedToDate),
  };
}

/** Severidade de um `MetricTone` isolado — crítico é sempre mais severo que
 * atenção, que é sempre mais severo que normal. Núcleo puro reaproveitado por
 * qualquer comparação de severidade entre diagnósticos (nunca reimplementado
 * como `tone === "critical" ? 0 : ...` solto numa tela). */
export function metricToneSeverityRank(tone: MetricTone): number {
  return tone === "critical" ? 0 : tone === "attention" ? 1 : 2;
}

