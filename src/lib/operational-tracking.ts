import type { TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { effectiveTaskStatus } from "@/lib/task-status";

type TrackedTaskType = "otimizacao" | "reuniao" | "entrega_criativo";

/** Bloco "Acompanhamento operacional" da página do cliente (Etapa 51) —
 * última/próxima ocorrência de cada tipo de tarefa recorrente que já existe
 * no sistema (otimização, reunião, entrega de criativo). Nunca inventa uma
 * regra de cadência: "próxima" é só a próxima tarefa já cadastrada desse
 * tipo, não uma previsão calculada — se não houver nenhuma, o campo fica
 * `null` e a UI mostra um estado neutro em vez de adivinhar.
 */
export interface OperationalTrackingRow {
  type: TrackedTaskType;
  lastDoneDate: string | null;
  nextDueDate: string | null;
}

export function computeOperationalTracking(
  tasks: { type: TaskType; status: TaskStatus; due_date: string }[],
  today: Date,
): Record<TrackedTaskType, OperationalTrackingRow> {
  const todayStr = today.toISOString().slice(0, 10);
  const types: TrackedTaskType[] = ["otimizacao", "reuniao", "entrega_criativo"];

  const result = {} as Record<TrackedTaskType, OperationalTrackingRow>;

  for (const type of types) {
    const ofType = tasks.filter((t) => t.type === type);

    let lastDoneDate: string | null = null;
    let nextDueDate: string | null = null;

    for (const task of ofType) {
      const status = effectiveTaskStatus(task, today);
      if (status === "feito") {
        if (!lastDoneDate || task.due_date > lastDoneDate) lastDoneDate = task.due_date;
      } else if (task.due_date >= todayStr) {
        if (!nextDueDate || task.due_date < nextDueDate) nextDueDate = task.due_date;
      }
    }

    result[type] = { type, lastDoneDate, nextDueDate };
  }

  return result;
}
