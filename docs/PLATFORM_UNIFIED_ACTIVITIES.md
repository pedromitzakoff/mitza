# MITZA Unified Activities 1.0 — One Workstream, One Mental Model

Substitui a divisão visual "Tarefas | Revisões de conta" (duas colunas lado
a lado, dois cabeçalhos, dois estados vazios) por uma única fila de
trabalho: **Atividades**. Internamente as duas entidades continuam
totalmente separadas — schemas, regras de negócio, permissões, ações e
histórico não mudaram. Só a apresentação virou uma lista.

---

## 1. Modelo mental anterior

O gestor via, dentro da Sprint, dois módulos lado a lado: "Tarefas" (com
seu próprio cabeçalho, contador "X/Y concluídas", criação inline e estado
vazio) e "Revisões de conta" (com seu próprio cabeçalho, contador "N nesta
sprint", CTA de registro e estado vazio). Para saber "o que tem pra fazer
nesta sprint", o gestor precisava olhar dois lugares e decidir sozinho
onde procurar cada tipo de trabalho.

## 2. Modelo mental novo

Um único lugar: **Atividades**. Tarefa e revisão de conta são as duas
primeiras variantes de um conceito mais amplo ("trabalho realizado ou que
precisa ser realizado na conta") — a plataforma organiza os tipos
internamente; o gestor só vê a fila.

## 3. Entidades preservadas

- **Tarefa** (`tasks`) — schema, `TaskListItem`, `effectiveTaskStatus`,
  `orderTasks`, Server Actions (`completeTaskAction`/`deleteTaskAction`/
  `createTaskInlineAction`/`updateTaskInlineAction`), optimistic UI
  (`useOptimisticTasks`/`useOptimisticList`), `TaskDrawerPanel` — nenhum
  destes mudou.
- **Revisão de conta** (`account_reviews`) — `AccountReviewSummaryItem`,
  `ACCOUNT_REVIEW_OUTCOME_LABEL`, `RecordAccountReviewDrawer`,
  `AccountReviewDetailDrawer`, `recordAccountReviewAction` — nenhum destes
  mudou.

Nenhuma tabela foi fundida. Nenhuma tabela `activities` genérica foi
criada. Nenhuma migração de dado ocorreu.

## 4. Nova seção Atividades

Um cabeçalho ("Atividades"), uma lista (`<ul>` com borda/raio), um estado
vazio. As duas ações de criação ("+ Nova tarefa"/"+ Registrar revisão")
ficam lado a lado no mesmo cabeçalho — nunca um botão genérico "Nova
atividade" com seletor de tipo (Parte 6: baixo risco antes de fluxo
unificado).

## 5. Anatomia da linha

Mantida a anatomia densa de uma linha só (já em uso por `TaskRow` e pela
antiga `AccountReviewsSection`, ambas já parecidas: marcador temporal →
título/resumo → pessoa → indicador de ação), em vez do mockup conceitual
de 2-3 linhas empilhadas da Parte 4. **Decisão auditada e documentada**: o
mockup é explicitamente "conceitual"; a plataforma já reverteu, em
etapas anteriores ("Refinamento de Densidade", "Sprint Workspace Polish"),
o padrão de linhas empilhadas em favor de linhas densas de coluna única —
reimplementar um layout de 2-3 linhas agora desfaria esse trabalho
deliberado sem necessidade, e a etapa pede explicitamente "baixo risco".
A prioridade conceitual da Parte 4 (estado → título → data → responsável →
tipo → ações) foi aplicada dentro da anatomia densa já existente: cada
linha já mostra estado (checkbox/registro), título/resumo, data,
responsável e ação — o único elemento que faltava era **tipo**, adicionado
como rótulo discreto (`typeLabel`), visível só em telas largas (`lg:`),
right antes do indicador de ação.

- `TaskRow` ganhou `typeLabel?: string` (opcional, default omitido —
  nenhum outro chamador muda).
- A antiga `AccountReviewsSection` virou `AccountReviewRow` (mesmo dado,
  mesma ação, mesmo histórico), com o mesmo `typeLabel?: string`.

## 6. Tipos exibidos

- "Tarefa" — tipo da entidade, nunca confundido com o campo `type` da
  própria tarefa (ex.: "Otimização" é um TIPO DE TAREFA, um valor de
  `tasks.type`; "Tarefa" é o TIPO DE ATIVIDADE, a entidade em si). Uma
  tarefa cujo próprio título já é "Otimização" mostra `typeLabel="Tarefa"`
  sem redundância — são dois conceitos diferentes.
- "Revisão de conta" — tipo da entidade `account_reviews`.

Nenhuma cor nova por tipo, nenhum emoji, nenhuma badge grande — texto
pequeno, maiúsculas discretas, mesmo tratamento visual dos dois.

## 7. Estratégia de ordenação

Tarefas primeiro, na mesma ordem cronológica de sempre (`orderTasks` —
`due_date` crescente, **nunca reordenada por status**). Revisões de conta
depois, na ordem em que já chegam (mais recente primeiro).

**Por que não a ordenação sugerida literalmente na Parte 5** (atrasadas →
hoje → futuras → revisões → concluídas → demais): essa ordem exigiria
separar tarefas concluídas do resto — o que violaria uma regra já
existente e deliberada (`orderTasks`: "concluir uma tarefa não deve fazer
ela pular pro final da lista", pra não causar um salto visual disruptivo
no exato momento em que o gestor confirma a conclusão, especialmente com
UI otimista). A Parte 5 pede explicitamente para não aplicar a proposta
cegamente e auditar se revisão é trabalho pendente ou registro histórico
— a conclusão da auditoria: revisão de conta é **sempre** um registro
(nunca "a fazer", mesmo sem nenhuma alteração necessária), então nunca
compete por posição com tarefas pendentes. O resultado — tarefas
(qualquer status, ordem estável) primeiro, revisões (registro) depois —
satisfaz essa regra sem quebrar o anti-salto de conclusão.

Nenhuma divisória "PENDENTES"/"HISTÓRICO RECENTE" foi adicionada: o
rótulo de tipo por linha já comunica a fronteira sem precisar de um
segundo cabeçalho dentro da mesma seção.

## 8. Estratégia de estado vazio

Um único estado: "Nenhuma atividade nesta sprint." As duas ações de
criação já vivem sempre no cabeçalho (não só no estado vazio) — repeti-las
abaixo do texto vazio duplicaria o mesmo CTA em dois lugares, o que a
Parte 7 proíbe explicitamente ("sem duplicidade").

## 9. CTAs mantidos

- "+ Nova tarefa" — mesmo `InlineCreateTaskForm`/`createTaskInlineAction`
  de sempre; só o texto do botão fechado mudou (era "+ Tarefa" — texto
  agora parametrizado via `triggerLabel`, default preservado pra "Outras
  tarefas" e qualquer outro chamador).
- "+ Registrar revisão" — mesmo `newReviewHref`/`RecordAccountReviewDrawer`
  de sempre; texto encurtado de "+ Registrar revisão de conta" pra caber
  ao lado do outro CTA no mesmo cabeçalho (a palavra "conta" já é
  redundante com o rótulo de tipo "Revisão de conta" em cada linha).
- "Próxima ação" (`SprintCardBody`) — lógica intocada, continua apontando
  pra tarefa/atualizar performance/configurar objetivo/registrar revisão,
  exatamente como antes.

## 10. Drawers reutilizados

- Tarefa → `TaskDrawerPanel` (via `detailsHref`/`task=` query param) — sem
  mudança.
- Revisão → `AccountReviewDetailDrawer` (via `buildReviewDetailHref`/
  `reviewDetail=` query param) — sem mudança.

Nenhum drawer genérico foi criado. Scroll, Sprint aberta, filtros, mês,
Context Memory, foco de retorno, toasts e permissões continuam exatamente
como antes — nenhum desses mecanismos foi tocado.

## 11. Componentes criados

- `src/app/clients/activity.ts` — `ActivityItem` (união discriminada,
  presentational-only) + `buildActivityFeed`.
- `src/app/clients/activity-section.tsx` — `ActivitySection`, absorve a
  lógica que antes vivia em `SprintTaskList` (removido — zero outros
  chamadores).

## 12. Adapters criados

`ActivityItem` em si é o adapter: `{ kind: "task"; task }` |
`{ kind: "account_review"; review }`. `ActivitySection` decide, por
`kind`, se renderiza `TaskRow` ou `AccountReviewRow` — nenhuma lógica de
tarefa ou revisão foi duplicada dentro dele; ambos os componentes
continuam sendo os componentes oficiais de cada domínio.

## 13. Telas afetadas

- Sprint Atual (`SprintCurrentClientGroup` → `SprintCardBody`).
- Mensal por Sprints (`SprintMonthlyBySprintsGroup` → `SprintCard` →
  `SprintCardBody`).
- Página individual do cliente (`[id]/page.tsx` → `SprintCard` →
  `SprintCardBody`).

Todas as três passam pelo mesmo `SprintCardBody`, então a mudança é
literalmente uma única substituição de bloco.

## 14. Mensal Consolidado: decisão tomada

**Não alterado.** `SprintMonthlyConsolidatedGroup` nunca busca nem exibe
revisões de conta — mostra só "Tarefas do mês" (lista simples, sem
optimistic UI, sem criação inline, sem `SprintCardBody`). Unificá-lo
exigiria buscar e passar dados de `account_reviews` que hoje não existem
nesse fluxo — fora do escopo desta etapa (presentation-only, sem novas
queries). Renomear o cabeçalho pra "Atividades" sem ter revisão nenhuma
pra mostrar seria só relabeling cosmético sem o ganho real da unificação.
**Limitação documentada, nada foi tocado neste arquivo.**

## 15. Permissões preservadas

`isAdmin` continua controlando exatamente as mesmas ações de sempre:
"Excluir tarefa" no menu "•••" (`TaskRowMenu`) e "Atualizar performance"/
edição de objetivo (fora do escopo desta seção). Revisão de conta nunca
teve controle de admin na leitura (abrir detalhe é público a qualquer
gestor autenticado, como sempre foi) — nada mudou.

## 16. Context Memory preservado

`ScrollRestoreOnMount`/`SprintsContextMemory` (tela Sprints) e os
mecanismos de foco de retorno (`saveFocusForReturn`) não foram tocados —
a fila unificada não introduz nenhum novo parâmetro de URL nem novo estado
de navegação; os mesmos `task=`/`reviewDetail=` de sempre continuam
controlando os drawers.

## 17. Antes e depois

**Antes:**
```
[Tarefas]                    [Revisões de conta]
X/Y concluídas   + Tarefa     N nesta sprint   + Registrar revisão de conta
──────────────                ──────────────
tarefa 1                      revisão 1
tarefa 2                      revisão 2
Nenhuma tarefa vinculada      Nenhuma otimização registrada
a esta sprint.                nesta sprint.
```

**Depois:**
```
Atividades          X/Y concluídas  + Nova tarefa  + Registrar revisão
──────────────────────────────────────────────────────────────────────
tarefa 1                                                      Tarefa
tarefa 2                                                      Tarefa
revisão 1                                              Revisão de conta
revisão 2                                              Revisão de conta
──────────────────────────────────────────────────────────────────────
(vazio) Nenhuma atividade nesta sprint.
```

## 18. Arquivos alterados

- **Novos:** `src/app/clients/activity.ts`, `src/app/clients/activity-section.tsx`.
- **Removido:** `src/app/clients/sprint-task-list.tsx` (zero chamadores
  restantes — sua lógica foi absorvida por `ActivitySection`).
- **Modificados:** `src/app/clients/account-reviews-section.tsx` (função
  `AccountReviewsSection` removida; tipo/constantes/`AccountReviewRow`
  mantidos/adicionados), `src/app/clients/task-row.tsx` (`typeLabel?`
  opcional), `src/app/clients/inline-task-form.tsx` (`triggerLabel?`
  opcional), `src/app/clients/sprint-card.tsx` (substitui o grid de duas
  colunas por `<ActivitySection>`), `src/app/clients/task-list.tsx`
  (comentário atualizado, sem mudança de comportamento), `src/lib/optimistic-tasks.ts`
  (comentário atualizado).

## 19. Limitações

- Mensal Consolidado não foi unificado — ver item 14.
- A anatomia de linha manteve o formato denso de coluna única em vez do
  mockup de 2-3 linhas da Parte 4 (decisão documentada no item 5).
- `typeLabel` só aparece em telas ≥ 1024px (`lg:`) — em telas menores, a
  fronteira entre tarefa e revisão fica só implícita (posição na lista +
  formatação do título/badge), sem rótulo textual visível. Aceito como
  baixo risco pra V1: o conteúdo de cada linha (checkbox vs. resultado de
  revisão) já é visualmente distinto o suficiente pra não gerar confusão
  real, mesmo sem o rótulo.
- Nenhum teste de usuário cronometrado foi realizado (sem navegador
  interativo neste ambiente) — validação por leitura de código, lint,
  typecheck e build.

## 20. Candidatas para Unified Activities 2.0

1. Botão único "Nova atividade" com seletor de tipo, se o produto validar
   que os dois CTAs discretos desta V1 não bastam.
2. Levar dados de revisão pra Mensal Consolidado (nova query), se fizer
   sentido de produto mostrar otimizações agregadas por mês ali também.
3. Rótulo de tipo visível também em telas médias (`md:`), se a auditoria
   de uso mostrar confusão real entre tarefa/revisão em tablets.
4. Uma "atualização de performance" ou "reunião" como tipo de atividade —
   explicitamente fora de escopo nesta V1 (regra de escopo do pedido).

---

## 21-24. Validação técnica

- **Lint:** limpo (`npx eslint` nos arquivos alterados, sem avisos).
- **Typecheck:** limpo (`npx tsc --noEmit`).
- **Build:** limpo (`npm run build`, todas as 20 rotas geradas normalmente).
- **Testes:** sem suíte automatizada no repositório (`package.json` não
  define script `test`).

Busca final (Parte 15) por resíduos da divisão antiga:
- Nenhum título paralelo "Tarefas"/"Revisões de conta" dentro da mesma
  seção da Sprint (as ocorrências restantes de "Revisões de conta" no
  código são métricas de outras telas — Relatórios, Equipe, Visão Geral,
  configuração de cadência — não a divisão de módulos auditada aqui).
- Nenhum estado vazio duplicado.
- Nenhum container "card dentro de card" novo.
- Nenhuma lógica de tarefa/revisão duplicada — `ActivitySection` só decide
  qual componente oficial renderizar.
- Nenhuma mudança em `SprintMonthlyConsolidatedGroup` (Mensal Consolidado).

## 25. Checklist visual de produção

- [ ] Sprint sem tarefas e sem revisões → "Nenhuma atividade nesta sprint."
- [ ] Sprint com tarefa, sem revisão → só tarefas na lista, sem CTA de
      revisão se `newReviewHref` não for passado (painéis que não buscam
      revisão).
- [ ] Sprint sem tarefa, com revisão → só revisões na lista.
- [ ] Sprint com tarefas e revisões → tarefas primeiro, revisões depois,
      cada uma com seu `typeLabel` (desktop largo).
- [ ] Tarefa atrasada → círculo vermelho, data vermelha, `typeLabel`
      "Tarefa".
- [ ] Tarefa de hoje → badge "Hoje", cor de marca.
- [ ] Tarefa futura → opacidade reduzida, sem badge.
- [ ] Tarefa concluída → check verde, permanece na mesma posição
      cronológica (não pula pra baixo).
- [ ] Revisão recente → aparece após todas as tarefas, ordenada por mais
      recente primeiro.
- [ ] Muitas atividades → lista rola normalmente, sem overflow quebrado.
- [ ] Criar tarefa → "+ Nova tarefa" abre formulário inline, insere
      otimisticamente na posição cronológica correta.
- [ ] Registrar revisão → "+ Registrar revisão" abre `RecordAccountReviewDrawer`
      de sempre.
- [ ] Abrir tarefa → clique na linha abre `TaskDrawerPanel`.
- [ ] Abrir revisão → clique na linha abre `AccountReviewDetailDrawer`.
- [ ] Concluir tarefa → check otimista, contador "X/Y concluídas" e barra
      de progresso atualizam juntos.
- [ ] Excluir tarefa → menu "•••" → confirmar → linha some com animação de
      saída.
- [ ] Editar tarefa → via drawer, sem regressão.
- [ ] Comentar tarefa → via drawer, sem regressão.
- [ ] Admin → vê "Excluir tarefa" no menu; vê editor de objetivo/performance
      normalmente (fora desta seção).
- [ ] Gestor (não-admin) → não vê "Excluir tarefa"; resto idêntico.
- [ ] Desktop (≥1024px) → `typeLabel` visível em cada linha.
- [ ] Mobile → sem overflow horizontal; `typeLabel` oculto (esperado).
- [ ] Sprint Atual → ordem/CTAs corretos.
- [ ] Mensal por Sprints → ordem/CTAs corretos, dentro de cada `SprintCard` filho.
- [ ] Página individual do cliente → ordem/CTAs corretos.
- [ ] Context Memory → reabrir a tela Sprints preserva sprint expandida,
      filtros e mês, sem interferência da nova seção.
- [ ] Scroll e foco → abrir/fechar drawer de tarefa ou revisão preserva a
      posição de scroll e o foco de retorno, sem regressão.
