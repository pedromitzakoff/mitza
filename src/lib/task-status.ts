import type { TaskStatus } from "@/lib/supabase/database.types";

/**
 * Status efetivo de uma tarefa, calculado na consulta (sem job separado):
 * "feito" é o único status que fica gravado como tal; "atrasado" é
 * derivado comparando due_date com hoje sempre que ainda está "pendente".
 */
export function effectiveTaskStatus(
  task: { status: TaskStatus; due_date: string },
  today: Date = new Date(),
): TaskStatus {
  if (task.status === "feito") return "feito";

  const due = new Date(`${task.due_date}T00:00:00Z`);
  const todayDateOnly = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);

  return due < todayDateOnly ? "atrasado" : "pendente";
}
