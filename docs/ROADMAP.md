# Roadmap

## Objetivo do documento

Descrever o que já foi entregue, o que está em andamento e o que está
planejado para o futuro do sistema — uma visão de sequenciamento e
prioridade, complementar ao `CHANGELOG.md` (que registra o que já
aconteceu) e à `DECISIONS.md` (que registra o porquê de cada escolha).

## Como deve ser utilizado

Consultado antes de iniciar uma nova etapa, para entender prioridades e
sequenciamento já definidos, e para evitar propor trabalho que já está
planejado ou que conflita com uma direção já decidida.

## Quem deve atualizá-lo

O responsável pelo planejamento do produto, com apoio de quem implementa
cada etapa para manter a seção "Concluído" atualizada.

## Quando deve ser atualizado

Ao concluir uma etapa ou marco relevante, ao redefinir prioridades, ou ao
planejar uma nova fase de trabalho.

---

## Estrutura de capítulos

### 1. Concluído

### 2. Em andamento

### 3. Planejado — Curto Prazo

- **Responsável padrão do composer de Atividades por ID, não por nome.**
  Origem: etapa "Reduzir atrito da criação" (2026-07-17). Hoje
  `ActivityComposer` pré-seleciona o gestor principal do cliente
  resolvendo `primaryManagerName` por NOME contra a lista de gestores
  ativos (mesmo padrão já aceito em `TaskDrawerPanel`/`TaskRow`) — se dois
  gestores ativos tiverem o mesmo nome, a pré-seleção pode escolher o
  errado (o usuário sempre pode corrigir antes do Enter, então não é um
  bug de dados, só uma pré-seleção imprecisa). Corrigir de vez exige
  passar o `primary_manager_id` (uuid) direto, em vez do nome — hoje só
  `sprints/page.tsx` busca esse id junto do nome; `current-client-group.tsx`/
  `monthly-sprints-group.tsx`/`[id]/page.tsx` seriam ajustados pra
  repassar/buscar o id também. Aceito como está nesta etapa; registrado
  aqui a pedido do responsável de produto.

### 4. Planejado — Médio/Longo Prazo

### 5. Ideias em Avaliação (não comprometidas)
