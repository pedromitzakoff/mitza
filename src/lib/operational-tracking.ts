import type { TaskStatus, TaskType } from "@/lib/supabase/database.types";
import { effectiveTaskStatus } from "@/lib/task-status";

type TrackedTaskType = "otimizacao" | "reuniao" | "entrega_criativo";

/** Bloco "Acompanhamento operacional" da página do cliente (Etapa 51,
 * ajustado na Etapa 54) — última/próxima ocorrência de cada tipo de tarefa
 * recorrente que já existe no sistema (otimização, reunião, entrega de
 * criativo). Nunca inventa uma regra de cadência: "próxima" é só a próxima
 * tarefa já cadastrada desse tipo, não uma previsão calculada. Uma tarefa
 * ATRASADA desse tipo sempre vence sobre uma futura como "próxima" — do
 * contrário uma reunião vencida e nunca reagendada ficaria invisível aqui
 * (nem "última", que exige status feito, nem "próxima", que antes só
 * olhava due_date >= hoje). `nextIsOverdue` deixa a UI destacar esse caso. */
export interface OperationalTrackingRow {
  type: TrackedTaskType;
  lastDoneDate: string | null;
  nextDueDate: string | null;
  nextIsOverdue: boolean;
}

export function computeOperationalTracking(
  tasks: { type: TaskType; status: TaskStatus; due_date: string }[],
  today: Date,
): Record<TrackedTaskType, OperationalTrackingRow> {
  const types: TrackedTaskType[] = ["otimizacao", "reuniao", "entrega_criativo"];

  const result = {} as Record<TrackedTaskType, OperationalTrackingRow>;

  for (const type of types) {
    const ofType = tasks.filter((t) => t.type === type);

    let lastDoneDate: string | null = null;
    let nextDueDate: string | null = null;
    let nextIsOverdue = false;

    for (const task of ofType) {
      const status = effectiveTaskStatus(task, today);
      if (status === "feito") {
        if (!lastDoneDate || task.due_date > lastDoneDate) lastDoneDate = task.due_date;
        continue;
      }

      const isOverdue = status === "atrasado";
      const beatsCurrent =
        nextDueDate === null ||
        (isOverdue && !nextIsOverdue) ||
        (isOverdue === nextIsOverdue && task.due_date < nextDueDate);

      if (beatsCurrent) {
        nextDueDate = task.due_date;
        nextIsOverdue = isOverdue;
      }
    }

    result[type] = { type, lastDoneDate, nextDueDate, nextIsOverdue };
  }

  return result;
}
