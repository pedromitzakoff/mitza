# Unified Activities — Correção do Modelo de Criação

Corrige um erro conceitual introduzido em "Unified Activities 1.0": a fila
"Atividades" tratava criação de tarefa e registro de revisão como duas
formas equivalentes de "adicionar uma atividade" (botões "+ Nova tarefa" e
"+ Registrar revisão" lado a lado). A definição correta: **Atividades é
uma camada de LEITURA/histórico, não uma entidade única de criação.**

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

**Decisão de menor risco**: criar um composer novo, pequeno e sem estado
complexo (só título) que chama a MESMA Server Action de sempre; mover
"+ Registrar revisão" para dentro de Performance sem tocar
`RecordAccountReviewDrawer`/`recordAccountReviewAction`; continuar
reaproveitando o drawer já existente para configuração posterior (em vez
de construir uma expansão inline nova, que seria a única peça
genuinamente nova de UI e o maior risco desta correção).

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

### 4. Configuração posterior
Nenhuma mudança — o drawer de tarefa (`TaskDrawerPanel`/
`InlineEditTaskForm`), já reaproveitado por toda a plataforma, continua
sendo o lugar onde responsável/data/tipo/notas são ajustados depois da
criação rápida. Ver "Limitações" sobre a leitura literal de "sem abrir
outra janela".

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
lado a lado; existe o composer inline; Enter cria; nenhuma janela abre; a
atividade aparece imediatamente (otimista); configurações continuam
disponíveis depois, no drawer oficial da tarefa.

Na seção Performance: existe "+ Registrar revisão"; revisões registradas
continuam aparecendo na fila de Atividades pelo mesmo adapter de sempre.

## Arquivos alterados

- **Novo:** `src/app/clients/activity-composer.tsx`.
- **Modificados:** `src/app/clients/activity-section.tsx` (remove os 2
  CTAs, adiciona o composer), `src/app/clients/sprint-card.tsx`
  (`SprintPerformanceSection` ganha `newReviewHref`/CTA; remove
  `taskManagers` morto de `SprintCard`/`SprintCardBody`),
  `src/app/clients/inline-task-form.tsx` (reverte `triggerLabel`, sem
  chamador), `src/app/sprints/current-client-group.tsx`,
  `src/app/sprints/monthly-sprints-group.tsx`, `src/app/sprints/page.tsx`,
  `src/app/clients/[id]/page.tsx` (removem a prop `managers`/`taskManagers`
  agora morta, sem tocar o restante do uso de `gestores`/`managers` nesses
  arquivos).

## Decisões e limitações

- **"Não abrir outra janela" (Parte 2) — leitura adotada**: interpretei
  isso como aplicável à CRIAÇÃO inicial (Parte 1, onde é explícito e
  taxativo). Para configuração POSTERIOR, mantive o drawer de tarefa já
  existente (`TaskDrawerPanel`) em vez de construir uma expansão inline
  nova dentro da própria linha — não existe hoje nenhum precedente desse
  padrão na plataforma, e criar um do zero seria a peça de maior risco
  desta correção, contrariando a própria orientação final do pedido
  ("audite... componentes de edição [existentes], para propor a alteração
  de menor risco"). Registrado como candidato de V2 caso o produto valide
  que o drawer não é suficiente.
- Nenhuma tabela, Server Action ou regra de recorrência/conclusão/
  permissão foi alterada.
- Sem suíte de testes automatizada no repositório.

## Validação técnica

- `npx tsc --noEmit`: limpo.
- `npx eslint`: limpo (o aviso `taskManagers` unused, que apareceu durante
  o desenvolvimento, foi resolvido removendo a prop morta em cascata, não
  suprimido).
- `npm run build`: limpo, todas as rotas geradas normalmente.
