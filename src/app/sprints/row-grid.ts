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
 * Ordem das colunas (MITZA Operational Tables 1.0 — mesma ordem em toda a
 * plataforma, nunca muda de posição entre telas): caret · Cliente/Gestor ·
 * Investimento (realizado/planejado + % + barra) · Status · Tarefas
 * (concluídas/total) · Otimizações.
 *
 * O "Período" deixou de ser coluna própria: era informação global repetida
 * em toda linha (o mês inteiro, idêntico em cada card, nas visões Mensais)
 * ou uma data secundária sem valor decisório (Sprint atual). A 1ª coluna
 * (Cliente/Gestor) é reaproveitada pela linha filha da sprint (`SprintCard`
 * modo `flat`, único lugar onde o período de fato diferencia elementos da
 * lista — cada sprint do mês tem sua própria janela) pra mostrar a data
 * daquela sprint específica, no lugar que ficaria vazio (só indentação).
 */
export const ROW_GRID_CLASSES =
  "hidden sm:grid sm:grid-cols-[16px_minmax(0,1.5fr)_minmax(0,1.3fr)_104px_76px_84px] sm:items-center sm:gap-x-2.5";
