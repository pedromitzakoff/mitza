import type { TaskStatus } from "@/lib/supabase/database.types";
import { todayUTC } from "@/lib/today";

/**
 * Status efetivo de uma tarefa, calculado na consulta (sem job separado):
 * "feito" é o único status que fica gravado como tal; "atrasado" é
 * derivado comparando due_date com hoje (no fuso da agência) sempre que
 * ainda está "pendente".
 */
export function effectiveTaskStatus(
  task: { status: TaskStatus; due_date: string },
  today: Date = todayUTC(),
): TaskStatus {
  if (task.status === "feito") return "feito";

  const due = new Date(`${task.due_date}T00:00:00Z`);

  return due < today ? "atrasado" : "pendente";
}
