import type { TaskListItem } from "./task-row";

/**
 * Ordem cronológica pura — due_date crescente, id como desempate estável.
 * O status (concluída, atrasada, hoje) não entra no critério: concluir uma
 * tarefa não deve fazer ela pular pro final da lista, só muda o visual
 * (check, cor) e as ações disponíveis, nunca a posição.
 *
 * Etapa "Critical Fix — Sprints Consolidated View": extraída de
 * `task-list.tsx`. Essa função é pura (sem hooks, sem estado), mas
 * `task-list.tsx` ganhou `"use client"` na etapa "Workspace-First Tasks"
 * (pra `TaskList` poder usar `useOptimisticTasks`) — e `orderTasks` foi
 * arrastada junto por estar no mesmo arquivo. `SprintMonthlyConsolidatedGroup`
 * (Server Component, tela Sprints > Mensal Consolidado) chama `orderTasks`
 * diretamente (não como JSX) — React Server Components não permite invocar
 * uma função exportada de um módulo `"use client"` a partir do servidor, só
 * renderizá-la como componente. Isso quebrava a Visão Consolidada em
 * produção com "An error occurred in the Server Components render". Nenhuma
 * lógica de ordenação mudou — só o arquivo onde ela mora, agora um módulo
 * comum, seguro para qualquer Server ou Client Component importar.
 */
export function orderTasks(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
}
