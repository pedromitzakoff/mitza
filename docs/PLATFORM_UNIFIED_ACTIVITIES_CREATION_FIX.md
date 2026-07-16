# Unified Activities — Correção do Modelo de Criação

Corrige dois erros conceituais introduzidos em "Unified Activities 1.0".

**Primeiro** (rodada 1 desta correção): a fila "Atividades" tratava criação
de tarefa e registro de revisão como duas formas equivalentes de
"adicionar uma atividade" (botões "+ Nova tarefa" e "+ Registrar revisão"
lado a lado). A definição correta: **Atividades é uma camada de
LEITURA/histórico, não uma entidade única de criação.**

**Segundo** (rodada 2, esta revisão do relatório): a rodada 1 manteve a
configuração posterior da tarefa (responsável/data/tipo/notas) no drawer
lateral (`TaskDrawerPanel`) e classificou isso como decisão aceita/
candidato de V2. Essa leitura estava errada — "configurar na mesma tela,
sem abrir outra janela" é uma exigência central desta etapa, não
opcional. Esta revisão substitui o drawer por uma **expansão inline da
própria linha** dentro da fila de Atividades — ver "O que mudou (rodada
2)" abaixo.

---

## Auditoria do fluxo atual (antes de implementar)

- **Criação de tarefa**: `createTaskInlineAction(clientId, fields:
  TaskActionFields)` — `title`/`type`/`assigneeId`/`dueDate`/`dueTime`/
  `recurrence`/`notes`/`sprintId`, todos obrigatórios (aceitam `null` onde
  fizer sentido, nunca `undefined`). Optimistic UI via
  `useOptimisticTasks`/`useOptimisticList` (insere um `TaskListItem` com id
  temporário, reconciliado sozinho quando `revalidatePath` traz o real).
- **Edição de tarefa**: `TaskDrawerPanel` (drawer lateral, aberto por
  `task=<id>` na URL) → `InlineEditTaskForm` → `updateTaskInlineAction`.
  Já existe, já cobre responsável/data/tipo/notas — é o mecanismo de
  "adicionar detalhes depois" que este componente reaproveita, não
  recria.
- **Criação de revisão**: `RecordAccountReviewDrawer` (aberto por
  `review=new` na URL) → `recordAccountReviewAction`. Fluxo estruturado
  (motivo → resultado → otimizações/problema), sem equivalente rápido —
  nunca foi pra ser "rápido", é um registro de análise.
- **Componente de edição existente reaproveitável**: `TaskDrawerPanel`/
  `InlineEditTaskForm` já implementam exatamente "progressive disclosure"
  (cria rápido, detalha depois) — não havia necessidade de construir uma
  segunda superfície de edição inline dentro da própria linha.

**Decisão de menor risco (rodada 1)**: criar um composer novo, pequeno e
sem estado complexo (só título) que chama a MESMA Server Action de
sempre; mover "+ Registrar revisão" para dentro de Performance sem tocar
`RecordAccountReviewDrawer`/`recordAccountReviewAction`.

**Correção de rota (rodada 2)**: manter o drawer para configuração
posterior contrariava a exigência central "mesma tela, sem abrir outra
janela". A peça de menor risco pra corrigir isso não é um editor novo —
é **reaproveitar o próprio `InlineEditTaskForm`** (já usado dentro do
drawer) num modo controlado, renderizado dentro da linha em vez de dentro
de um drawer. Nenhuma validação, Server Action ou campo novo; só o
contêiner ao redor do formulário muda.

---

## O que mudou

### 1. Composer inline de criação rápida
`src/app/clients/activity-composer.tsx` (novo) — um único `<input>`,
sempre visível, placeholder "Escreva uma atividade e pressione Enter…".
Enter submete; conteúdo vazio/só espaços não cria nada; o campo limpa
imediatamente (some visualmente do usuário) e volta a ficar disponível;
em erro, o texto volta pro campo (nada se perde) e um toast explica o que
aconteceu. Sem modal, drawer ou popover. Chama `createTaskInlineAction`
com `type: "outro"`, `assigneeId: null`, `dueDate: hoje`, `dueTime: null`,
`recurrence: "nenhuma"`, `notes: null` — os mesmos padrões que
`InlineCreateTaskForm` já usava. Estado de envio (`isPending`) só desabilita
o próprio campo, nunca a seção inteira.

### 2. "+ Nova tarefa"/"+ Registrar revisão" saem do cabeçalho de Atividades
`src/app/clients/activity-section.tsx` — cabeçalho agora só tem "Atividades"
+ contador de tarefas concluídas; o composer entra logo abaixo, sempre
visível. Nenhum CTA de criação no cabeçalho.

### 3. "+ Registrar revisão" muda pra dentro de Performance
`src/app/clients/sprint-card.tsx` (`SprintPerformanceSection`) — novo
`newReviewHref?` prop; o link aparece ao lado (ou no lugar) de "Atualizar
performance", dentro do disclosure "Performance" (visível só quando o
gestor abre essa seção — coerente com "revisão é registro ligado à
análise da conta", que já vive ali). `RecordAccountReviewDrawer`/
`recordAccountReviewAction` continuam exatamente os mesmos.

### 4. Configuração posterior — expansão inline da linha (rodada 2)
A versão original desta correção manteve o drawer de tarefa
(`TaskDrawerPanel`) como lugar de configuração posterior, o que
contrariava a exigência "configurados na mesma tela, sem abrir outra
janela". Substituído por uma expansão inline da própria linha:

- `src/app/clients/inline-task-form.tsx` — `InlineEditTaskForm` ganhou 3
  props opcionais: `open` (estado controlado de fora), `onOpenChange`
  (avisa o pai quando fecha) e `hideTrigger` (não renderiza o botão
  "Editar tarefa" próprio, já que quem abre/fecha agora é a linha). Sem
  essas props, o componente se comporta exatamente como antes
  (`internalOpen` local) — nenhum chamador existente foi afetado.
- `src/app/clients/task-row.tsx` — `TaskRow` ganhou `isExpanded`,
  `onToggleExpand` e `managers`. Clicar na linha (área clicável inteira,
  antes um `<Link>` pro drawer) ou em "Ver detalhes" no menu "•••" agora
  chama `onToggleExpand` em vez de navegar. Quando `isExpanded` é
  verdadeiro, a própria linha renderiza `InlineEditTaskForm` (controlado,
  `hideTrigger`) abaixo do conteúdo da linha, com os MESMOS defaults que o
  drawer já calculava (`defaultAssigneeId` resolvido por nome — limitação
  pré-existente e documentada, não nova; `defaultDueTime` omitido pelo
  mesmo motivo de sempre).
- `src/app/clients/activity-section.tsx` — `expandedTaskId` (estado no
  componente pai) garante que só uma linha fica expandida por vez em toda
  a fila de Atividades; fechar uma linha ou expandir outra usa o mesmo
  `onToggleExpand`.
- Salvar chama `updateTaskInlineAction` (a MESMA Server Action de sempre);
  sucesso ou fechar a expansão nunca navegam pra outra página — o usuário
  permanece na Sprint o tempo todo. A conclusão de tarefa continua sem
  alterar posição (regra pré-existente, intocada). Optimistic UI e
  tratamento de erro do `InlineEditTaskForm` são exatamente os mesmos já
  usados pelo drawer.
- `taskManagers`/`managers` — removido na rodada 1 (item 5, abaixo) por
  ter ficado sem uso; voltou a ser passado por `SprintCard` →
  `SprintCardBody` → `ActivitySection` → `TaskRow`, agora alimentando o
  select de responsável da expansão inline (motivo diferente do original,
  mesmo dado).
- **O drawer antigo (`TaskDrawerPanel`) continua existindo** — ainda é
  usado por outros fluxos que não passaram por esta correção (ex.: "Abrir
  tarefa" a partir de "Próxima ação" em `SprintCardBody`), mas deixou de
  ser o caminho de configuração dentro da fila de Atividades.

### 5. Limpeza de prop morta
`taskManagers`/`managers` era passado por `SprintCard`/`SprintCardBody` só
pra alimentar o formulário de criação que acabou de sair do cabeçalho de
Atividades — ficou sem uso real. Removido de `SprintCard`/`SprintCardBody`,
`current-client-group.tsx`, `monthly-sprints-group.tsx` e das 2 chamadas
em `sprints/page.tsx` (que continuam buscando `gestores` normalmente —
usado em outros lugares da mesma tela); removida também a única chamada
em `[id]/page.tsx`. O `triggerLabel` opcional adicionado à
`InlineCreateTaskForm` na etapa anterior (usado só pelo cabeçalho antigo)
voltou a ser removido — sem chamador algum agora, manter seria peso morto
de uma abordagem já substituída.

---

## Definição conceitual (Parte 4, obrigatória)

- **`ActivityItem`** (`activity.ts`) é uma união de APRESENTAÇÃO para
  leitura — decide só qual componente de linha renderizar, nunca funde
  dado ou lógica dos dois domínios.
- **`Task`** é uma entidade acionável e de criação RÁPIDA — nasce com um
  título só, pelo composer, e é configurada progressivamente depois.
- **`Account Review`** é um registro histórico — sempre criado dentro de
  Performance, nunca pelo composer, nunca "rápido" (é uma análise
  estruturada por natureza).
- As duas aparecem na mesma fila de leitura (`ActivitySection`) sem
  compartilhar fluxo de criação — a fila lê os dois; cada um nasce onde
  faz sentido nascer.

---

## Resultado

Na seção Atividades: sem botões "+ Nova tarefa"/"+ Registrar revisão"
lado a lado; existe o composer inline; Enter cria só com título; a
atividade aparece imediatamente (otimista); clicar na linha (ou "Ver
detalhes" no "•••") expande a própria linha, onde responsável, data, tipo
e demais propriedades são editados; salvar ou fechar a expansão nunca
abre drawer, modal ou outra página — o usuário permanece na Sprint;
apenas uma linha fica expandida por vez; a conclusão de tarefa não altera
a posição.

Na seção Performance: existe "+ Registrar revisão"; revisões registradas
continuam aparecendo na fila de Atividades pelo mesmo adapter de sempre.

## Arquivos alterados

- **Novo:** `src/app/clients/activity-composer.tsx`.
- **Modificados:**
  - `src/app/clients/activity-section.tsx` — remove os 2 CTAs, adiciona o
    composer (rodada 1); adiciona `expandedTaskId` e repassa
    `managers`/`isExpanded`/`onToggleExpand` pra `TaskRow` (rodada 2).
  - `src/app/clients/task-row.tsx` — adiciona `notes` a `TaskListItem`;
    `TaskRow`/`TaskRowMenu` ganham expansão inline reaproveitando
    `InlineEditTaskForm` (rodada 2).
  - `src/app/clients/inline-task-form.tsx` — reverte `triggerLabel` sem
    chamador (rodada 1); `InlineEditTaskForm` ganha modo controlado
    (`open`/`onOpenChange`/`hideTrigger`) pra ser usado dentro da linha
    (rodada 2).
  - `src/app/clients/sprint-card.tsx` — `SprintPerformanceSection` ganha
    `newReviewHref`/CTA (rodada 1); remove e depois re-adiciona
    `taskManagers` em `SprintCard`/`SprintCardBody`, agora alimentando a
    expansão inline em vez do formulário de criação removido (rodada 1 e
    2).
  - `src/app/sprints/current-client-group.tsx`,
    `src/app/sprints/monthly-sprints-group.tsx`, `src/app/sprints/page.tsx`,
    `src/app/clients/[id]/page.tsx` — mesma remoção/re-adição de
    `managers`/`taskManagers` (rodada 1 e 2), sem tocar o restante do uso
    de `gestores`/`managers` nesses arquivos.

## Decisões e limitações

- **Comentários ficam inacessíveis a partir da fila de Atividades**: o
  drawer de tarefa também mostrava a thread de comentários da tarefa; a
  expansão inline não tem essa seção (o pedido desta correção lista
  explicitamente "responsável, data, tipo e demais propriedades", não
  comentários). Quem precisar comentar numa tarefa ainda pode fazê-lo por
  outro fluxo que abra o drawer (ex. "Próxima ação → Abrir tarefa"). Essa
  é uma limitação real e mais estreita do que a antiga classificação de
  "V2" — não é um adiamento de escopo, é um recorte explícito do que foi
  pedido.
- `TaskDrawerPanel` continua existindo e sendo usado por fluxos fora da
  fila de Atividades (não removido, não deprecado).
- Nenhuma tabela, Server Action ou regra de recorrência/conclusão/
  permissão foi alterada em nenhuma das duas rodadas.
- Sem suíte de testes automatizada no repositório.

## Validação técnica (rodada 2)

- `npx tsc --noEmit`: limpo.
- `npx eslint` nos arquivos alterados: limpo.
- `npm run build`: limpo, todas as 20 rotas geradas normalmente.
