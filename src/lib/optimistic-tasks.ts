"use client";

import { useOptimisticList } from "./optimistic-list";
import type { TaskListItem } from "@/app/clients/task-row";

export type OptimisticTaskAction =
  | { type: "complete"; taskId: string }
  | { type: "delete"; taskId: string }
  | { type: "create"; task: TaskListItem };

/**
 * Etapa "Instant Action & Context Memory 1.0" (Partes 2-5) — decide como a
 * lista de tarefas de uma Sprint reage otimisticamente a "concluir"/
 * "excluir", ANTES do servidor confirmar.
 *
 * Etapa "MITZA Interaction Engine v1.5": a mecânica de "trocar um campo"/
 * "remover um item" deixou de ser reimplementada aqui — agora é só a
 * instância deste domínio (tarefas) sobre o primitivo genérico
 * `useOptimisticList` (`src/lib/optimistic-list.ts`), que qualquer lista
 * otimista futura da plataforma reaproveita sem duplicar o reducer. A
 * assinatura pública (`useOptimisticTasks(tasks)` devolvendo
 * `[optimisticTasks, dispatch]`, `dispatch` aceitando
 * `{type: "complete"|"delete", taskId}`) não mudou — `ActivitySection`
 * (antes `SprintTaskList`) continua chamando exatamente como antes.
 *
 * "complete" só troca `status` — nunca reordena (`orderTasks`, em
 * `task-list.tsx`, ordena por `due_date`/`id`, nunca por status, então a
 * tarefa concluída não pula de posição — regra "não mover a tarefa após
 * conclusão"). "delete" remove o item inteiro — a mesma ordenação estável
 * garante que, se o servidor rejeitar e o rollback automático do
 * `useOptimistic` trouxer o item de volta (porque o estado base — os
 * `tasks` vindos do servidor — nunca mudou), ele reaparece exatamente na
 * mesma posição de antes, sem precisar guardar o índice original à parte.
 *
 * "create" (Etapa "MITZA Workspace-First Tasks 1.0") insere um item com id
 * temporário ANTES do servidor confirmar — usa o primitivo "insert" de
 * `useOptimisticList` que já existia, preparado exatamente pra isto, mas
 * nunca tinha sido consumido até esta etapa. Quando a criação real
 * responde, `revalidatePath` traz a lista real (com o id definitivo) e o
 * `useOptimistic` descarta sozinho o item temporário — nenhuma reconciliação
 * manual de id é necessária.
 */
export function useOptimisticTasks(tasks: TaskListItem[]) {
  const [optimisticTasks, dispatch] = useOptimisticList(tasks);

  function dispatchOptimisticTask(action: OptimisticTaskAction) {
    if (action.type === "complete") {
      dispatch({ type: "patch", id: action.taskId, patch: { status: "feito" } });
    } else if (action.type === "delete") {
      dispatch({ type: "remove", id: action.taskId });
    } else {
      dispatch({ type: "insert", item: action.task });
    }
  }

  return [optimisticTasks, dispatchOptimisticTask] as const;
}
