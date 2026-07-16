"use client";

import { useOptimistic } from "react";

export type OptimisticListAction<T> =
  | { type: "patch"; id: string; patch: Partial<T> }
  | { type: "remove"; id: string }
  | { type: "insert"; item: T };

/**
 * Etapa "MITZA Interaction Engine v1.5" — generalizado a partir de
 * `optimistic-tasks.ts` (que tratava só "complete"/"delete" de tarefa).
 * Três operações cobrem todo otimismo de lista que a plataforma precisou
 * até aqui e vai precisar a seguir: mudar um campo de um item existente
 * ("concluir tarefa" = patch de status), remover um item ("excluir
 * tarefa"), ou inserir um item novo com id temporário ANTES do servidor
 * confirmar (ainda não usado — é o que "registrar otimização otimista"
 * vai precisar quando essa etapa futura acontecer). Nunca reordena por
 * conta própria: quem usa decide a ordem de exibição por fora (ver
 * `orderTasks` em `task-list.tsx`), então concluir/patchar um item nunca
 * muda sua posição.
 */
function optimisticListReducer<T extends { id: string }>(state: T[], action: OptimisticListAction<T>): T[] {
  switch (action.type) {
    case "patch":
      return state.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item));
    case "remove":
      return state.filter((item) => item.id !== action.id);
    case "insert":
      return [...state, action.item];
  }
}

/**
 * `useOptimistic` reverte sozinho pro estado real (`items`, o primeiro
 * argumento) assim que a transition que chamou o dispatch termina, SE os
 * dados reais não mudaram nesse meio-tempo — é esse comportamento nativo do
 * hook que dá o rollback automático em caso de erro (a Server Action só
 * revalida em caso de sucesso, então uma falha nunca atualiza os dados reais,
 * e a lista otimista cai de volta pro estado anterior sozinha).
 */
export function useOptimisticList<T extends { id: string }>(items: T[]) {
  return useOptimistic(items, optimisticListReducer<T>);
}
