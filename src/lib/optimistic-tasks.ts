"use client";

import { useOptimistic } from "react";
import type { TaskListItem } from "@/app/clients/task-row";

export type OptimisticTaskAction =
  | { type: "complete"; taskId: string }
  | { type: "delete"; taskId: string };

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 2-5) — reducer puro
 * que decide como a lista de tarefas de uma Sprint reage otimisticamente a
 * "concluir"/"excluir", ANTES do servidor confirmar. Fica fora de qualquer
 * componente pra ser testável isoladamente e pra não duplicar a mesma
 * lógica entre quem a chama.
 *
 * "complete" só troca `status` — nunca reordena (`orderTasks`, em
 * `task-list.tsx`, ordena por `due_date`/`id`, nunca por status, então a
 * tarefa concluída não pula de posição — regra "não mover a tarefa após
 * conclusão" da Parte 2). "delete" remove o item inteiro — a mesma
 * ordenação estável garante que, se o servidor rejeitar e o rollback
 * automático do `useOptimistic` trouxer o item de volta (porque o estado
 * base — os `tasks` vindos do servidor — nunca mudou), ele reaparece
 * exatamente na mesma posição de antes (Parte 3: "recolocar a tarefa na
 * posição original"), sem precisar guardar o índice original à parte.
 */
function tasksOptimisticReducer(state: TaskListItem[], action: OptimisticTaskAction): TaskListItem[] {
  switch (action.type) {
    case "complete":
      return state.map((task) => (task.id === action.taskId ? { ...task, status: "feito" } : task));
    case "delete":
      return state.filter((task) => task.id !== action.taskId);
  }
}

/**
 * `useOptimistic` reverte sozinho pro estado real (`tasks`, o primeiro
 * argumento) assim que a transition que chamou `dispatch` termina, SE os
 * `tasks` vindos do servidor não mudaram nesse meio-tempo — é exatamente
 * esse comportamento nativo do hook que dá o rollback automático em caso de
 * erro (Parte 5 "servidor continua sendo a fonte definitiva"): a action
 * (`completeTaskAction`/`deleteTaskAction`) só chama `revalidatePath` em
 * caso de sucesso, então uma falha nunca atualiza os `tasks` reais, e a
 * lista otimista cai de volta pro estado anterior sozinha.
 */
export function useOptimisticTasks(tasks: TaskListItem[]) {
  return useOptimistic(tasks, tasksOptimisticReducer);
}
