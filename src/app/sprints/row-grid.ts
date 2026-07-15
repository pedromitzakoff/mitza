/**
 * Template de colunas compartilhado entre a linha do cliente
 * (`AccountCardSummary`) e a linha da sprint filha (`SprintCard`, modo
 * `flat`) — Sprint UX 2.0 Fase 3 (aproximação de UX/densidade, sem alterar
 * nenhuma regra de negócio).
 *
 * O motivo de existir: a referência visual analisada mostra que Cliente e
 * Sprint usam exatamente as MESMAS colunas, na MESMA posição horizontal —
 * é isso que faz a hierarquia parecer uma única árvore contínua (a sprint é
 * "mais uma linha da mesma tabela", não um bloco visual diferente). Se cada
 * nível tivesse sua própria largura de coluna, a leitura horizontal (bater o
 * olho na coluna "Status" e ver todo mundo alinhado, por exemplo) se perde.
 *
 * Ordem das colunas: caret · Cliente/Gestor (vazio na linha da sprint,
 * fica só a indentação) · Período · Investimento (realizado/planejado + %
 * + barra) · Tarefas (concluídas/total) · Otimizações · Status.
 */
export const ROW_GRID_CLASSES =
  "hidden sm:grid sm:grid-cols-[16px_minmax(0,1.4fr)_84px_minmax(0,1.3fr)_84px_76px_104px] sm:items-center sm:gap-x-2.5";
