/**
 * Motor de triagem da tela Operação — conceito NOVO, não uma evolução da
 * Sprint. A Sprint organizava trabalho; isto organiza atenção. Nenhuma
 * função aqui depende de `sprints`, `sprint_id` ou de qualquer módulo sob
 * `app/sprints/` ou `app/operation/operation-data.ts` (o motor da Sprint) —
 * pipeline de dados 100% próprio, pra a Operação poder evoluir sem
 * carregar a Sprint junto (e pra a Sprint poder ser removida, na Etapa 5,
 * sem quebrar nada aqui).
 *
 * IMPORTANTE — fronteira desta etapa: o "score" numérico interno
 * (`computeInterimTriageScore`) é uma implementação PROVISÓRIA só pra
 * ordenar a fila e decidir a banda. Ele nunca deve ser exposto na UI (nada
 * de "32/100", nada de barra de progresso de saúde) — o que o usuário vê é
 * só a banda (linguagem natural) e o motivo (protagonista da linha). A
 * fórmula/pesos abaixo são deliberadamente simples; a Etapa 4 substitui
 * este arquivo inteiro por uma lógica de priorização de verdade (que pode
 * considerar contexto operacional, não só severidade de alerta) sem que
 * nenhum componente de UI precise mudar — a única coisa que UI consome é
 * `OperationTriageClient.band` e `.reasons`.
 */

export type OperationTriageBand = "precisa_atencao" | "em_risco" | "em_acompanhamento" | "saudavel";

export const OPERATION_TRIAGE_BAND_ORDER: OperationTriageBand[] = [
  "precisa_atencao",
  "em_risco",
  "em_acompanhamento",
  "saudavel",
];

interface WeightedReason {
  text: string;
  weight: number;
}

/** Cada dimensão contribui, no máximo, UM motivo — nunca uma variação por
 * sub-regra (mesma disciplina de `client-priority.ts`: 2 tipos, não 9). */
export interface OperationTriageSignals {
  /** Custo por resultado (CPA/CPL) acima da meta, em fração (0.35 = 35%
   * acima) — `null` quando não há meta configurada, sem resultado
   * confiável, ou dentro da meta (nunca um motivo nesses casos). */
  costAboveTargetFraction: number | null;
  costMetricLabel: string;
  /** Dias corridos desde a última `account_reviews.reviewed_at` — `null`
   * quando o cliente nunca teve nenhuma revisão registrada (motivo mais
   * grave que "atrasada", nunca confundido com ele). */
  reviewDaysAgo: number | null;
  /** Dias úteis desde a última atividade operacional relevante —
   * `null` = nunca houve nenhuma (mesma semântica de `clientInactivityBusinessDays`
   * em `attention-alerts.ts`). */
  inactivityBusinessDays: number | null;
  overdueTasksCount: number;
  /** Variação do investimento do mês (até hoje) vs. mesmo intervalo de
   * dias do mês anterior — fração (0.18 = 18% a mais). `null` sem dado
   * suficiente num dos dois períodos. */
  monthSpendDeltaFraction: number | null;
}

const REVIEW_STALE_AFTER_DAYS = 10;
const INACTIVITY_ATENCAO_WEIGHT = 15;
const INACTIVITY_INATIVO_WEIGHT = 25;
const SPEND_DELTA_THRESHOLD = 0.2;

function formatPercent(fraction: number): string {
  return `${Math.round(Math.abs(fraction) * 100)}%`;
}

/** Motivos ordenados por peso (o [0] é sempre o protagonista da linha) —
 * nunca mais que 5 (uma por dimensão), nunca duplicando a mesma dimensão. */
export function buildOperationTriageReasons(signals: OperationTriageSignals): WeightedReason[] {
  const reasons: WeightedReason[] = [];

  if (signals.costAboveTargetFraction !== null) {
    reasons.push({
      weight: 35,
      text: `${signals.costMetricLabel} acima da meta em ${formatPercent(signals.costAboveTargetFraction)}`,
    });
  }

  if (signals.reviewDaysAgo === null) {
    reasons.push({ weight: 30, text: "Nenhuma revisão registrada ainda" });
  } else if (signals.reviewDaysAgo > REVIEW_STALE_AFTER_DAYS) {
    reasons.push({ weight: 25, text: `Revisão atrasada há ${signals.reviewDaysAgo} dias` });
  }

  if (signals.inactivityBusinessDays === null) {
    reasons.push({ weight: INACTIVITY_INATIVO_WEIGHT, text: "Nunca houve atividade operacional registrada" });
  } else if (signals.inactivityBusinessDays > 5) {
    reasons.push({
      weight: INACTIVITY_INATIVO_WEIGHT,
      text: `Sem atividade operacional há ${signals.inactivityBusinessDays} dias úteis`,
    });
  } else if (signals.inactivityBusinessDays >= 3) {
    reasons.push({
      weight: INACTIVITY_ATENCAO_WEIGHT,
      text: `Sem atividade operacional há ${signals.inactivityBusinessDays} dias úteis`,
    });
  }

  if (signals.overdueTasksCount > 0) {
    const plural = signals.overdueTasksCount > 1 ? "s" : "";
    reasons.push({
      weight: Math.min(10 + signals.overdueTasksCount * 2, 20),
      text: `${signals.overdueTasksCount} tarefa${plural} atrasada${plural}`,
    });
  }

  if (signals.monthSpendDeltaFraction !== null && Math.abs(signals.monthSpendDeltaFraction) > SPEND_DELTA_THRESHOLD) {
    const direction = signals.monthSpendDeltaFraction > 0 ? "subiu" : "caiu";
    reasons.push({
      weight: 12,
      text: `Investimento ${direction} ${formatPercent(signals.monthSpendDeltaFraction)} vs. mês anterior`,
    });
  }

  return reasons.sort((a, b) => b.weight - a.weight);
}

/** PROVISÓRIO (ver cabeçalho do arquivo) — nunca renderizado na UI. */
export function computeInterimTriageScore(reasons: WeightedReason[]): number {
  const deducted = reasons.reduce((sum, reason) => sum + reason.weight, 0);
  return Math.max(0, Math.min(100, 100 - deducted));
}

export function bandFromInterimScore(score: number): OperationTriageBand {
  if (score >= 80) return "saudavel";
  if (score >= 60) return "em_acompanhamento";
  if (score >= 40) return "em_risco";
  return "precisa_atencao";
}

export interface OperationTriageClient {
  clientId: string;
  clientName: string;
  managerName: string | null;
  band: OperationTriageBand;
  /** Já ordenados por importância — `reasons[0]` é o protagonista da
   * linha (seção 4 do pedido). Vazio quando nenhum sinal disparou. */
  reasons: string[];
  monthSpend: number;
  monthSpendDeltaFraction: number | null;
  reviewDaysAgo: number | null;
  overdueTasksCount: number;
}

/** Monta o registro final de UM cliente a partir dos sinais brutos — a
 * única função que a camada de dados (`operation-triage-data.ts`) precisa
 * chamar. O score interno nunca sai desta função. */
export function buildOperationTriageClient(input: {
  clientId: string;
  clientName: string;
  managerName: string | null;
  monthSpend: number;
  signals: OperationTriageSignals;
}): OperationTriageClient {
  const weightedReasons = buildOperationTriageReasons(input.signals);
  const score = computeInterimTriageScore(weightedReasons);

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    managerName: input.managerName,
    band: bandFromInterimScore(score),
    reasons: weightedReasons.map((reason) => reason.text),
    monthSpend: input.monthSpend,
    monthSpendDeltaFraction: input.signals.monthSpendDeltaFraction,
    reviewDaysAgo: input.signals.reviewDaysAgo,
    overdueTasksCount: input.signals.overdueTasksCount,
  };
}

const BAND_SEVERITY_RANK: Record<OperationTriageBand, number> = {
  precisa_atencao: 0,
  em_risco: 1,
  em_acompanhamento: 2,
  saudavel: 3,
};

/** Ordenação da fila inteira: banda primeiro (mais severa primeiro),
 * depois nome — determinístico, sem depender do score fora desta função. */
export function sortOperationTriageClients(clients: OperationTriageClient[]): OperationTriageClient[] {
  return [...clients].sort((a, b) => {
    const bandDiff = BAND_SEVERITY_RANK[a.band] - BAND_SEVERITY_RANK[b.band];
    if (bandDiff !== 0) return bandDiff;
    return a.clientName.localeCompare(b.clientName);
  });
}

export function countOperationTriageBands(clients: OperationTriageClient[]): Record<OperationTriageBand, number> {
  const counts: Record<OperationTriageBand, number> = {
    precisa_atencao: 0,
    em_risco: 0,
    em_acompanhamento: 0,
    saudavel: 0,
  };
  for (const client of clients) counts[client.band]++;
  return counts;
}

/** Desloca um parâmetro de mês (`YYYY-MM-01`) em N meses — helper local e
 * mínimo (não importa de `lib/sprint-financials.ts`, que é código da
 * Sprint) só pra navegação do seletor de período desta tela. */
export function shiftOperationMonth(monthParam: string, deltaMonths: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Dois intervalos do mesmo tamanho (em dias) — mês selecionado até o dia
 * de corte, e o intervalo equivalente do mês anterior — pra "Investimento
 * (mês) vs. mês anterior" nunca comparar um mês parcial com um mês
 * inteiro (o que sempre pareceria uma queda enorme). Se o mês selecionado
 * já terminou, o corte é o próprio último dia dele (mês inteiro contra
 * mês inteiro). Puro — recebe `today` de fora, nunca lê o relógio.
 */
export function computeComparableSpendRanges(
  monthParam: string,
  today: Date,
): { current: { start: string; end: string }; previous: { start: string; end: string } } {
  const [year, month] = monthParam.split("-").map(Number);
  const todayParam = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const isCurrentMonth = monthParam === todayParam;
  const lastDayOfMonth = daysInMonth(year, month);
  const cutoffDay = isCurrentMonth ? today.getUTCDate() : lastDayOfMonth;

  const currentStart = monthParam;
  const currentEnd = addDays(monthParam, cutoffDay - 1);

  const previousStart = shiftOperationMonth(monthParam, -1);
  const [prevYear, prevMonth] = previousStart.split("-").map(Number);
  const previousCutoffDay = Math.min(cutoffDay, daysInMonth(prevYear, prevMonth));
  const previousEnd = addDays(previousStart, previousCutoffDay - 1);

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}
