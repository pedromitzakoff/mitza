# Changelog

## Objetivo do documento

Registrar cronologicamente as mudanças relevantes do sistema, de forma
legível por qualquer pessoa — não só por quem desenvolve. Complementar ao
`ROADMAP.md` (que descreve o que vem a seguir): este documento é sempre
sobre o que já foi entregue.

## Como deve ser utilizado

Consultado para entender o que mudou no sistema entre períodos ou
entregas. Cada entrada nova é adicionada ao topo (mudança mais recente
primeiro), seguindo o formato do capítulo 2 — nunca reescrevendo ou
removendo entradas antigas.

## Quem deve atualizá-lo

Quem implementa a mudança (dev ou agente responsável pela etapa).

## Quando deve ser atualizado

A cada etapa ou entrega concluída que afete o comportamento do sistema
para quem usa a Mitza (gestor ou admin) — mudanças puramente internas sem
efeito observável não precisam de entrada.

---

## Estrutura de capítulos

### 1. Não lançado

- **Sprints — tarefas e otimizações no card fechado do cliente, e
  otimizações direto na tela Sprints.** O card fechado de cada cliente na
  tela Sprints agora mostra também quantas tarefas estão pendentes/
  concluídas e quantas otimizações foram registradas no período — antes
  isso só aparecia ao expandir até a sprint. A ação "+ Registrar
  otimização" (antes só disponível na página do cliente) passou a existir
  também direto na tela Sprints, nas visões "Sprint atual" e "Mensal > Por
  sprints", sem precisar sair da tela. Nenhuma regra financeira ou de
  prioridade foi alterada. Ver Decisão 009 em `DECISIONS.md`.

### 2. Formato das entradas

Cada entrada nova é um item de lista, em linguagem simples (sem jargão
técnico ou nomes de arquivo), descrevendo o que mudou do ponto de vista de
quem usa a Mitza — não como foi implementado. Quando a mudança vier de uma
decisão registrada em `DECISIONS.md`, referenciar o número da decisão no
final da entrada.

Ao lançar (deploy) o que está em "Não lançado", mover as entradas desse
capítulo para o topo do capítulo "Histórico", com a data do lançamento.

### 3. Histórico
