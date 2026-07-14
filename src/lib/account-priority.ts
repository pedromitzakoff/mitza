import type { OperationClientCard } from "@/app/operation/operation-data";
import type { SpendStatus } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayUTC } from "@/lib/today";

/** Qual período está em foco na tela Sprints — "sprint" (visão Sprint atual)
 * ou "month" (Mensal, tanto Consolidado quanto Por sprints: as duas usam o
 * mesmo resumo mensal por cliente no card fechado). */
export type PriorityPeriod = "sprint" | "month";

/** Situação financeira do período em foco — nunca recalcula: escolhe entre
 * `card.sprint.status` (sprint atual) e `card.monthStatus` (mês selecionado),
 * os dois já vindos de `classifySpendStatus` central. Cliente sem sprint em
 * andamento é tratado como "sem_meta" pro período sprint (não há o que
 * classificar). */
export function financialStatusForPeriod(card: OperationClientCard, period: PriorityPeriod): SpendStatus {
  if (period === "sprint") return card.sprint?.status ?? "sem_meta";
  return card.monthStatus;
}

/** Tarefas atrasadas do período em foco — da sprint atual (`sprintTasks`)
 * quando period="sprint", ou do mês selecionado (`overdueTasks`, já filtrado
 * uma vez em `buildOperationClientCard`) quando period="month". Nunca duas
 * contagens diferentes pro mesmo rótulo "tarefas atrasadas". */
export function periodOverdueTasks(
  card: OperationClientCard,
  period: PriorityPeriod,
  today: Date = todayUTC(),
): { due_date: string }[] {
  if (period === "month") return card.overdueTasks;
  if (!card.sprint) return [];
  return card.sprintTasks.filter((t) => effectiveTaskStatus(t, today) === "atrasado");
}

export function periodOverdueCount(
  card: OperationClientCard,
  period: PriorityPeriod,
  today: Date = todayUTC(),
): number {
  return periodOverdueTasks(card, period, today).length;
}

export type OperationalTone = "critical" | "warning" | "neutral";

export interface OperationalSummary {
  text: string;
  tone: OperationalTone;
}

/**
 * Uma única informação operacional pro card fechado (Etapa 44, regra "card
 * fechado = decisão, card aberto = investigação") — nunca a lista inteira de
 * alertas, sempre o problema de maior prioridade. Não inventa nenhum sinal
 * novo: só decide, em ordem, qual dado já existente aparece primeiro —
 * tarefas atrasadas do período > sprint sem execução (só period="sprint",
 * mesma regra de `sprintFilterBucket`) > inatividade (`activityStatus`) >
 * otimização atrasada (alerta já existente, `kind: "otimizacao"`) > "Em dia".
 * A situação financeira (acima/abaixo do ritmo) tem seu próprio espaço no
 * card fechado — por isso não entra aqui de novo.
 */
export function operationalSummary(
  card: OperationClientCard,
  period: PriorityPeriod,
  today: Date = todayUTC(),
): OperationalSummary {
  const overdue = periodOverdueCount(card, period, today);
  if (overdue > 0) {
    const plural = overdue !== 1 ? "s" : "";
    return { text: `${overdue} tarefa${plural} atrasada${plural}`, tone: "critical" };
  }

  if (period === "sprint" && card.sprintFilterBucket === "sem_execucao") {
    return { text: "Sem execução", tone: card.sprintExecutionInfo?.severity === "critico" ? "critical" : "warning" };
  }

  if (card.activityStatus === "inativo") {
    return { text: "Sem atividade recente", tone: "critical" };
  }
  if (card.activityStatus === "atencao") {
    return { text: "Atenção por inatividade", tone: "warning" };
  }

  if (card.alerts.some((a) => a.kind === "otimizacao")) {
    return { text: "Sem otimização recente", tone: "warning" };
  }

  return { text: "Em dia", tone: "neutral" };
}

/**
 * Nível de prioridade da conta pro período em foco — não é um health score:
 * cada tier responde uma pergunta binária com uma regra já existente, na
 * ordem operacional pedida:
 *
 *   0 · conta crítica (`accountHealth === "critico"`, já computado em
 *       `computeAccountHealth` a partir dos alertas)
 *   1 · investimento fora do ritmo esperado (acima ou abaixo, ±20% —
 *       ver SPEND_STATUS_MARGIN)
 *   2 · tarefas atrasadas no período em foco
 *   3 · ausência de otimização recente
 *   4 · ausência de atividade operacional recente
 *   5 · dentro do esperado
 *
 * Cada tier só é avaliado se os anteriores não bateram — por isso uma conta
 * crítica nunca "pula" pra frente por também ter uma tarefa atrasada: ela já
 * parou no tier 0.
 */
export function priorityTier(
  card: OperationClientCard,
  period: PriorityPeriod,
  today: Date = todayUTC(),
): number {
  if (card.accountHealth === "critico") return 0;

  const financialStatus = financialStatusForPeriod(card, period);
  if (financialStatus === "acima" || financialStatus === "abaixo") return 1;

  if (periodOverdueCount(card, period, today) > 0) return 2;

  if (card.alerts.some((a) => a.kind === "otimizacao")) return 3;

  if (card.activityStatus !== "ativo") return 4;

  return 5;
}

/** Desempate #2 ("quantidade/severidade de pendências"): alertas críticos
 * pesam mais que os demais, tarefas atrasadas do período somam por cima —
 * não é um score exposto em lugar nenhum, só decide a ordem dentro do mesmo
 * tier. */
function severityScore(card: OperationClientCard, period: PriorityPeriod, today: Date): number {
  const criticalAlerts = card.alerts.filter((a) => a.severity === "critico").length;
  return criticalAlerts * 100 + card.alerts.length * 10 + periodOverdueCount(card, period, today);
}

/** Desempate #3 ("tempo da pendência mais antiga"): data da tarefa atrasada
 * mais antiga do período em foco — quem não tem nenhuma tarefa atrasada
 * sempre fica depois de quem tem. */
function oldestPendingKey(card: OperationClientCard, period: PriorityPeriod, today: Date): string {
  const tasks = periodOverdueTasks(card, period, today);
  if (tasks.length === 0) return "9999-99-99";
  return tasks.reduce((earliest, t) => (t.due_date < earliest ? t.due_date : earliest), tasks[0].due_date);
}

/**
 * Ordenação única da fila operacional da tela Sprints (Etapa 44) — usada
 * pelas três visões (Sprint atual, Mensal Consolidado, Mensal Por sprints),
 * sempre com o mesmo critério, só trocando `period` conforme o que está em
 * foco. Critério primário: `priorityTier` (documentado acima). Desempate,
 * nessa ordem: (1) quantidade/severidade de pendências; (2) data da
 * pendência mais antiga (mais antiga primeiro); (3) nome do cliente —
 * garante um resultado sempre determinístico, nunca dois clientes
 * empatados em ordem arbitrária.
 */
export function sortAccountsByPriority(
  cards: OperationClientCard[],
  period: PriorityPeriod,
  today: Date = todayUTC(),
): OperationClientCard[] {
  return [...cards].sort((a, b) => {
    const tierDiff = priorityTier(a, period, today) - priorityTier(b, period, today);
    if (tierDiff !== 0) return tierDiff;

    const severityDiff = severityScore(b, period, today) - severityScore(a, period, today);
    if (severityDiff !== 0) return severityDiff;

    const oldestDiff = oldestPendingKey(a, period, today).localeCompare(oldestPendingKey(b, period, today));
    if (oldestDiff !== 0) return oldestDiff;

    return a.clientName.localeCompare(b.clientName);
  });
}
