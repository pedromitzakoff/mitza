import type { TaskStatus } from "@/lib/supabase/database.types";
import { todayUTC } from "@/lib/today";

/**
 * Status efetivo de uma tarefa, calculado na consulta (sem job separado):
 * "feito" e "nao_realizado" são os únicos status que ficam gravados
 * literalmente (ambos terminais — a tarefa foi resolvida, de um jeito ou de
 * outro); "atrasado" é derivado comparando due_date com hoje (no fuso da
 * agência) sempre que o status gravado ainda é não-terminal — qualquer um
 * deles (pendente/em_andamento/aguardando/bloqueado), nunca só "pendente"
 * (Etapa "Pendências": uma tarefa "Bloqueada" com prazo vencido também é
 * "Atrasada"). Sem estar vencida, o status efetivo é sempre o status
 * gravado de verdade — nunca colapsado pra "pendente" (bug corrigido nesta
 * etapa: antes de existirem status intermediários, "pendente" era o único
 * valor não-terminal possível, então colapsar não tinha efeito; agora
 * perderia "Em andamento"/"Aguardando"/"Bloqueado" silenciosamente).
 */
export function effectiveTaskStatus(
  task: { status: TaskStatus; due_date: string },
  today: Date = todayUTC(),
): TaskStatus {
  if (task.status === "feito" || task.status === "nao_realizado") return task.status;

  const due = new Date(`${task.due_date}T00:00:00Z`);
  if (due < today) return "atrasado";

  return task.status;
}
