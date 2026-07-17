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
 * olho na coluna "Progresso" e ver todo mundo alinhado, por exemplo) se
 * perde.
 *
 * Etapa "Painel Operacional 1.0" (aproximação de UX a partir de uma segunda
 * referência visual — painel operacional denso, cliente → progresso →
 * investimento): reduzido de 6 pra 4 colunas. A situação financeira
 * (badge "No ritmo"/"Sem planejamento"/etc.) deixou de ter coluna própria —
 * agora vive DENTRO da célula de Investimento (junto do valor, já que as
 * duas informações respondem a mesma pergunta: "como está o dinheiro desta
 * conta?"). Tarefas e Otimizações (2 colunas) viraram uma só, "Progresso"
 * (barra + fração de tarefas concluídas) — a contagem de otimizações do
 * período saiu da leitura de 3 segundos: ela não muda uma decisão imediata
 * do jeito que "tem trabalho pendente?" muda, e continua disponível um
 * nível abaixo, dentro da própria Sprint (Atividades/Performance), pra quem
 * quiser investigar.
 *
 * Ordem das colunas (MITZA Operational Tables 1.0 — mesma ordem em toda a
 * plataforma, nunca muda de posição entre telas): caret · Cliente/Gestor ·
 * Investimento (realizado/planejado + situação financeira) · Progresso
 * (tarefas concluídas/total).
 *
 * O "Período" continua fora do grid — mesmo motivo de sempre (ver histórico
 * abaixo): informação global repetida em toda linha nas visões Mensais, ou
 * secundária demais na Sprint atual. A 1ª coluna (Cliente/Gestor) é
 * reaproveitada pela linha filha da sprint (`SprintCard` modo `flat`, único
 * lugar onde o período de fato diferencia elementos da lista) pra mostrar a
 * data daquela sprint específica, no lugar que ficaria vazio (só
 * indentação).
 */
export const ROW_GRID_CLASSES =
  "hidden sm:grid sm:grid-cols-[16px_minmax(0,1.5fr)_minmax(0,1.3fr)_112px] sm:items-center sm:gap-x-2.5";
