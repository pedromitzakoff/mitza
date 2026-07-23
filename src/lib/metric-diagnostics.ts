/**
 * MITZA 2.0 — Motor de Diagnóstico Único. Antes desta etapa, quatro
 * sistemas de threshold coexistiam sem se conhecer (SPEND_STATUS_MARGIN
 * ±20% pro ritmo financeiro, o Motor de Saúde 15/30/50% pra investimento e
 * 10/30/50% pra custo, PERFORMANCE_STATUS_MARGIN ±10% pra eficiência), e
 * cada indicador ainda decidia cor por regra própria (CPA "menor é
 * melhor", Investimento "qualquer desvio é ruim"). Etapa "Regra Única de
 * Desvio": os dois foram unificados numa única leitura, a mesma pra
 * qualquer indicador — só a MAGNITUDE do desvio (nunca a direção) decide
 * severidade:
 *
 *   até 10%      → normal   (sem seta, sem cor, só o valor)
 *   10% até 20%  → atenção  (amarelo)
 *   acima de 20% → crítico  (vermelho)
 *
 * O gestor aprende UMA linguagem visual, não uma por métrica. Direção
 * (seta ↑/↓) continua sendo calculada — é só aritmética, nunca decide cor
 * — mas fica visualmente ausente no estado normal (não há nada de
 * relevante a apontar). Telas nunca devem reimplementar essa decisão — só
 * consomem o resultado.
 */

export type MetricDirection = "up" | "down" | "flat";
export type MetricTone = "normal" | "attention" | "critical";

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
  /** A cor de verdade — sempre pela MESMA régua de magnitude (10%/20%),
   * igual pra qualquer indicador, nunca pela direção isolada. */
  tone: MetricTone;
  /** `tone !== "normal"` — critério único pra "este indicador deve
   * aparecer num filtro/badge de diagnóstico". */
  isOutOfRange: boolean;
}

/** Núcleo puro — qualquer indicador com valor/esperado (não só CPA/
 * Investimento) deve passar por aqui, nunca reimplementar a régua de
 * magnitude por conta própria. */
export function evaluateMetricDiagnostic(value: number, expected: number | null): MetricDiagnostic {
  if (expected === null || expected <= 0) {
    return { value, expected, deviationPct: null, direction: "flat", tone: "normal", isOutOfRange: false };
  }

  const deviationPct = (value - expected) / expected;
  const direction: MetricDirection = deviationPct > 0 ? "up" : deviationPct < 0 ? "down" : "flat";
  const absDeviation = Math.abs(deviationPct);

  const tone: MetricTone =
    absDeviation <= METRIC_DEVIATION_ATTENTION_THRESHOLD
      ? "normal"
      : absDeviation <= METRIC_DEVIATION_CRITICAL_THRESHOLD
        ? "attention"
        : "critical";

  return { value, expected, deviationPct, direction, tone, isOutOfRange: tone !== "normal" };
}

/** CPA/CPL — mesma régua universal de magnitude (nunca mais "menor é
 * melhor" tratado diferente de "qualquer desvio é ruim"). */
export function evaluateCpaDiagnostic(
  costPerResult: number | null,
  targetCostPerResult: number | null,
): MetricDiagnostic | null {
  if (costPerResult === null) return null;
  return evaluateMetricDiagnostic(costPerResult, targetCostPerResult);
}

/** Investimento — mesma régua universal de magnitude. */
export function evaluateInvestmentDiagnostic(actualSpend: number, expectedToDate: number | null): MetricDiagnostic {
  return evaluateMetricDiagnostic(actualSpend, expectedToDate);
}

// ---------------------------------------------------------------------------
// Pendências — não é um desvio (não tem "valor atual vs. esperado"), é uma
// contagem de obrigações operacionais em aberto (tarefas como checar
// saldo, enviar report etc.). Deliberadamente NÃO inclui atividade —
// essa é uma dimensão independente (ver Atividade, abaixo): uma conta pode
// não ter nenhuma pendência e ainda estar dias sem nenhuma atividade
// registrada, e vice-versa. O hook (`PendenciaType`) existe pra caber
// qualquer obrigação futura além de tarefa sem precisar reabrir este
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
// Atividade — eixo independente de Pendências: não é "o que falta fazer",
// é "há quanto tempo alguém age de fato nesta conta" (otimização, tarefa
// concluída, ou qualquer outra ação registrada como atividade
// operacional). Performance (CPA/Investimento), Pendências e Atividade são
// três eixos independentes entre si — uma conta pode estar sem atividade
// recente sem ter nenhuma Pendência aberta, e o inverso também é possível.
//
// Diferente de Pendências/Performance, aqui só existe UM estado de alerta
// (sem gradiente atenção/crítico): abaixo de 48h sem atividade a conta
// fica visualmente limpa (nenhuma mensagem); a partir de 48h aparece em
// vermelho. O objetivo é que só a exceção chame atenção — contas com
// atividade recente não precisam de nenhum selo "tudo bem".
// ---------------------------------------------------------------------------

export const ATIVIDADE_OVERDUE_HOURS = 48;

export interface AtividadeDiagnostic {
  lastActivityAt: string | null;
  hoursSinceLastActivity: number | null;
  /** `hoursSinceLastActivity === null` (nunca houve atividade) também
   * conta como atrasado — nunca um "em dia" fabricado sem nenhum registro. */
  isOverdue: boolean;
}

export function evaluateAtividade(input: {
  lastActivityAt: string | null;
  hoursSinceLastActivity: number | null;
}): AtividadeDiagnostic {
  const isOverdue = input.hoursSinceLastActivity === null || input.hoursSinceLastActivity >= ATIVIDADE_OVERDUE_HOURS;

  return {
    lastActivityAt: input.lastActivityAt,
    hoursSinceLastActivity: input.hoursSinceLastActivity,
    isOverdue,
  };
}

/** `null` enquanto a conta está em dia (< 48h de atividade) — o card
 * simplesmente não mostra nada, de propósito (ruído zero em contas
 * saudáveis). A partir de 48h: "Sem atividade há 48 horas" / "...há 3
 * dias" / "...há 7 dias" (sempre em vermelho). Único lugar que traduz
 * `AtividadeDiagnostic` pra texto — qualquer tela que precise deste rótulo
 * usa esta função, nunca monta a frase sozinha. */
export function formatAtividadeLabel(diagnostic: AtividadeDiagnostic): string | null {
  const { hoursSinceLastActivity } = diagnostic;
  if (hoursSinceLastActivity === null) return "Sem atividade registrada";
  if (hoursSinceLastActivity < ATIVIDADE_OVERDUE_HOURS) return null;

  const days = Math.floor(hoursSinceLastActivity / 24);
  if (days < 3) return `Sem atividade há ${ATIVIDADE_OVERDUE_HOURS} horas`;
  return `Sem atividade há ${days} dias`;
}

// ---------------------------------------------------------------------------
// Agregado por cliente — o formato único que qualquer tela (Operação,
// Dashboard, Prontuário) deve consumir desde agora em diante, em vez de
// montar sua própria combinação de CPA/Investimento/Pendências/Atividade.
// ---------------------------------------------------------------------------

export interface ClientDiagnosticsInput {
  cpa: { costPerResult: number | null; targetCostPerResult: number | null };
  investment: { actualSpend: number; expectedToDate: number | null };
  pendencias: { openTasksCount: number };
  atividade: { lastActivityAt: string | null; hoursSinceLastActivity: number | null };
}

export interface ClientDiagnostics {
  cpa: MetricDiagnostic | null;
  investment: MetricDiagnostic;
  pendencias: PendenciasDiagnostic;
  atividade: AtividadeDiagnostic;
}

export function evaluateClientDiagnostics(input: ClientDiagnosticsInput): ClientDiagnostics {
  return {
    cpa: evaluateCpaDiagnostic(input.cpa.costPerResult, input.cpa.targetCostPerResult),
    investment: evaluateInvestmentDiagnostic(input.investment.actualSpend, input.investment.expectedToDate),
    pendencias: evaluatePendencias(input.pendencias),
    atividade: evaluateAtividade(input.atividade),
  };
}

/** Os motivos de atenção da Operação (Etapa "Novo Conceito de
 * Monitoramento Operacional") — nunca "Saudável"/"Atenção"/"Crítico"
 * genéricos: cada filtro responde por um fato objetivo específico. Uma
 * tela de filtro consome só isto, nunca reimplementa os limites acima.
 * `atividade` já está pronto no motor, mesmo que nenhuma tela ainda o use
 * como filtro. */
export type ClientDiagnosticFilter = "cpa" | "investimento" | "pendencias" | "atividade";

export function getActiveDiagnosticFilters(diagnostics: ClientDiagnostics): ClientDiagnosticFilter[] {
  const active: ClientDiagnosticFilter[] = [];
  if (diagnostics.cpa?.isOutOfRange) active.push("cpa");
  if (diagnostics.investment.isOutOfRange) active.push("investimento");
  if (diagnostics.pendencias.hasPendencias) active.push("pendencias");
  if (diagnostics.atividade.isOverdue) active.push("atividade");
  return active;
}
