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
 * qualquer outro indicador quando o desvio conta. */
export function evaluateCpaDiagnostic(
  costPerResult: number | null,
  targetCostPerResult: number | null,
): MetricDiagnostic | null {
  if (costPerResult === null) return null;
  return evaluateMetricDiagnostic(costPerResult, targetCostPerResult, "increase");
}

/** Investimento — qualquer direção conta como desvio (ritmo rápido demais
 * ou devagar demais são os dois problema). Mesma régua de magnitude. */
export function evaluateInvestmentDiagnostic(actualSpend: number, expectedToDate: number | null): MetricDiagnostic {
  return evaluateMetricDiagnostic(actualSpend, expectedToDate, "any");
}

// ---------------------------------------------------------------------------
// Planejamento — não é um problema OPERACIONAL (CPA, Investimento,
// Pendências, Atividade), é um problema ESTRUTURAL: a conta ainda não tem
// as configurações mínimas pro motor conseguir diagnosticá-la de verdade.
// Deliberadamente separado dos outros eixos: sem meta de custo ou sem
// plano mensal de investimento, `evaluateCpaDiagnostic`/
// `evaluateInvestmentDiagnostic` voltam `tone: "normal"` (nenhuma base de
// comparação, nunca um "0 esperado" fabricado) — o que tornaria o
// silêncio da interface ENGANOSO sem este eixo avisando que aquela conta
// simplesmente não foi avaliada, não que foi avaliada e aprovada.
// "Nenhum alerta = nenhuma ação necessária" só é verdade quando
// Planejamento também está limpo — por isso ele nunca fica silencioso: se
// incompleto, sempre entra no filtro, mesmo que os outros quatro eixos
// não tenham nada a dizer (porque, tecnicamente, não conseguiram dizer
// nada).
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
  planejamento: { hasPerformanceGoal: boolean; targetCostPerResult: number | null; investmentPlanned: number | null };
  cpa: { costPerResult: number | null; targetCostPerResult: number | null };
  investment: { actualSpend: number; expectedToDate: number | null };
  pendencias: { openTasksCount: number };
  atividade: { lastActivityAt: string | null; hoursSinceLastActivity: number | null };
}

export interface ClientDiagnostics {
  planejamento: PlanejamentoDiagnostic;
  cpa: MetricDiagnostic | null;
  investment: MetricDiagnostic;
  pendencias: PendenciasDiagnostic;
  atividade: AtividadeDiagnostic;
}

export function evaluateClientDiagnostics(input: ClientDiagnosticsInput): ClientDiagnostics {
  return {
    planejamento: evaluatePlanejamento(input.planejamento),
    cpa: evaluateCpaDiagnostic(input.cpa.costPerResult, input.cpa.targetCostPerResult),
    investment: evaluateInvestmentDiagnostic(input.investment.actualSpend, input.investment.expectedToDate),
    pendencias: evaluatePendencias(input.pendencias),
    atividade: evaluateAtividade(input.atividade),
  };
}

/** Os motivos de atenção da Operação (Etapa "Novo Conceito de
 * Monitoramento Operacional") — nunca "Saudável"/"Atenção"/"Crítico"
 * genéricos: cada filtro responde por um fato objetivo específico.
 * `planejamento` é conceitualmente diferente dos outros quatro: não é um
 * problema operacional, é um problema estrutural (a conta ainda não pode
 * ser avaliada) — por isso vem primeiro na ordem de prioridade/leitura.
 * Uma tela de filtro consome só isto, nunca reimplementa os limites
 * acima. */
export type ClientDiagnosticFilter = "planejamento" | "cpa" | "investimento" | "pendencias" | "atividade";

export function getActiveDiagnosticFilters(diagnostics: ClientDiagnostics): ClientDiagnosticFilter[] {
  const active: ClientDiagnosticFilter[] = [];
  if (diagnostics.planejamento.isIncomplete) active.push("planejamento");
  if (diagnostics.cpa?.isOutOfRange) active.push("cpa");
  if (diagnostics.investment.isOutOfRange) active.push("investimento");
  if (diagnostics.pendencias.hasPendencias) active.push("pendencias");
  if (diagnostics.atividade.isOverdue) active.push("atividade");
  return active;
}

/** Severidade de um `MetricTone` isolado — crítico é sempre mais severo que
 * atenção, que é sempre mais severo que normal. Núcleo puro reaproveitado por
 * qualquer comparação de severidade entre diagnósticos (nunca reimplementado
 * como `tone === "critical" ? 0 : ...` solto numa tela). */
export function metricToneSeverityRank(tone: MetricTone): number {
  return tone === "critical" ? 0 : tone === "attention" ? 1 : 2;
}

/**
 * Prioridade de leitura ÚNICA entre diagnósticos ativos de um cliente —
 * fonte central de qual eixo "vence" quando mais de um está fora do
 * esperado ao mesmo tempo. Direção: Planejamento primeiro (problema
 * ESTRUTURAL, a conta nem pôde ser avaliada de verdade — mesma prioridade
 * já usada em `operation-filter-bar.tsx`), depois o mais severo entre
 * Investimento/CPA (crítico antes de atenção, pela régua de magnitude
 * acima), por último Pendências sozinha. `4` (nenhum diagnóstico ativo)
 * nunca deveria ser comparado — quem chama já filtrou por
 * `getActiveDiagnosticFilters(...).length > 0`.
 *
 * Qualquer tela que precise resumir múltiplos diagnósticos num só motivo/
 * numa fila ordenada (hoje: "Prioridades de hoje" da Visão Geral) usa esta
 * função — nunca reimplementa a ordem por conta própria. Mudar a prioridade
 * de negócio (ex.: inverter CPA e Investimento, ou mover Pendências antes
 * de CPA) é sempre uma mudança AQUI, nunca replicada em outro arquivo.
 */
export function getDiagnosticPriorityRank(diagnostics: ClientDiagnostics): number {
  if (diagnostics.planejamento.isIncomplete) return 0;

  const activeMetricTones = [
    diagnostics.investment.isOutOfRange ? diagnostics.investment.tone : null,
    diagnostics.cpa?.isOutOfRange ? diagnostics.cpa.tone : null,
  ].filter((tone): tone is MetricTone => tone !== null);

  if (activeMetricTones.some((tone) => tone === "critical")) return 1;
  if (activeMetricTones.length > 0) return 2;
  if (diagnostics.pendencias.hasPendencias) return 3;
  return 4;
}
