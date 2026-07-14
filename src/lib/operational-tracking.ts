import type { TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { effectiveTaskStatus } from "@/lib/task-status";

type TrackedTaskType = "reuniao" | "entrega_criativo";

/** Bloco "Acompanhamento operacional" da página do cliente (Etapa 51,
 * ajustado na Etapa 54 e 57) — última/próxima ocorrência de cada tipo de
 * tarefa recorrente que já existe no sistema (reunião, entrega de
 * criativo). "Otimização" saiu deste tracker na Etapa 57: virou Análise da
 * Conta (account_reviews/account_optimizations), com cadência configurável
 * própria — ver `lib/account-review-cadence.ts` e
 * `account-review-cadence-panel.tsx`, exibido ao lado deste painel. Nunca
 * inventa uma regra de cadência pros dois tipos que sobraram aqui: "próxima"
 * é só a próxima tarefa já cadastrada desse tipo, não uma previsão
 * calculada. Uma tarefa ATRASADA desse tipo sempre vence sobre uma futura
 * como "próxima" — do contrário uma reunião vencida e nunca reagendada
 * ficaria invisível aqui (nem "última", que exige status feito, nem
 * "próxima", que antes só olhava due_date >= hoje). `nextIsOverdue` deixa a
 * UI destacar esse caso. */
export interface OperationalTrackingRow {
  type: TrackedTaskType;
  lastDoneDate: string | null;
  nextDueDate: string | null;
  /** Horário opcional da próxima ocorrência (só reuniões costumam usar —
   * Etapa 62, seção 3: "18/07 às 14h"). null quando não informado. */
  nextDueTime: string | null;
  nextIsOverdue: boolean;
  /** id da tarefa "próxima" (pendente ou atrasada) — usado pra montar os
   * links/ações (editar, marcar como realizada/não realizada). null quando
   * não há nenhuma ocorrência pendente desse tipo. */
  nextTaskId: string | null;
}

export function computeOperationalTracking(
  tasks: { id: string; type: TaskType; status: TaskStatus; due_date: string; due_time?: string | null }[],
  today: Date,
): Record<TrackedTaskType, OperationalTrackingRow> {
  const types: TrackedTaskType[] = ["reuniao", "entrega_criativo"];

  const result = {} as Record<TrackedTaskType, OperationalTrackingRow>;

  for (const type of types) {
    const ofType = tasks.filter((t) => t.type === type);

    let lastDoneDate: string | null = null;
    let nextDueDate: string | null = null;
    let nextDueTime: string | null = null;
    let nextIsOverdue = false;
    let nextTaskId: string | null = null;

    for (const task of ofType) {
      const status = effectiveTaskStatus(task, today);
      // "não realizado" é terminal igual "feito" — nunca candidata a
      // "próxima" — mas não conta como lastDoneDate (não aconteceu).
      if (status === "feito" || status === "nao_realizado") {
        if (status === "feito" && (!lastDoneDate || task.due_date > lastDoneDate)) lastDoneDate = task.due_date;
        continue;
      }

      const isOverdue = status === "atrasado";
      const beatsCurrent =
        nextDueDate === null ||
        (isOverdue && !nextIsOverdue) ||
        (isOverdue === nextIsOverdue && task.due_date < nextDueDate);

      if (beatsCurrent) {
        nextDueDate = task.due_date;
        nextDueTime = task.due_time ?? null;
        nextIsOverdue = isOverdue;
        nextTaskId = task.id;
      }
    }

    result[type] = { type, lastDoneDate, nextDueDate, nextDueTime, nextIsOverdue, nextTaskId };
  }

  return result;
}

/** Resumo de reuniões/entregas de um tipo dentro de um mês específico —
 * usado quando o mês selecionado NÃO é o atual (Etapa 8 do pedido): nesse
 * caso a página não mostra "próxima" (não faz sentido pra um mês já
 * fechado ou ainda não chegado), só o resultado objetivo do que aconteceu
 * naquele período — quantas ocorrências foram realizadas, quantas não
 * foram, e quantas ainda não têm um desfecho apesar da data já ter
 * passado (não deveria acontecer num mês encerrado, mas contado à parte
 * em vez de escondido). Reaproveita `effectiveTaskStatus`, nunca duplica a
 * regra de terminalidade. */
export interface MonthlyOccurrenceSummary {
  type: TrackedTaskType;
  doneCount: number;
  notDoneCount: number;
  unresolvedCount: number;
  totalCount: number;
}

export function computeMonthlyOccurrenceSummary(
  tasks: { type: TaskType; status: TaskStatus; due_date: string }[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): Record<TrackedTaskType, MonthlyOccurrenceSummary> {
  const types: TrackedTaskType[] = ["reuniao", "entrega_criativo"];
  const result = {} as Record<TrackedTaskType, MonthlyOccurrenceSummary>;

  for (const type of types) {
    const ofTypeInMonth = tasks.filter(
      (t) => t.type === type && t.due_date >= monthRange.firstDay && t.due_date <= monthRange.lastDay,
    );

    let doneCount = 0;
    let notDoneCount = 0;
    let unresolvedCount = 0;

    for (const task of ofTypeInMonth) {
      const status = effectiveTaskStatus(task, today);
      if (status === "feito") doneCount += 1;
      else if (status === "nao_realizado") notDoneCount += 1;
      else unresolvedCount += 1;
    }

    result[type] = { type, doneCount, notDoneCount, unresolvedCount, totalCount: ofTypeInMonth.length };
  }

  return result;
}
