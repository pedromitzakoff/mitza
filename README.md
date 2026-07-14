# Mitza

Sistema web da agência para substituir o ClickUp: gestão de clientes,
acompanhamento financeiro por sprint semanal (planejado vs. gasto, puxado do
Meta), tarefas recorrentes e painel geral de metas do mês.

Construído em etapas (todas as 9 da ordem original já feitas — veja abaixo).
Fica como base pra continuar iterando: mais tipos de relatório, cron
automático da sync, refinamentos de UX, etc.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind
- Supabase (Postgres + Auth)
- Deploy: Vercel

## Documentação

Além deste README (setup e estrutura técnica do código), o projeto mantém
uma documentação permanente de arquitetura e filosofia de produto em
`/docs`, pra que qualquer implementação futura siga a mesma linha:

- `docs/PLATFORM_MANIFESTO.md` — visão, missão e filosofia de produto da
  Mitza (o "porquê" por trás do sistema).
- `docs/ARCHITECTURE_PRINCIPLES.md` — padrões arquiteturais e convenções
  técnicas já estabelecidos no código (o "como" construir de forma
  consistente).
- `docs/DECISIONS.md` — registro de decisões arquiteturais e de produto
  relevantes, com contexto e justificativa.
- `docs/ROADMAP.md` — o que já foi entregue, o que está em andamento e o
  que está planejado.
- `docs/CHANGELOG.md` — histórico cronológico das mudanças relevantes do
  sistema.

Cada arquivo explica, no próprio topo, seu objetivo, como deve ser usado,
quem deve atualizá-lo e quando.

## Setup

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie um projeto no [Supabase](https://supabase.com) e rode o schema:

   - Abra o SQL Editor do projeto e cole o conteúdo de `supabase/schema.sql`
     (ou use `supabase db push` apontando pra esse arquivo como migration).
   - Isso cria as tabelas `profiles`, `clients`, `client_managers`, `sprints`,
     `daily_spend`, `tasks`, `comments`, além da função que gera
     automaticamente as sprints (blocos de 7 dias) de um cliente novo.

3. Rode `supabase/policies.sql` (mesmo SQL Editor, depois do schema). Isso:

   - Cria o trigger que gera um `profile` (papel `gestor` por padrão) para
     todo novo usuário do Supabase Auth.
   - Habilita RLS e as policies de acesso: admin vê/edita tudo; gestor só
     vê os clientes em que aparece em `client_managers` (e só edita tarefas
     e comentários desses clientes — `planned_spend` das sprints é
     editável só pelo admin).

3b. Rode `supabase/task-templates.sql` (mesmo SQL Editor, depois do
    `policies.sql`). Cria `client_task_templates`, `tasks.template_id` e a
    geração idempotente — esse modelo por cliente foi substituído pelo
    global no passo 3c, mas o arquivo precisa rodar primeiro porque cria a
    coluna/índice que o passo seguinte reaproveita.

3c. (Opcional, só se você já tem clientes/sprints de antes dessa etapa)
    Rode `supabase/cleanup-old-client-templates.sql` — primeiro a consulta
    de preview (mostra o que seria afetado), depois o `delete`, que só
    remove tarefas geradas pelo modelo antigo que estão **pendentes e sem
    comentário** (tarefa concluída ou comentada nunca é apagada).

3d. Rode `supabase/global-sprint-task-templates.sql` (depois do
    `task-templates.sql`, e do `cleanup` se você rodou o passo 3c). Isso:

    - Cria `sprint_task_templates` (configuração global, em vez de por
      cliente) + `sprint_task_template_clients` (quando o template vale só
      pra clientes selecionados, não "todos").
    - Reescreve a geração de tarefas da sprint pra ler essa configuração
      global.
    - Desativa (`is_active = false`) os templates antigos de
      `client_task_templates` e desvincula (`template_id = null`) as
      tarefas que sobraram — sem apagar nenhuma tarefa.

    Se você criar ou editar um template global depois, aplique nas sprints
    que já existem clicando em "Aplicar às sprints já existentes" na tela
    `/settings/sprint-task-templates` (ou rodando
    `select backfill_sprint_tasks_from_templates();` no SQL Editor) — sem
    isso, a mudança só vale pras próximas sprints geradas.

3e. Rode `supabase/soft-delete-clients.sql` (depois do passo 3d). Adiciona
    `clients.deleted_at` (exclusão de cliente é soft delete — sprints,
    tarefas, comentários e `daily_spend` nunca são apagados) e ajusta a
    geração de sprints do mês seguinte e o backfill de tarefas pra ignorar
    cliente excluído.

3f. Rode `supabase/operation-collaboration-rls.sql` (depois do passo 3e).
    Abre a **leitura** de clientes/sprints/tarefas/comentários pra qualquer
    usuário logado (antes só admin ou gestor responsável viam algo) — é o
    que permite a tela `/operation` mostrar todos os clientes pra
    colaboração entre gestores. Escrita (concluir/criar/editar tarefa,
    `planned_spend`, dados do cliente) continua exigindo admin ou gestor
    responsável, sem mudança nenhuma aí.

3g. Rode `supabase/operational-activities.sql` (depois do passo 3f). Cria
    `operational_activities` (log de tarefa criada/editada/concluída e
    comentário em tarefa/sprint — nunca sync do Meta nem geração automática
    de tarefa), as views `client_last_operational_activity` e
    `sprint_last_operational_activity` (última atividade por cliente/sprint
    num único select, sem query por cliente), e a função de backfill. Se
    você já tem tarefas/comentários de antes dessa etapa, rode uma vez, no
    SQL Editor:

    ```sql
    select backfill_operational_activities();
    ```

    Isso infere `task_created` só das tarefas manuais (não geradas por
    template) e `task_commented`/`sprint_commented` de todos os comentários
    já existentes. **Não** inventa `task_completed` histórico — não existe
    coluna de "quando foi concluída" em `tasks`, só o status atual, então
    chutar uma data de conclusão seria dado fabricado. A partir de agora
    toda conclusão nova gera o evento certinho; conclusões anteriores a
    essa etapa simplesmente não entram no histórico de atividade.

4. Crie os usuários em Authentication > Users no painel do Supabase
   (email/senha). O trigger cria o `profile` automaticamente com papel
   `gestor`. Para promover alguém a admin, rode no SQL Editor:

   ```sql
   update profiles set role = 'admin' where id = '<uuid do usuário>';
   ```

5. Copie `.env.local.example` para `.env.local` e preencha:

   ```bash
   cp .env.local.example .env.local
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: em
     Project Settings > API no Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: mesma página (usada só no servidor, nunca
     exposta ao cliente).
   - `META_ACCESS_TOKEN`: token de um System User com permissão `ads_read`
     na conta de anúncios (usado a partir da Etapa 4).

6. Rode o projeto:

   ```bash
   npm run dev
   ```

   Abra [http://localhost:3000](http://localhost:3000) — você será
   redirecionado para `/login`. Entre com um usuário criado no passo 4.

## Estrutura

- `src/app` — rotas (App Router)
- `src/app/login` — página de login e server actions de login/logout
- `src/lib/supabase` — clientes Supabase (browser/server/middleware) e tipos do banco
- `src/lib/auth.ts` — helpers para ler o profile do usuário logado e para
  exigir papel admin (`requireAdmin`) nas páginas de admin
- `src/proxy.ts` — protege todas as rotas exceto `/login` (equivalente ao
  antigo `middleware.ts`, renomeado nesta versão do Next.js)
- `src/app/clients` — cadastro/edição de clientes e atribuição de gestores
  (`/clients/new`, `/clients/[id]/edit`, admin apenas) e a página do cliente
  (`/clients/[id]`, preenchida nas próximas etapas)
- `supabase/schema.sql` — schema SQL das tabelas e funções auxiliares
- `supabase/policies.sql` — trigger de criação de profile + RLS por papel
- `src/lib/meta.ts` — chamada à Meta Insights API (`fetchDailySpend`)
- `src/lib/meta-sync.ts` — sync de um cliente (ou de todos) para `daily_spend`,
  usando o client admin (service role) porque roda fora de uma sessão de usuário
- `scripts/sync-meta.ts` — script isolado pra testar a sync via terminal
  (`npm run sync:meta -- <client_id>`) antes/depois de mexer na UI
- `src/app/api/cron/sync-meta` — rota que roda a sync de todos os clientes;
  sem cron automático ainda (só o botão manual), ver comentário no arquivo
  para como ligar um cron da Vercel quando for a hora
- `src/lib/spend-status.ts` — margem de tolerância (`SPEND_STATUS_MARGIN`,
  ±10% por padrão) e a classificação dentro/acima/abaixo
- `src/lib/sprint-financials.ts` — gasto esperado até hoje (proporcional aos
  dias já passados na sprint) e % de progresso de cada sprint
- `src/app/clients/[id]/tasks/new` — cadastro de tarefa (admin ou gestor do
  cliente); `src/app/clients/tasks-actions.ts` tem a criação e o "marcar
  como feito" (que já gera a próxima ocorrência se a tarefa for recorrente)
- `src/lib/task-recurrence.ts` — próxima data de uma tarefa recorrente
  (diária/semanal/mensal, com o mês tratando fim de mês corretamente)
- `src/lib/task-status.ts` — status efetivo da tarefa calculado na consulta:
  vira "atrasado" se passou do prazo sem estar "feito", sem job separado
- `src/lib/today.ts` — "hoje" no fuso da agência (`America/Sao_Paulo`), não
  no fuso do servidor — usado em tudo que compara com a data atual (sprint,
  tarefa, sync do Meta) pra não errar o dia perto da meia-noite
- `src/app/clients/comment-thread.tsx` — lista + formulário de comentário,
  genérico pra sprint e tarefa (`src/app/clients/comments-actions.ts` cria o
  comentário sempre com `author_id` do usuário logado). Na sprint fica
  sempre visível; na tarefa fica dentro de um `<details>` colapsável
- `src/app/painel-mensal` — painel geral do mês (só admin): planejado x
  gasto de todos os clientes no mês, reaproveitando `spend-status.ts` (a
  mesma margem de ±10%, mas comparando com o planejado total do mês, sem
  proporção por dia como na sprint)
- `src/app/clients/section.tsx` — wrapper de seção (título + ação + conteúdo)
- `src/app/clients/task-row.tsx` — uma linha de tarefa (título, tipo, prazo,
  responsável, selo, editar, marcar como feito, comentários), reaproveitada
  tanto na lista geral (`task-list.tsx`) quanto dentro do card da sprint
  (`sprint-task-list.tsx`)
- `src/app/clients/sprint-actions.ts` — editar `planned_spend` de uma
  sprint, só admin (`requireAdmin`, e a RLS de `sprints` já bloqueia gestor)
- `src/app/clients/[id]/tasks/[taskId]/edit` — editar uma tarefa (inclusive
  mover o prazo/`due_date`); `/tasks/new` aceita `?sprintId=` pra já criar a
  tarefa vinculada à sprint (usado pelo "+ Adicionar tarefa na sprint" de
  cada card)
- `supabase/task-templates.sql` — schema-base (`tasks.template_id` + índice
  único parcial `tasks_template_sprint_unique`, que garante que a geração
  não duplica tarefa); o `client_task_templates` que esse arquivo cria foi
  desativado pelo passo 3d, mantido só como histórico
- `supabase/global-sprint-task-templates.sql` — `sprint_task_templates`
  (plano operacional global, "todos os clientes" ou clientes selecionados
  via `sprint_task_template_clients`) + a geração de tarefas da sprint
  reescrita pra ler essa configuração; `backfill_sprint_tasks_from_templates()`
  aplica nas sprints já existentes
- `supabase/cleanup-old-client-templates.sql` — remoção segura das tarefas
  de teste do modelo antigo (só apaga pendente + sem comentário)
- `src/app/settings` — configurações (admin only). `/settings/sprint-task-templates`:
  listar, criar, editar, ativar/desativar e excluir templates globais
  (`sprint-task-templates-actions.ts`), escolher "todos os clientes" ou
  clientes específicos, e botão pra aplicar num backfill manual. Editar um
  template não altera tarefas já geradas; excluir só é permitido se o
  template ainda não gerou nenhuma tarefa (senão, é só desativar)
- `src/lib/attention-alerts.ts` — gera o bloco "Precisa de atenção" a
  partir de dados reais (investimento fora do esperado, tarefas atrasadas,
  sync antiga, sprint sem planejado/tarefas/responsável), ordenado por
  severidade; `computeAccountHealth()` deriva a saúde da conta da
  severidade máxima entre os alertas ativos
- `src/lib/client-metrics.ts` — projeção de fechamento do mês (pelo ritmo
  observado até hoje) e contagem de tarefas do mês (feitas/pendentes/atrasadas)
- `src/lib/spend-chart-data.ts` + `src/app/clients/spend-chart.tsx` —
  planejado acumulado x gasto real acumulado no mês (SVG próprio, sem lib
  nova — o projeto não tinha nenhuma e não valia adicionar uma pra um
  gráfico de linha só)
- `src/app/clients/client-header.tsx`, `client-metrics-cards.tsx`,
  `attention-panel.tsx` — o novo topo da página do cliente
- Tokens de marca em `src/app/globals.css` (`bg-background`, `bg-card`,
  `text-muted-foreground`, `border-border`, `bg-brand`/`text-brand`,
  `--brand` = azul MITZA `#4169e1`/`#7b93e8` no escuro) — usados nos
  componentes novos e nos botões principais/links de navegação do resto
  do app (que trocaram de preto/branco pra azul); cores semânticas
  (verde/âmbar/vermelho de status) continuam à parte, não fazem parte do
  token de marca
- `src/lib/format.ts` — `formatFullDate` (data por extenso em pt-BR, ex.
  "quinta-feira, 09 de julho de 2026"), usado no header do cliente e
  dentro do card da sprint atual (`src/app/clients/sprint-card.tsx`, selo
  "Sprint atual" com borda azul à esquerda) — calculado a partir de
  `todayUTC()`, nunca hardcoded
- `src/app/clients/task-row.tsx` — selo "Hoje" (azul) quando
  `due_date` é hoje e a tarefa ainda está pendente; tarefa futura pendente
  fica com opacidade reduzida (mais discreta); atrasada continua com o
  selo vermelho de sempre. Data do prazo com dia da semana em destaque
  (`formatWeekdayAndDate` em `src/lib/format.ts`, versão longa e curta
  pra tela pequena) tem mais peso visual que tipo/responsável; concluída
  ganha check e fica com texto mais discreto; borda muda de cor conforme
  hoje/atrasada/neutra
- `src/app/clients/sprint-card.tsx` — header com "Sprint N" + período em
  destaque; bloco "Hoje" vira um chip com fundo/borda azul clara
  (`formatWeekdayAndDayMonth`); planejado/gasto real/diferença em 3
  colunas com valor em destaque; edição do `planned_spend` (admin) fica
  escondida atrás de um "Editar" — só aparece o formulário ao clicar,
  via `<input type="checkbox">` + CSS `peer` (sem componente cliente
  novo); "Última execução da sprint" muda de cor (neutro/âmbar/vermelho)
  conforme a severidade do alerta de sprint sem execução
- `src/app/clients/sprint-task-list.tsx` — barra de progresso de tarefas
  concluídas da sprint (separada da barra de gasto, que já existia)
- `supabase/soft-delete-clients.sql` — `clients.deleted_at`; excluir é
  sempre soft delete (`deleteClientAction`/`restoreClientAction` em
  `src/app/clients/actions.ts`, admin only). Todas as queries de listagem
  (`/`, `/painel-mensal`, o seletor de clientes em
  `/settings/sprint-task-templates`) filtram `deleted_at is null`; a
  página do cliente e a de editar fazem o mesmo filtro, então uma URL
  direta de cliente excluído vira 404. `src/app/clients/delete-client-button.tsx`
  pede confirmação nativa do navegador antes de excluir (não é um clique
  só). `/settings/deleted-clients` lista e restaura
- `src/app/settings/deleted-clients/page.tsx` — clientes excluídos e
  botão de restaurar (admin only)
- `supabase/operation-collaboration-rls.sql` — abre leitura de
  clientes/sprints/tarefas/comentários pra qualquer usuário logado
  (colaboração); escrita continua igual (admin ou gestor responsável)
- `supabase/operational-activities.sql` — `operational_activities` (log de
  tarefa criada/editada/concluída, comentário em tarefa/sprint), views
  `client_last_operational_activity`/`sprint_last_operational_activity` e
  `backfill_operational_activities()`
- `src/lib/business-days.ts` — `businessDaysSince()`, ignora sábado/domingo
- `src/lib/operational-activity.ts` — `OPERATIONAL_ACTIVITY_THRESHOLDS`
  (1/2/3 dias úteis = ativo/atenção/inativo, centralizado, nada hardcoded
  nos componentes), `classifyOperationalActivityStatus`,
  `formatLastActivityLabel` ("Hoje"/"Ontem"/"Há N dias úteis"/"Nunca
  houve atividade")
- `src/lib/sprint-execution.ts` — "sprint sem execução" (2+ dias úteis sem
  tarefa concluída/comentário na sprint atual), conceito separado da
  inatividade do cliente; os dois alertas entram no mesmo
  `buildAttentionAlerts`/`AttentionPanel` de sempre, sem sistema paralelo
- `src/lib/operational-activity-log.ts` — único ponto que grava em
  `operational_activities`, chamado de dentro de `createTaskAction`,
  `updateTaskAction`, `completeTaskAction`
  (`src/app/clients/tasks-actions.ts`) e `createCommentAction`
  (`src/app/clients/comments-actions.ts`). Sync do Meta e geração
  automática de tarefa por template nunca chamam esse helper, então nunca
  contam como atividade
- `src/app/operation` — nova área "Operação": `page.tsx` busca tudo em
  lote (nunca uma query por cliente) e monta os cards
  (`operation-data.ts`, `client-card.tsx`), com 3 modos (Hoje/Sprint
  atual/Todos os clientes) e filtros (mês, gestor, busca, status da
  conta, atividade operacional, sprint) via query string. Concluir
  tarefa e comentar acontecem sem sair da página (as mesmas actions de
  sempre, só com um campo oculto `return_to`); `task-drawer-panel.tsx` é
  o painel lateral de detalhes, aberto via `?task=<id>` — fechar é só
  tirar o parâmetro da URL, sem JavaScript de cliente nenhum
- `src/app/layout.tsx` — layout raiz agora monta a sidebar em volta de
  `children` quando há perfil logado (`/login` continua sem sidebar,
  porque nesse momento `getCurrentProfile()` retorna null); nenhuma rota
  mudou de lugar, é só a casca visual
- `src/app/sidebar.tsx` (`"use client"`, único jeito de destacar a página
  ativa e controlar o menu mobile) — itens por papel (Equipe e
  Configurações só pra admin), "Em breve" pra Reuniões/Equipe (ainda sem
  tela própria), atalho "+ Novo cliente" e "Atualizar Meta (todos)"
  (admin), nome+papel e "Sair" no rodapé. Fixa no desktop, vira
  hambúrguer com overlay no mobile (`md:` breakpoint)
- `src/app/global-actions.ts` — `syncAllMetaAction` (admin only), sincroniza
  o Meta de todos os clientes de uma vez, chamado pelo atalho da sidebar

## Sync com o Meta

1. Teste primeiro pelo terminal, sem precisar da UI:

   ```bash
   npm run sync:meta -- <client_id>
   ```

   Isso busca o spend diário (breakdown por dia) da conta de anúncios do
   cliente desde o início da sprint atual até hoje, e salva em `daily_spend`.
   Requer que o cliente já tenha uma sprint cobrindo a data de hoje (criada
   automaticamente ao cadastrar o cliente — veja `supabase/schema.sql`).

2. Na página do cliente (`/clients/[id]`) tem um botão "Atualizar dados do
   Meta" que roda a mesma sync. Cron automático fica pra depois — por ora
   é só esse botão manual (ou o script acima).

## Ordem de construção

1. ✅ Setup do projeto e schema SQL
2. ✅ Autenticação com papéis (admin/gestor) e proteção de rotas
3. ✅ CRUD de clientes e atribuição de gestores
4. ✅ Sync com a Meta Insights API
5. ✅ Dashboard financeiro por sprint com selos de status
6. ✅ CRUD de tarefas + recorrência e "atrasado"
7. ✅ Comentários genéricos (sprint e tarefa)
8. ✅ Painel geral do mês com cálculo de meta batida
9. ✅ Polimento visual da página do cliente
10. ✅ Sprint como centro de gestão: `planned_spend` editável inline pelo
    admin, e tarefas vinculadas (`sprint_id`) exibidas e criadas dentro do
    card da sprint em vez de só numa lista geral separada
11. ✅ Redesign da página do cliente + plano operacional automático: tarefas
    padrão configuráveis por cliente e geradas sozinhas em cada sprint
    (idempotente), painel de indicadores, "Precisa de atenção", gráfico de
    planejado x real acumulado, sprints em accordion (atual aberta, demais
    compactadas), identidade visual MITZA
12. ✅ Tarefas padrão de sprint viram configuração global (`/settings`,
    "todos os clientes" ou clientes selecionados, em vez de por cliente),
    numeração das sprints (Sprint 1, 2, 3...) e gráfico mais baixo
13. ✅ Exclusão de cliente (soft delete, admin only) com confirmação,
    tela de clientes excluídos com restaurar
14. ✅ Identidade visual azul/branco/preto (token `--brand` = azul, sem
    marrom), selo "Sprint atual" com destaque, data de hoje por extenso no
    header e na sprint atual, selo "Hoje" em tarefa com prazo hoje,
    tarefas futuras mais discretas
15. ✅ Tela "Operação" (execução diária em vários clientes de uma vez) +
    detecção automática de inatividade operacional: log de atividade
    relevante (`operational_activities`), status Ativo/Atenção/Inativo
    por dias úteis sem atividade, "sprint sem execução", tudo integrado
    no mesmo painel "Precisa de atenção" e na Visão Geral
16. ✅ Sidebar fixa (menu hambúrguer no mobile) com os itens por papel,
    página ativa destacada, atalhos de "+ Novo cliente" e "Atualizar Meta
    (todos)" pra admin
17. ✅ Hierarquia visual dos cards de sprint: sprint+período em destaque,
    bloco "Hoje" com identidade MITZA, datas com dia da semana em toda
    tarefa, financeiro em 3 colunas com edição inline, barra de progresso
    de tarefas, cards de tarefa mais compactos — só visual, nenhuma regra
    de negócio mudou
18. ✅ Visão Geral vira o dashboard principal da agência (rota `/`, home
    após login): filtros globais (mês, gestor, status da conta, atividade
    operacional, ritmo de investimento, tarefas, busca), indicadores de
    portfólio e financeiro consolidados, gráfico planejado x real
    acumulado da agência, indicadores de sprint (em dia/atenção/crítica/sem
    execução + taxa de execução), bloco "Precisa de atenção" e "Contas
    prioritárias" no nível da agência, resumo por gestor ("Minha Operação"
    pro gestor), tabela de clientes densa com CTAs pra Operação — tudo
    reaproveitando `buildOperationClientCard` (agora com mês selecionável)
    e as mesmas regras de saúde/ritmo/atividade já usadas em Operação e na
    página do cliente, sem duplicar lógica
19. ✅ Top Bar global (MITZA + dia da semana/data/hora ao vivo no fuso
    America/Sao_Paulo, sem risco de hydration) acima de toda página
    autenticada; sidebar volta a ser só navegação (removidos os "← Voltar"
    redundantes com ela); subheader sticky do cliente (`ClientContextBar`)
    em toda rota `/clients/[id]/**`, sempre visível durante o scroll, com
    nome, sprint atual, gestor(es) e status — reaproveitando
    `buildOperationClientCard` de novo, sem duplicar a regra de saúde
20. ✅ Sidebar recolhível no desktop (botão de seta na borda), preferência
    salva no navegador
21. ✅ Refinamento visual e UX geral (padrões familiares de ferramentas de
    gestão de trabalho, sem copiar identidade do ClickUp): interface mais
    densa (paddings/alturas menores, Top Bar de 48px), tarefas viraram
    linha densa (status clicável no início, responsável/prazo/situação
    numa linha só, ações reveladas no hover, sempre visíveis no mobile),
    cabeçalho da sprint virou uma linha-resumo (com % de progresso),
    tabelas da Visão Geral e filtros de Operação padronizados — só camada
    visual, nenhuma query/regra de negócio mudou
22. ✅ Simplificação visual e redução de poluição (progressive disclosure):
    Visão Geral agrupada em 3 grupos compactos (Carteira/Investimento/
    Operação, no lugar de 19 cards soltos), "Resumo por Gestor" virou
    seção recolhível "Ver análises adicionais" e a tabela de clientes
    passou a aparecer bem mais cedo; página do cliente reduzida a 4
    indicadores essenciais (Investimento/Projeção/Tarefas atrasadas/
    Última atividade), header duplicado removido (nome/gestor/status/ações
    já vivem só no ClientContextBar sticky), ID Meta/gestores completos/
    última sync viraram um "Detalhes do cliente" recolhível; tarefas agora
    abrem um drawer lateral (reaproveitando o já existente da Operação) em
    vez de mostrar observações/comentários permanentemente na linha;
    comentários da sprint viraram "Ver detalhes da sprint" — nenhuma
    informação removida, só reorganizada por prioridade de decisão
23. ✅ Correção da hierarquia do App Shell: Top Bar agora ocupa 100% da
    largura, acima de tudo (antes ela só começava depois da Sidebar); a
    Sidebar passou a começar exatamente abaixo da Top Bar, com scroll
    próprio (`calc(100vh - altura da Top Bar)`) e dimensões centralizadas
    (`app-shell-dimensions.ts`); ganhou ícones (nova dependência
    `lucide-react`, primeira biblioteca de ícones do projeto), recolhe pra
    uma faixa só de ícones com tooltip (botão integrado no topo dela, não
    mais um círculo flutuando na borda), e no mobile o drawer some abaixo
    da Top Bar (que continua sempre visível e clicável)
24. ✅ Nova tela `/sprints` (renomeação de "Operação" — mesma query agregada,
    filtros e modos de `buildOperationClientCard`, agora ordenada por
    prioridade de intervenção e organizada em grupos colapsáveis por
    cliente, com tarefas na linha densa `TaskRow` já usada na página do
    cliente); `/operation` virou redirect pra `/sprints` (preserva links e
    favoritos antigos); item "Tarefas" saiu da sidebar (era só um atalho pra
    `mode=hoje`, que continua acessível dentro de Sprints); nova tela
    `/clients` (diretório simples de clientes com busca, filtro por gestor e
    por status, sem duplicar as métricas da Visão Geral) — ambos os menus
    aparecem na sidebar como "Clientes" e "Sprints"
25. ✅ Ajustes de UX na Sidebar, tarefas, drawer e gráfico: Sidebar chega até
    o final da viewport (`dvh`), botão de recolher juntou com "Novo cliente"
    na mesma linha (sem faixa própria), nav reagrupada com espaço flexível,
    "Atualizar Meta" virou ação secundária, estado ativo mais leve; tarefas
    passaram a ordenar só por `due_date` (concluir não muda mais a posição),
    com a data antes do nome na `TaskRow`; abrir/fechar/concluir/comentar no
    drawer de tarefa não pula mais pro topo da página (`scroll={false}` +
    fim do `redirect()` nas actions de sucesso) — inclusive o fluxo "Editar
    tarefa" (guarda e restaura o scroll antes do primeiro paint); tooltip e
    eixo do gráfico de investimento acumulado usam `formatShortDate` (dd/MM)
    em vez do texto fixo "/mês"
26. ✅ Simplificação do cabeçalho e filtros da Visão Geral: removida a data e
    o nome/papel do usuário do conteúdo (já vivem na Top Bar/Sidebar);
    título compacto "Visão Geral"; filtros secundários (status da conta,
    atividade, ritmo, tarefas) escondidos num popover "Filtros" com contador,
    aplicação automática (sem botão "Filtrar", busca com debounce de 300ms)
27. ✅ Dados estruturais do cliente: nova migration
    (`client-structural-fields.sql`) com ~30 campos opcionais em `clients`
    (identificação/status contratual, contatos, presença digital, operação
    de mídia, comercial, contexto estratégico — `monthly_planned_spend` é só
    referência, não mexe no `planned_spend` da sprint); `ClientForm`
    reorganizado em seções recolhíveis e reaproveitado tanto por
    `/clients/new` quanto por `/clients/[id]/edit`; nova tela administrativa
    `Configurações > Clientes` (`/settings/clients`, listagem enxuta com
    busca/filtro por status, "Editar" abre o form completo); nome do cliente
    em `/clients` passou de azul pra preto/negrito (azul fica só pra ações)
28. ✅ UX e densidade da tela Sprints: nome do cliente em preto/negrito (sem
    badge de saúde/atividade ao lado); cabeçalho compacto em 3 linhas
    (nome + gestor principal / sprint e período / financeiro · progresso da
    sprint · última atividade), sem gráfico/projeção/selo de status
    financeiro; gestor principal (novo campo da Etapa 27) aparece uma vez no
    cabeçalho e some da linha da tarefa quando o responsável é o mesmo;
    alertas viraram uma única área compacta (contagem no cabeçalho, detalhe
    só quando expandido, nada quando não há alerta); modo "Sprint atual"
    ordena por prioridade operacional (atrasadas → sem execução → tarefas de
    hoje → demais, depois alfabético) sem depender de badge — ordenação nova
    e isolada (`sortSprintClientsByUrgency`), não mexe na ordenação da Visão
    Geral
29. ✅ Densidade dos alertas e expansão inicial na tela Sprints: todos os
    clientes/sprints iniciam recolhidos em qualquer modo (nada expande
    automaticamente por saúde/atraso/atividade); a lista completa de
    alertas some do resumo padrão — vira uma linha compacta (ícone + alerta
    mais prioritário, já vem ordenado por severidade, + "+N alertas"),
    vermelho só quando o alerta principal é crítico; a lista detalhada só
    aparece num `<details>` aninhado ("Ver alertas"/"Ocultar alertas"),
    independente da expansão do cliente — tarefas continuam logo em
    seguida, sem a lista de alertas entre o resumo e elas
30. ✅ Rodada consolidada de UX + planejamento financeiro (sem migration):
    corrigido o bug real da Sidebar não chegar ao final da viewport — os
    `calc()` de altura estavam sem espaço em volta do operador
    (`calc(100dvh-3rem)` é CSS inválido, silenciosamente descartado; virou
    `calc(100dvh_-_3rem)`); confirmado que o planejamento mensal já é a soma
    de `sprints.planned_spend` (`buildOperationClientCard`), sem valor
    concorrente — `monthly_planned_spend` (Etapa 27) continua só uma
    referência; nova barra financeira compacta (azul MITZA) no cabeçalho de
    cada cliente em `/sprints`; templates de sprint (Configurações) não têm
    mais campo de título redundante — o tipo já gera o nome
    (`TASK_TYPE_DEFAULT_TITLE`), exceto "Outro"; `/clients` ganhou tempo de
    relacionamento (`contract_start_date`) e projeção do mês, perdeu os
    badges de saúde/atividade operacional (status contratual continua);
    Visão Geral: gráfico reduzido (220px → 180px), grupo "Carteira" virou
    "Ritmo do mês" (Clientes totais/Dentro/Abaixo/Acima do esperado,
    reaproveitando `monthStatus` e o filtro `ritmo` já existentes), e as
    duas tabelas (Contas prioritárias + Clientes) viraram uma tabela única
31. ✅ Simplificação da página individual do cliente + edição financeira da
    sprint (nova migration `sprint-actual-spend-source.sql`): nome do
    cliente não aparece mais duas vezes (o antigo `ClientHeader` foi
    removido — nome/sprint/gestor já vivem só no `ClientContextBar` sticky,
    que perdeu o selo de saúde da conta, mantendo Editar/Atualizar Meta); o
    "Precisa de atenção" virou "Atenção", uma faixa compacta com no máximo 3
    alertas (priorizados por tipo: atrasadas → investimento → atividade →
    sync do Meta → otimização → sem responsável → outros) e "Ver todos (N)"
    expandindo localmente, sem navegar nem crescer a página; "Planejado" da
    sprint virou "Investimento planejado" com um input monetário de verdade
    (`MoneyInput`, digitação natural em pt-BR, nunca NaN/negativo); "Gasto
    real" agora pode ser editado manualmente (mesmo input monetário) — nova
    origem por sprint (`spend_source`: `manual`/`meta_api`, resolvida por
    `resolveSprintActualSpend`), com indicador discreto "Manual"/"Meta" e
    confirmação antes de voltar pra "Meta"; a sync do Meta continua gravando
    em `daily_spend` normalmente e nunca sobrescreve um valor manual sozinha;
    "Diferença" virou "Saldo do planejamento" (`planejado - gasto`, com os
    textos "restantes"/"Planejamento atingido"/"acima do planejado"); barra
    de progresso da sprint unificada num componente só (`SprintFinancialBar`,
    reaproveitado também em `/sprints`) com "X% utilizado" integrado ao
    mesmo bloco financeiro — escopo limitado à página do cliente: Sprints,
    Visão Geral, `/clients` e o gráfico diário continuam somando
    `daily_spend` normalmente, sem refletir valores manuais (corrigido na
    Etapa 32 abaixo)
32. ✅ Fonte única do gasto real + barra financeira com marcador de ritmo
    (nova migration `sprint-manual-spend-updated-at.sql`): a Etapa 31 só
    fazia o gasto manual valer dentro da própria página do cliente —
    `buildOperationClientCard` (usado por `/sprints`, Visão Geral, `/clients`
    e o cabeçalho fixo do cliente) continuava somando `daily_spend` bruto
    sem checar `spend_source`; agora duas funções centralizadas
    (`computeSprintEffectiveSpend`/`sumEffectiveSpend` em
    `sprint-financials.ts`) resolvem o gasto real de cada sprint uma única
    vez e são reaproveitadas em todo lugar que soma gasto do mês — nenhum
    componente filtra/soma `daily_spend` por conta própria; o gráfico
    "Planejado acumulado x gasto real acumulado" (`computeCumulativeSpendSeries`)
    também passou a considerar sprints manuais: em vez de inventar uma
    distribuição diária, lança o valor manual inteiro no dia da última edição
    (`manual_spend_updated_at`, novo) e ignora o `daily_spend` daquele período
    pra nunca contar em dobro; as actions de editar/reverter gasto real agora
    chamam `revalidatePath` em `/`, `/clients` e `/sprints`, além da própria
    página do cliente, pra essas telas nunca servirem cache desatualizado;
    `SprintFinancialBar` ganhou um marcador vertical do "gasto esperado até
    hoje" (dias corridos — confirmado que o sistema só tem regra de dias
    úteis pra atividade operacional, não pra investimento) com tooltip, e um
    resumo abaixo ("35% gasto · 43% esperado até hoje · 8 p.p. abaixo/acima
    do ritmo" ou "Dentro do ritmo esperado"), reaproveitando a mesma
    classificação/tolerância de sempre (`classifySpendStatus`, ±10%) sem
    inventar uma nova
33. ✅ Correção da alocação temporal do gasto manual (sem migration): a
    Etapa 32 lançava o valor manual inteiro de uma vez no dia da última
    edição — incorreto, porque o gasto manual representa o investimento
    do período inteiro da sprint, não de um único dia. `computeCumulativeSpendSeries`
    agora distribui o valor igualmente entre os dias já decorridos da
    sprint (`start_date` até `min(hoje, end_date)` — sprint em andamento só
    distribui até hoje, sprint encerrada distribui pelo período inteiro),
    trabalhando em centavos e jogando a sobra de arredondamento no último
    dia decorrido, pra soma bater exatamente com o valor informado; a data
    em que o usuário edita não influencia mais nada — reeditar o gasto de
    uma sprint passada recalcula a distribuição sobre as datas originais da
    sprint, nunca cria gasto na data da edição. A coluna
    `manual_spend_updated_at` (Etapa 32) continua existindo e sendo
    preenchida pela action, só não é mais usada por essa conta
34. ✅ Configurações > Clientes vira manutenção cadastral eficiente (nova
    migration `client-cnpj.sql`): removidos da tabela "Investimento mensal
    planejado" (já é a soma das sprints, variável por mês) e "Próxima
    renovação" (contratos são contínuos até cancelamento — nenhum dado foi
    apagado, só saíram da visualização); nova coluna CNPJ (`clients.cnpj`,
    opcional, só dígitos armazenados, checagem no banco de 14 dígitos);
    "E-mail" reaproveita `main_contact_email` (já existia — nenhuma coluna
    duplicada); "Mensalidade" é o mesmo `agency_monthly_fee` de sempre, só
    renomeado; nova coluna calculada "Tempo ativo" (meses completos desde
    `contract_start_date`, sem guardar nada no banco); Status, Gestor
    principal, Início do contrato, CNPJ, E-mail e Mensalidade agora são
    editáveis direto na célula da tabela (clique → editar → Enter salva/Escape
    cancela/clique fora confirma), sem modal e sem transformar a linha
    inteira em formulário; busca passou a encontrar também CNPJ e e-mail,
    filtro por status aplica sozinho (removido o botão "Filtrar"); nome do
    cliente continua editável só na edição completa; CNPJ também virou
    editável lá (pro cadastro de clientes novos, que só aparecem em
    Configurações depois de criados). Nenhum menu "•••" foi adicionado — não
    existe padrão equivalente hoje em nenhuma tela, então "Editar" continua
    sendo a única ação. `/clients`, Visão Geral, Sprints, tarefas, regras
    financeiras, Meta API, autenticação, permissões e RLS não foram tocados
35. ✅ Simplificação da tabela de clientes da Visão Geral (sem migration):
    título passou a acompanhar o mês selecionado no dashboard ("Clientes ·
    Julho de 2026", nunca a data atual); colunas Tarefas e Projeção do mês
    removidas desta tabela (os cálculos de tarefas e projeção continuam
    intactos no resto do sistema — só pararam de aparecer aqui); nova coluna
    "% Realizado" (`gasto real do mês / investimento planejado do mês`,
    arredondado, sem casas decimais), mostrando "—" em vez de 0%/NaN/Infinity
    quando não há meta configurada; estrutura final: Cliente, Gestor,
    Investimento, % Realizado, Última atividade, Situação, Ação — mesma
    regra de Situação de sempre (`classifySpendStatus`, sem mudança); tabela
    continua com a mesma altura de linha compacta, sem cards novos
36. ✅ Visão Geral vira dashboard operacional compacto (sem migration):
    gráfico "Planejado acumulado x gasto real acumulado" removido (o
    acompanhamento diário detalhado continua nas páginas individuais dos
    clientes, que têm seu próprio gráfico, intocado); cabeçalho compacto
    (mês selecionado ao lado do título, sem caixa própria); "Ritmo do mês"
    continua com os mesmos 4 indicadores (Clientes totais/Dentro/Abaixo/
    Acima), agora com cor discreta no valor (verde/âmbar/vermelho); bloco
    "Investimento" virou "Investimento do mês": Planejado, Realizado, %
    realizado, **Esperado até hoje** (métrica nova) e Diferença para o
    ritmo esperado — Projeção e Diferença projetada saíram deste
    dashboard (os cálculos de projeção continuam intactos em `/clients` e
    na página do cliente); "Esperado até hoje" é a soma, por sprint do
    mês, de `planejado × dias decorridos / dias totais da sprint` (sprint
    futura conta R$ 0, encerrada conta 100%) — a mesma fórmula já usada no
    cartão da sprint individual, extraída para uma função pura só
    (`computeSprintExpectedToDate`, em `sprint-financials.ts`) pra nunca
    divergir entre página do cliente, Sprints e Visão Geral; nova barra
    horizontal (`AgencyInvestmentBar`) mostra o realizado preenchido e um
    marcador circular (não um traço fino) na posição do esperado até hoje,
    com tooltip; "N clientes sem planejamento configurado" virou uma linha
    discreta abaixo da barra, não mais uma métrica junto das financeiras;
    tabela de clientes já tinha "% Realizado"/título com o mês (Etapa 35) —
    só troquei a ordem das colunas Situação/Última atividade e renomeei o
    rótulo "Meta não configurada" para "Sem planejamento"; blocos
    "Operação" e "Precisa de atenção" não foram alterados
37. ✅ Blocos "Operação" e "Precisa de atenção" viram "Central de Atenção"
    (sem migration): em vez de contadores genéricos, mostra até 5 situações
    concretas (cliente + problema + contexto + ação), priorizadas por um
    score determinístico calculado em memória (nunca salvo, nunca exibido).
    Três categorias implementadas: **Sem execução** (reaproveita a regra já
    existente de sprint sem execução — extraída para
    `computeSprintExecutionInfo` em `sprint-execution.ts`, única fonte
    tanto do alerta da página do cliente quanto da Central); **Tarefas
    críticas** (agrupadas por cliente — só entra quando a tarefa mais
    antiga está atrasada há ≥2 dias úteis OU o cliente tem ≥3 tarefas
    atrasadas no mês, nunca uma por tarefa) e **Investimento fora do
    ritmo** (reaproveita `monthStatus`/`classifySpendStatus`, o mesmo
    cálculo do "Ritmo do mês" — sem regra financeira nova). **Comentários
    pendentes não foi implementada**: `comments` não tem hoje nenhum campo
    de pendência/resolução (só `content`/`created_at`/`author_id`), e uma
    heurística baseada só em "comentário mais recente" seria uma regra
    inventada — o contador correspondente fica oculto (não aparece como
    zero falso) e a arquitetura (`AttentionCenterCategory`) já reserva o
    valor `"comentarios"` pra quando existir estado confiável; no máximo 2
    itens do mesmo cliente na lista principal, com "Ver tudo" abrindo um
    drawer lateral (mesmo padrão do drawer de tarefa já usado em
    Operação/Sprints) com filtro simples por categoria — sem página nova

38. ✅ Orçamento mensal do cliente com redistribuição financeira das sprints
    (nova migration `monthly-budget.sql`): até aqui `sprints.planned_spend`
    era um número único por sprint, editado direto e sem histórico — não
    dava pra representar "parte da sprint atual já está consolidada (dias
    que já passaram), parte ainda pode ser redistribuída (dias futuros)".
    Duas tabelas novas resolvem isso: `sprint_planned_allocations` (uma
    linha por sprint+dia, planejado em centavos) vira a fonte de verdade —
    `sprints.planned_spend` passa a ser só um valor **derivado**, sempre
    igual à soma das alocações daquela sprint, escrito só por uma função
    transacional (nunca mais atualizado célula a célula); e
    `monthly_budget_changes` guarda o histórico auditável de cada alteração
    (data de efeito, quem alterou, valor anterior/novo, consolidado,
    distribuído no futuro, total resultante), nunca sobrescrito. A função
    `apply_monthly_budget_change` (Postgres, chamada via RPC) faz tudo numa
    operação atômica só: trava as sprints do cliente/mês, calcula o
    consolidado (dias `<= data de efeito`, que nunca mudam), calcula o
    saldo futuro, redistribui em centavos exatos entre os dias futuros
    (sobra no último dia), recalcula `planned_spend` de cada sprint a
    partir da soma das alocações e grava o histórico — tudo ou nada. Editar
    o mês corrente usa hoje (fuso `America/Sao_Paulo`) como data de efeito;
    editar um mês futuro usa o dia anterior ao primeiro dia do mês (não há
    período consolidado ainda, então 100% do novo orçamento é redistribuído
    pelos dias); editar um mês encerrado é bloqueado tanto na aplicação
    quanto dentro da própria função no banco (mensagem "Mês encerrado. O
    orçamento histórico não pode ser alterado por este fluxo."). Se o novo
    orçamento for menor que o já consolidado, não é bloqueado — o saldo
    futuro vira zero e o total do mês fica acima do novo valor (sinalizado
    como "excedente histórico" na prévia e na confirmação), nunca inventado
    como se o passado pudesse ser desfeito. Backfill idempotente
    (`backfill_sprint_planned_allocations`) reconstruiu a alocação de cada
    sprint já existente distribuindo o `planned_spend` atual igualmente
    pelos dias dela — reconstrução técnica só, não gera histórico de
    alteração nem muda nenhum total.

    Na página do cliente, a área "Orçamento de [mês]" (antes das sprints)
    mostra o valor atual, "Distribuído em N sprints deste mês" e, só pra
    admin, "Editar orçamento" — um painel com prévia completa do impacto
    antes de salvar (nada é gravado enquanto se digita): planejamento
    preservado até hoje, saldo futuro atual/novo, total resultante e a
    lista "Sprint N: R$X → R$Y" de cada sprint afetada, com um passo de
    confirmação com texto específico pra aumento/redução normal/redução
    abaixo do consolidado. Quando já houve alteração, aparece um indicador
    discreto (●, com tooltip e foco por teclado) e "Alterado em DD/MM/AAAA";
    com mais de uma alteração no mês, "Ver histórico" abre um drawer lateral
    (mesmo padrão visual da Central de Atenção) com a lista completa,
    mais recente primeiro. A edição direta de `planned_spend` por sprint
    (o "Editar" que existia no card da sprint) foi removida — o valor
    continua visível ali, só que como "Definido pelo orçamento do mês"; a
    única forma de mudar o planejado agora é pelo orçamento mensal, senão a
    invariante "soma das alocações = orçamento" quebraria em silêncio.
    Permissões: leitura do orçamento/indicador segue a mesma regra
    financeira já usada em sprints/daily_spend (admin ou gestor do
    cliente, tanto na RLS quanto na aplicação); só admin pode editar (RLS
    admin-only nas duas tabelas novas) e só admin vê o link "Ver
    histórico" completo — mesmo padrão já usado no card da sprint, onde a
    leitura é ampla mas a ação sensível é restrita na UI.

    O gráfico "Planejado acumulado x gasto real acumulado" da página do
    cliente (`computeCumulativeSpendSeries`) parou de calcular uma taxa
    fixa por sprint e passou a ler `sprint_planned_allocations` dia a dia —
    é isso que garante que o gráfico preserva a história: uma alteração de
    orçamento nunca reescreve os dias já passados, só os dias futuros à
    data de efeito refletem a redistribuição nova. `computeSprintFinancials`,
    `computeSprintExpectedToDate`, `classifySpendStatus`, a barra financeira
    da sprint, o cartão da sprint, `/sprints`, `/clients` e a Visão Geral não
    precisaram de nenhuma mudança de regra — todos continuam lendo
    `sprint.planned_spend`, que agora só passou a ser mantido certo por
    baixo dos panos.

39. ✅ Filtro de cliente específico e pesquisável na Visão Geral (sem
    migration, sem mudança de RLS/permissões): o seletor "Todos os
    clientes" que já existia (`manager`, na URL) sempre foi **carteira**
    (gestor responsável), não uma lista de clientes — confirmado tanto pelo
    código (compara `card.managerIds`) quanto pela RLS (`operation-
    collaboration-rls.sql` já abriu leitura de `clients`/`sprints`/`tasks`/
    `daily_spend` pra qualquer usuário autenticado desde a Etapa 15, então
    "quem vê o quê" nunca dependeu desse seletor). Os dois filtros agora são
    independentes e com rótulo próprio ("Carteira" / "Cliente") pra nunca
    reaproveitar o mesmo texto de opção sem contexto. O novo filtro
    "Cliente" é um combobox pesquisável (`agency-filters.tsx`, populado com
    a mesma lista de clientes já carregada pela página — nenhuma query
    nova, nenhuma consulta por tecla digitada): estado padrão "Todos os
    clientes", digitar filtra localmente por nome, Enter seleciona, Escape
    fecha, navegação com setas, "×" ao lado do controle e a primeira opção
    da lista ("Todos os clientes") limpam só esse filtro sem afetar mês/
    carteira/outros. A busca por texto solta que existia antes ("Buscar
    cliente...") foi removida — ela só filtrava por nome mesmo, então virou
    exatamente redundante com a nova busca de dentro do combobox.

    Persistência: o cliente selecionado vai pra URL como `?client=<id>`
    (nunca o nome). Se o ID não existir mais, não pertencer a nenhum
    cliente visível, ou não estiver mais dentro da carteira selecionada
    (ex.: usuário troca de gestor depois de já ter escolhido um cliente),
    o filtro é ignorado com segurança e a página volta pra "Todos os
    clientes" sozinha — nunca mantém uma seleção inválida. Como todos os
    links da página (navegação de mês, "Limpar filtros", drill-down dos
    cartões de Ritmo do mês, Central de Atenção) usam esse mesmo valor já
    validado, a URL se autocorrige assim que o usuário navega de novo.

    Efeito do filtro: nenhuma regra de cálculo mudou — Ritmo do mês,
    Investimento do mês (planejado/realizado/%/esperado até hoje/diferença),
    a barra financeira, "N clientes sem planejamento", a Central de Atenção
    e a tabela de clientes já eram todos calculados em cima do array
    `cards`; selecionar um cliente específico só reduz esse array a um item
    antes de chegar nessas funções, então tudo respeita o filtro
    automaticamente, sem duplicar nenhuma lógica financeira. O bloco "Ver
    análises adicionais" (resumo por gestor, recolhido por padrão) foi
    deixado de fora de propósito — não estava na lista de blocos pedida
    pra respeitar o filtro, e é uma comparação entre gestores que não faz
    sentido recortar por um cliente só.

40. ✅ Padronização do período financeiro + simplificação da tela Sprints
    (sem migration): a tela Sprints tinha 3 "modos" (Hoje/Sprint atual/Todos
    os clientes) que na real filtravam **quais clientes apareciam**
    (`matchesOperationMode`) — "Hoje" era um filtro de urgência (tarefas do
    dia) disfarçado de período financeiro. Agora só existem duas visões,
    **Sprint atual** e **Mensal** (`?view=current|monthly`, padrão
    `current`), e nenhuma delas filtra clientes — só muda como os dados são
    exibidos. Novo `src/lib/financial-period.ts`: um formato único
    (`FinancialPeriodSummary`) que empacota planejado/realizado/esperado/%/
    status pra sprint ou mês, sem recalcular nada — só reaproveita
    `computeSprintFinancials` (sprint) e os campos `month*` do card
    operacional (mês), que por sua vez já usam `sumEffectiveSpend`/
    `sumExpectedToDate`/`classifySpendStatus`. **Sprint atual** sempre
    resolve pela data real de hoje (nunca lê `?month=`) — evita a
    ambiguidade de "sprint atual de um mês passado" da forma mais simples:
    essa visão simplesmente não navega por mês. **Mensal** ganhou navegação
    de mês (igual à Visão Geral) e mostra, por cliente, um resumo recolhido
    (orçamento mensal, realizado, % realizado, esperado até hoje, ritmo) que
    expande pra lista das sprints do mês com status (concluída/atual/
    futura) — sem abrir nenhuma sprint automaticamente. Também ganhou (como
    a Visão Geral, Etapa 39) o filtro de cliente pesquisável — o combobox
    foi extraído pra `client-combobox.tsx`, compartilhado entre as duas
    telas; o campo de busca solto que só filtrava por nome foi removido
    (redundante, mesmo raciocínio da Etapa 39).

    **Correção real encontrada durante a padronização** (mandada
    explicitamente pela regra 19 do pedido): `card.monthStatus` — usado
    pelo "Ritmo do mês" e pela coluna "Situação" da Visão Geral, pela
    Central de Atenção, e pelo alerta "Investimento do mês" da página do
    cliente — comparava o realizado com **100% do orçamento mensal**
    (`classifySpendStatus(monthActual, monthPlanned, monthPlanned)`) em vez
    de com o esperado até hoje. Na prática, um cliente no dia 5 de um mês
    de 31 dias aparecia "abaixo do esperado" só por ainda não ter gasto o
    mês inteiro, mesmo estando exatamente no ritmo. Corrigido em dois
    lugares (`operation-data.ts` e a página do cliente, os únicos dois
    pontos que faziam essa conta) pra sempre comparar com
    `monthExpectedToDate` — mesma tolerância central (`classifySpendStatus`,
    ±10%), nenhum threshold novo. `computeMonthProjection` (projeção de
    fim de mês) não foi tocada — ali comparar com o orçamento total é
    correto, é uma pergunta diferente ("se esse ritmo continuar, onde você
    vai terminar o mês").

    Não alterei Visão Geral nem a página do cliente estruturalmente (fora a
    correção acima) — já separavam sprint de mês corretamente pelas mesmas
    funções, então não tinham o problema do "Hoje" que motivou esta etapa;
    e não toquei a Central de Atenção (não lê `?mode=`, não tem visão
    "Hoje").

41. ✅ Refinamento visual exclusivo da Visão Geral (sem migration, sem
    mudança de dado/cálculo/filtro/navegação): rodada só de design —
    hierarquia visual, superfícies, tipografia, espaçamento, bordas,
    sombras e estados de interação. Novos tokens em `globals.css`
    (`--overview-bg`, `--navy`, `--shadow-card`, `--shadow-float`) —
    **adicionados**, nunca sobrescrevendo `--background`/`--card`/
    `--border-default`/`--brand` existentes, porque esses já alimentam
    Sidebar/TopBar/todas as outras telas via herança do fundo do `<body>`;
    mudar os tokens compartilhados mudaria visualmente todo o resto do
    sistema, o que a rodada pediu explicitamente pra não fazer. Em vez
    disso, só a Visão Geral ganhou um fundo próprio (`bg-overview-bg`,
    cinza-azulado frio, mais perceptível que o off-white quase-branco de
    antes), aplicado num wrapper que preenche a área de conteúdo — Sidebar,
    TopBar e as demais páginas continuam exatamente como estavam.

    Hierarquia de superfícies: fundo da aplicação (nível 1, sem sombra) →
    cards/blocos (nível 2, branco, `shadow-card` leve, `rounded-xl`) →
    popover/drawer (nível 3, `shadow-float` mais perceptível). "Ritmo do
    mês" ganhou divisores verticais sutis entre as 4 métricas (mesmo
    container, sem virar 4 caixinhas); "Investimento do mês" ganhou uma
    borda de destaque discreta à esquerda (mais importância visual sem
    aumentar a altura) e hierarquia tipográfica real — Planejado/Realizado
    (os dois números mais importantes) em navy/2xl/bold, os demais
    (%realizado/esperado/diferença) em peso secundário; a barra
    (`AgencyInvestmentBar`) ficou mais espessa, com transição curta ao
    mudar de filtro/mês e uma legenda de apoio ("X% realizado · Y%
    esperado até hoje"). Central de Atenção: linhas com hover sutil, ponto
    de prioridade um pouco maior, ação "Abrir" discreta. Tabela: cabeçalho
    mais alto, hover por linha, valores financeiros alinhados à direita
    com números tabulares (não estavam antes), nome do cliente em
    semibold. Foco por teclado (`focus-visible`) padronizado em azul em
    todos os links/botões/selects tocados. Nenhum texto, cálculo, filtro,
    rota ou comportamento mudou — só a apresentação visual dos mesmos
    dados.

    Componentes reaproveitados/refinados (nenhum criado do zero além dos
    tokens): `StatItem`/`MetricGroup` (`page.tsx`, ganharam `size`/
    `divided`/`accent`), `AgencyInvestmentBar`, `AttentionCenterPanel`/
    `AttentionRow`/`SummaryStrip` (`attention-center.tsx`), `AgencyFilters`
    e `ClientCombobox` (Etapa 39/40, só receberam os novos tokens de
    sombra/foco).

42. ✅ SprintCard única, compartilhada entre a página do cliente e a tela
    Sprints (sem migration, sem mudança de regra financeira/RLS/
    permissões): até aqui existiam duas representações da mesma sprint —
    `sprint-card.tsx` (completa, na página do cliente: grid financeiro,
    edição de gasto manual, comentários, "Hoje", execução) e uma versão
    simplificada, inline, dentro de `current-client-group.tsx`/
    `monthly-client-group.tsx` (sem comentários, sem edição, sem grid,
    tarefas e alertas numa apresentação diferente). Agora as duas telas
    renderizam o mesmo `SprintCard` (`src/app/clients/sprint-card.tsx`),
    sem exceção.

    Diferenças de contexto controladas por prop, nunca por uma segunda
    implementação: `defaultOpen` (a página do cliente deixa a sprint atual
    já aberta, omitindo a prop; a tela Sprints sempre passa `false` — toda
    sprint começa recolhida lá); `alerts` (só a tela Sprints passa — a
    página do cliente já tem seu próprio `AttentionPanel` client-wide,
    então não duplica alerta dentro E fora do card; quando fornecido,
    aparece um indicador compacto já no resumo recolhido do card, pra não
    perder a leitura rápida que a tela Sprints já tinha, e a lista completa
    no corpo expandido); `openClientHref` (só a tela Sprints — "Abrir
    cliente" não faz sentido dentro da própria página do cliente);
    `buildTaskHref` (cada tela abre o drawer de tarefa preservando sua
    própria URL — filtros/mês/modo na tela Sprints, direto na página do
    cliente).

    **Sem accordion duplo**: no modo Sprint atual, cada cliente é só um
    cabeçalho de identidade (nome + gestor, sem toggle) seguido do
    SprintCard — como só existe uma sprint por cliente ali, o próprio
    `<details>` do card é o único controle de expandir, nunca dois níveis
    pra a mesma informação. No modo Mensal, o accordion por cliente
    continua existindo (controla "ver as sprints deste cliente", uma
    informação genuinamente diferente de "ver o detalhe desta sprint"),
    e dentro dele cada sprint do mês usa o mesmo SprintCard, todas
    recolhidas por padrão. Em nenhum dos dois modos os valores de uma
    sprint são substituídos pelos do mês — o resumo mensal (planejado/
    realizado/%/esperado do mês) fica só no cabeçalho do cliente; dentro de
    cada SprintCard continuam exclusivamente os valores daquela sprint.

    Pra viabilizar o compartilhamento sem duplicar consulta: as tarefas de
    cada sprint do mês e o texto de "última execução da sprint" passaram a
    ser calculados uma vez dentro de `buildOperationClientCard`
    (`monthSprintTasks`, `sprintExecutionLabel` — reaproveita a nova função
    `formatSprintExecutionLabel`, também adotada pela página do cliente no
    lugar da conta que ela fazia sozinha) em vez de espalhados; e a tela
    Sprints passou a buscar os comentários de todas as sprints visíveis
    numa única query em lote (antes não buscava nenhum) — sem N+1, mesmo
    padrão já usado pra atividade/gestor/tarefas nessa página.

    Componentes consolidados: `SprintCard` (agora com `alerts`,
    `defaultOpen`, `openClientHref`, `buildTaskHref`), `SprintTaskList`
    (aceita `buildTaskHref`), `AlertsSummaryLine` (movida pra dentro de
    `sprint-card.tsx`, deixou de existir em duplicidade). Removidos:
    a renderização própria de financeiro/tarefas/alertas que existia em
    `current-client-group.tsx` e `monthly-client-group.tsx`.

43. ✅ Segunda forma de ver o modo Mensal da tela Sprints — Consolidado
    (padrão) e Por sprints (sem migration, sem mudança de regra financeira/
    RLS/permissões/dado): o nível principal continua exatamente
    `[Sprint atual] [Mensal]` (`?view=current|monthly`), sem terceira aba do
    mesmo peso. Quando **Mensal** está selecionado, aparece um controle
    secundário e visualmente subordinado, **Consolidado** / **Por sprints**
    (`grouping-label` em segmented control, não switch on/off), persistido
    na URL como `?view=monthly&grouping=consolidated|sprints&month=...` —
    qualquer `grouping` ausente ou inválido cai em `consolidated` (o mesmo
    fallback seguro já usado pra `view`/`sprint`/`health`/`activity`).

    **Consolidado** (`monthly-consolidated-group.tsx`, novo) é um único
    bloco por cliente pro mês inteiro — nada de "Sprint 1"/"Sprint 2" aqui:
    cliente, gestor, mês, orçamento mensal, gasto realizado, %, esperado até
    hoje, diferença de ritmo, barra financeira mensal (`AgencyInvestmentBar`,
    já usada na Visão Geral), resumo de tarefas do mês, última atividade e
    alertas mensais consolidados (mesma `AlertsSummaryLine` já existente,
    sem duplicar). Ao expandir, mostra **todas** as tarefas do mês numa
    lista cronológica só (`orderTasks`/`TaskRow` de sempre, sobre o novo
    campo `monthTasks` do card operacional — todas as tarefas do mês, sem
    filtrar por sprint), sem nenhum agrupamento visual por sprint.

    **Por sprints** é exatamente o que a Etapa 42 já tinha construído em
    `monthly-client-group.tsx` — renomeado pra `monthly-sprints-group.tsx`
    (`SprintMonthlyBySprintsGroup`, mesmo comportamento, só reaproveitando
    os novos helpers de `financial-period.ts` no lugar da conta de ritmo que
    estava duplicada ali): cabeçalho mensal recolhido, e dentro dele as
    sprints reais do mês, cada uma no mesmo `SprintCard` da página
    individual do cliente.

    Pra nunca misturar período (bug que essa etapa tomou cuidado explícito
    de não introduzir): os dois grupos usam sempre `resolveMonthPeriodSummary`
    pro resumo do cabeçalho (nunca o financeiro de uma sprint isolada), e o
    `SprintCard` dentro de "Por sprints" continua usando só os campos da
    própria sprint — nenhum dos dois lê o valor errado do outro período.
    Novos helpers puros em `financial-period.ts` (`computeExpectedPct`,
    `formatRitmoDiffText`) só empacotam/formatam valores que já vinham de
    `resolveMonthPeriodSummary`/`computeRitmoDiff` — nenhum cálculo novo.

    Filtro de sprint (atrasadas/sem execução/em dia): some em Consolidado
    (não faz sentido resumir o mês inteiro por status de uma sprint) e
    continua disponível em Por sprints e em Sprint atual. Pra não perder o
    valor escolhido ao alternar Consolidado ↔ Por sprints, quando o filtro
    está escondido ele continua indo pra URL/formulário via campo oculto —
    só não filtra nem aparece o `<select>`. Mês, cliente e gestor continuam
    preservados normalmente ao trocar de agrupamento (mesmo `buildUrl` de
    sempre); estados de expansão incompatíveis (um bloco consolidado aberto)
    não precisam persistir — trocar de agrupamento não tenta abrir sprint
    nenhuma automaticamente.

    Arquivos: `operation-data.ts` (novo campo `monthTasks` no card, tarefas
    do mês sem filtrar por sprint, já calculado antes só não exposto),
    `financial-period.ts` (`computeExpectedPct`, `formatRitmoDiffText`),
    `sprint-card.tsx` (`AlertsSummaryLine` passou a ser exportada),
    `monthly-sprints-group.tsx` (renomeado de `monthly-client-group.tsx`),
    `monthly-consolidated-group.tsx` (novo), `sprints-client-filter.tsx`
    (nova prop `grouping`) e `sprints/page.tsx` (segmented control, parsing
    de `grouping` com fallback, guarda do filtro de sprint, `buildUrl`
    incluindo `grouping` no modo Mensal).

44. ✅ Simplificação visual e UX da tela Sprints — "fila operacional
    inteligente" (sem migration, sem mudança de regra financeira/RLS/
    permissões/dado; só a tela Sprints, nada fora dela): rodada pedida pra
    reduzir esforço cognitivo do gestor — regra central "card fechado =
    decisão e priorização, card aberto = investigação e execução".

    **Cabeçalho compacto**: `[Sprint atual] [Mensal]` continuam o nível
    principal; navegação de mês e o controle secundário Consolidado/Por
    sprints (Etapa 43) ficam na mesma linha, sem crescer a altura do topo —
    já eram uma única `flex-wrap` antes, só removi o rótulo redundante
    "Visualização do mês" ao lado do próprio seletor.

    **Filtros — só 3 controles visíveis por padrão**: carteira, busca de
    cliente (combobox, igual à Visão Geral) e o botão **Filtros**. Os 6
    filtros secundários (situação do investimento, situação operacional,
    tarefas, última otimização, atividade operacional, exibir) foram pra
    dentro de um popover — mesmo componente visual/comportamento do botão
    "Filtros" da Visão Geral (`agency-filters.tsx`), reaproveitado num novo
    `sprints-filters.tsx` (substitui `sprints-client-filter.tsx`): aplicação
    automática (sem botão "Filtrar", sem formulário GET), contador
    "Filtros (N)" só com os 6 secundários (mês/carteira/cliente não contam),
    "Limpar filtros" que preserva período/mês e volta carteira ao padrão do
    papel. A busca de cliente filtra localmente a lista já carregada — não
    faz uma chamada por tecla digitada, então não precisou de debounce.
    **Removido**: o filtro global "Sprint: todas" (redundante — Sprint atual
    já é um período só, Mensal Consolidado é o mês inteiro, e Por sprints
    decompõe dentro do próprio cliente); as opções que ele cobria viraram
    parte da nova "Situação operacional" (`sem_execucao`) e "Tarefas"
    (`atrasadas`).

    Todo filtro novo (`ritmo`, `health` estendido, `tasks`, `optimization`,
    `activity`, `display`) usa dado já existente no card operacional — nenhum
    foi implementado com comportamento simulado: situação do investimento
    (`card.sprint.status`/`card.monthStatus`, conforme o período), situação
    operacional (`accountHealth` + `sprintFilterBucket`), tarefas
    (contagem de atrasadas do período em foco + `todayAndOverdueTasks`),
    última otimização (`lastOptimizationAt`, já calculado), atividade
    (`activityStatus` simplificado pra 2 estados) e exibir (`accountHealth`).

    **Ordenação por prioridade** (novo `src/lib/account-priority.ts`,
    substitui `priority-accounts.ts`/`sprint-priority.ts` — que só existiam
    dentro da própria tela Sprints, não em uso em nenhuma outra tela):
    função única `sortAccountsByPriority(cards, period)`, mesmo critério nas
    três visões, só trocando o período (sprint atual ou mês selecionado).
    Tier de prioridade (cada um só avaliado se os anteriores não bateram):
    0 conta crítica (`accountHealth`) → 1 investimento fora do ritmo (±10%)
    → 2 tarefas atrasadas do período → 3 sem otimização recente → 4 sem
    atividade recente → 5 dentro do esperado. Desempate determinístico:
    quantidade/severidade de pendências → data da pendência mais antiga →
    nome do cliente. Não é health score nem ranking de gestor — cada tier
    reaproveita uma classificação que já existia (`computeAccountHealth`,
    `classifySpendStatus`, `sprintFilterBucket`, `activityStatus`, alertas
    `kind: "otimizacao"`); a única coisa nova é a ordem em que essas regras
    são consultadas.

    **Cards fechados simplificados** (regra "card fechado = decisão"): novo
    `AccountCardSummary` (`account-card-summary.tsx`), reaproveitado pelas
    três visões — nome do cliente, período, % investido, % esperado, selo
    de situação financeira, uma única informação operacional (nunca a lista
    de alertas nem "+N alertas") e a barra de investimento com marcador
    esperado (`AgencyInvestmentBar`, já existente). Removido do fechado:
    diferença em R$ (fica só no aberto), contagem de tarefas concluídas,
    "Última atividade: Nunca" permanente em vermelho (a informação
    operacional central já resume isso como "Sem atividade recente" só
    quando é o problema mais importante daquele cliente). Em Sprint atual,
    isso exigiu um `<details>` próprio por cliente (antes o único nível de
    accordion era o do `SprintCard` da sprint, que por padrão já abria
    sozinho pra sprint atual); pra reaproveitar o financeiro/tarefas/
    comentários sem duplicar, `SprintCard` foi dividido em `SprintCardBody`
    (conteúdo investigativo, exportado) + `SprintCard` (wrapper fino de
    sempre, usado sem nenhuma mudança pela página do cliente e por Mensal >
    Por sprints). **Todos os cards agora iniciam fechados** em qualquer
    visão — Sprint atual não abria mais sozinha por engano.

    Arquivos: `account-priority.ts` (novo), `account-card-summary.tsx`
    (novo), `sprint-card.tsx` (`SprintCardBody` extraído), `current-client-
    group.tsx`, `monthly-consolidated-group.tsx`, `monthly-sprints-group.tsx`
    (resumo trocado pro novo `AccountCardSummary`), `sprints-filters.tsx`
    (novo, substitui `sprints-client-filter.tsx`) e `sprints/page.tsx`
    (filtros/ordenação/resumo novos). `priority-accounts.ts` e
    `sprint-priority.ts` removidos (substituídos por `account-priority.ts`).

    **Correção pós-entrega**: o link do nome do cliente dentro do novo
    `AccountCardSummary` tinha um `onClick={(e) => e.stopPropagation()}` —
    como esse componente é um Server Component e `Link` é um Client
    Component do Next.js, isso quebrava a tela inteira ("Event handlers
    cannot be passed to Client Component props"). Corrigido removendo o
    handler (mesmo padrão que já funcionava antes, sem `stopPropagation`).

45. ✅ Nova área **Relatórios** — Relatório Mensal de Gestão da Conta (nova
    migration `supabase/monthly-reports.sql`; não altera nenhuma tabela,
    regra financeira ou RLS existente, só adiciona). Objetivo: consolidar
    num único lugar por cliente/mês o que a operação inteira já produz
    (investimento, execução, tarefas, comentários) mais o que só um humano
    sabe dizer (decisões, aprendizados, próximos passos) — nunca só
    performance de mídia, nunca só tarefas concluídas.

    **Reaproveitado, não duplicado** (regra explícita do pedido): situação
    financeira do mês vem de `sumEffectiveSpend`/`sumExpectedToDate`/
    `classifySpendStatus`, os mesmos de sempre; "execução da agência" conta
    `tasks` já existentes (só qualifica dois tipos novos — `reuniao` e
    `entrega_criativo` — como valores adicionais do `check` de
    `tasks.type`, em vez de inventar uma tabela de eventos paralela pra algo
    que já é uma tarefa com prazo/responsável); "Enviar para próxima sprint"
    cria uma tarefa de verdade na primeira sprint do mês seguinte.

    **Tabelas novas** (só o que é específico do relatório): `client_kpi_
    definitions` (quais KPIs cada cliente acompanha — nome, unidade, meta,
    direção "maior é melhor"/"menor é melhor", pra CPL/CPA não ficarem com
    a situação invertida de Leads/ROAS); `monthly_reports` (um registro por
    cliente+mês — status, resumo executivo, os 4 campos de "próximo mês",
    e `snapshot` jsonb); `report_kpi_values` (resultado mensal de cada KPI —
    "resultado do mês anterior" nunca é duplicado, é lido buscando o valor
    do relatório do mês anterior pro mesmo KPI); `report_timeline_events`
    (Bloco 4); `report_comment_selections` (comentários marcados "incluir
    no fechamento", referenciando `comments.id`, nunca copiando o texto);
    `report_action_items` (plano de ação do próximo mês).

    **Fluxo de status**: não iniciado → em andamento → pronto para revisão
    → finalizado. Só admin finaliza (`finalizeReportAction`, `requireAdmin`)
    e só a partir de "pronto para revisão"; finalizar congela um `snapshot`
    com tudo que a tela mostra ao vivo (financeiro, KPIs, execução, linha do
    tempo, ações) — reaproveita a mesma função que monta os dados ao vivo
    (`buildReportViewData`), nunca uma segunda lógica de agregação só pro
    snapshot. A partir daí, mudanças futuras no orçamento/tarefas/KPIs não
    alteram mais aquele relatório (`clients/[id]` de agosto não pode mexer
    no relatório de julho já finalizado) — um `check` no banco garante que
    nada fica "finalizado" sem `finalized_by`/`finalized_at` preenchidos.
    Admin pode "Reabrir" um relatório finalizado por engano.

    **Os 5 blocos da página individual** (`/reports/[clientId]`, navegação
    interna por âncora no topo): Resumo do mês (planejado/realizado/%/
    situação + KPIs + resumo executivo em texto livre); Performance (tabela
    KPI/meta/resultado/mês anterior/variação/situação, edição inline linha a
    linha); Execução da agência (só contagens — otimizações, reuniões,
    entregas, tarefas concluídas/atrasadas, cadências não cumpridas — nunca
    a lista completa de tarefas, que fica atrás de "Ver execução completa",
    reaproveitando a própria página do cliente); Acontecimentos e decisões
    (linha do tempo com data/tipo/descrição/responsável, manual ou vinda de
    um comentário marcado); Próximos passos (prioridade/problemas/
    oportunidades/testes em texto livre + plano de ação estruturado com
    "Enviar para próxima sprint").

    **Lista de relatórios** (`/reports`): mês no topo, cliente e gestor
    escondidos num botão "Filtros" discreto (mesmo padrão de popover já
    usado em Sprints/Visão Geral), resumo compacto de uma linha ("N clientes
    acompanhados · X completos · Y pendentes · Z exigem atenção") e uma
    tabela única (cliente em negrito preto, gestor, investimento, %
    realizado, situação do mês, status do relatório, "Abrir relatório").

    **"Adicionar ao relatório mensal"** (seção 11 do pedido): todo comentário
    de sprint (`comment-thread.tsx`) ganhou essa ação — ao marcar, o
    comentário vira automaticamente um item da linha do tempo do relatório
    do mês daquela sprint, sem passo manual extra; ao desmarcar, os dois
    somem juntos. A ação só aparece onde quem carrega os comentários já
    verificou o estado real (hoje, só a tela Sprints, via nova consulta em
    lote a `report_comment_selections`) — em qualquer outro lugar que
    reaproveite `CommentThread` sem passar esse dado, a ação simplesmente
    não aparece, em vez de arriscar mostrar um estado desatualizado.

    **KPIs por cliente**: configurados em Configurações > Editar cliente,
    nova seção "KPIs do Relatório Mensal" (nome, unidade, direção, meta
    opcional) — controla o que aparece no Bloco 2 de todos os meses daquele
    cliente.

    **Preparado pra automação futura, não implementada agora** (seção 14 do
    pedido é explícita sobre isso): resumo executivo, problemas,
    aprendizados e recomendações continuam 100% preenchidos manualmente;
    só a ligação comentário→linha do tempo já é automática hoje.

    Novo menu **Relatórios** na Sidebar, logo depois de Sprints.

    Arquivos: `supabase/monthly-reports.sql` (migration), `database.types.ts`
    (6 tabelas novas + `tasks.type` estendido), `lib/monthly-reports.ts`
    (helpers puros), `app/reports/report-data.ts` (dados ao vivo vs.
    snapshot), `app/reports/report-actions.ts` (Server Actions), `app/
    reports/page.tsx`, `app/reports/[clientId]/page.tsx`, `app/reports/
    reports-filters.tsx`, `app/sidebar.tsx`, `app/clients/[id]/edit/page.tsx`
    (seção de KPIs), `app/clients/comment-thread.tsx` (ação "Adicionar ao
    relatório mensal"), `app/sprints/page.tsx` (busca em lote de comentários
    já incluídos), `app/clients/task-labels.ts` (rótulos dos 2 tipos novos
    de tarefa).

46. ✅ Reformulação da Visão Geral — painel de abertura do dia (sem
    migration, sem mudança de regra financeira/permissões/dado; cálculos
    financeiros continuam vindo de `computeFinancialSummary`/
    `computeSpendRhythmCounts`/`classifySpendStatus`, sem tocar nenhum).
    Princípio: "mostrar tudo que exige decisão, não tudo que aconteceu" —
    cabeçalho compacto (só título + mês, sem subtítulo/data/e-mail/papel,
    que já existem globalmente), filtros já minimalistas mantidos como
    estavam, e o resto da tela reordenado: Saúde da operação → Controle de
    investimento → Prioridades de hoje → tabela de clientes.

    **Removido "Ritmo do mês"** (clientes totais/dentro/abaixo/acima) —
    misturava classificação de investimento com saúde operacional (um
    cliente "abaixo do ritmo" não é o mesmo problema que um cliente com
    tarefas atrasadas). **Novo "Saúde da operação"**: clientes monitorados,
    operação normal, precisam de atenção, críticos — 100% reaproveitado de
    `computePortfolioCounts(cards)`, que já classificava cada cliente numa
    única categoria (accountHealth, hierarquia crítico > atenção > normal já
    embutida em `computeAccountHealth`) — nenhum cálculo novo, só um bloco
    novo pra um dado que já existia. Cliente sem orçamento continua
    "normal" a menos que tenha outro problema real — `buildAttentionAlerts`
    nunca gerou alerta só por `monthStatus = sem_meta`.

    **"Controle de investimento"** (renomeado de "Investimento do mês", pra
    responder diretamente "estamos gastando o que deveríamos gastar
    agora?") ganhou o indicador **Contas fora do ritmo** (`abaixo + acima`,
    de `computeSpendRhythmCounts`, já existente) — breakdown "X abaixo · Y
    acima" só num tooltip nativo (`title`), sem poluir o bloco com dois
    números permanentes. Clicável, filtra a tabela via um novo valor de
    atalho `ritmo=fora_do_ritmo` (só existe como link direto, mesmo padrão
    de `sprintBucket`/`sync`/`meta`; o popover de Filtros continua com as 4
    opções reais, sem mudança).

    **Substituída "Central de Atenção" por "Prioridades de hoje"** — a
    mudança mais estrutural desta etapa. A Central de Atenção listava um
    item por PROBLEMA (um cliente com 3 problemas virava 3 linhas, até 2
    delas cabendo no resumo); "Prioridades de hoje" mostra uma linha por
    CLIENTE, sempre. Novo `src/lib/client-priority.ts`, função central
    `getClientPriority(card, today)`, não inventa nenhum sinal novo — só
    decide, com uma hierarquia determinística, qual É o problema principal
    quando o cliente tem vários:

    1. Investimento significativamente acima do ritmo
    2. Tarefa(s) crítica(s) atrasada(s) (mesmo limiar de 2 dias/3 tarefas já
       usado pela antiga Central de Atenção)
    3. Sprint sem execução
    4. Investimento significativamente abaixo do ritmo
    5. Otimização vencida
    6. Entrega de criativo atrasada (novo tipo de tarefa da Etapa 45)
    7. Tarefa atrasada abaixo do limiar de "crítica"
    8. Sem atividade operacional recente
    9. Qualquer outro alerta já calculado (nunca deixa um cliente
       não-saudável sem nenhum texto de problema)

    Itens fora do que o sistema calcula hoje com confiança (saldo da conta,
    reuniões agendadas, entregas via WhatsApp, relacionamento) ficam de
    fora de propósito — a arquitetura (uma lista de candidatos com
    `tier`, ordenada, primeiro item vira o principal) já está pronta pra
    crescer sem mudar quem chama a função. `severity` do resultado é sempre
    igual a `card.accountHealth` — nunca uma segunda classificação
    divergente de "Saúde da operação". Ordenação da fila
    (`sortClientPriorities`): severidade → posição na hierarquia acima →
    tempo em aberto (dias úteis, mais antigo primeiro) → nome — sem
    IA, sem pontuação de gestor, só regras.

    Componente novo `priorities-panel.tsx` (substitui `attention-center.tsx`/
    `.ts`, removidos): até 6 clientes no resumo, cada linha com nome,
    severidade, problema principal, idade do problema (quando é um dado
    real — nunca inventada pra ritmo de investimento), gestor responsável e
    uma ação contextual ("Abrir sprint"/"Abrir cliente", nunca "Ver mais"),
    "+N outros" discreto com tooltip pros problemas secundários. "Ver todas"
    abre o mesmo padrão de drawer lateral já usado no sistema, agora com
    filtro por severidade em vez de categoria.

    **Tabela de clientes** simplificada: `Cliente · Gestor · Investimento
    (% + situação, sem repetir R$ realizado/planejado/esperado/diferença,
    que já pertencem ao painel do cliente) · Prioridade · Última otimização
    · Ação`. Duas decisões deliberadas, divergindo levemente do pedido
    literal, disclosed aqui: (1) as colunas "Operação" e "Prioridade"
    pedidas separadamente usam a mesma taxonomia (Normal/Atenção/Crítico)
    e o mesmo dado (`accountHealth`) — mostrar as duas seria repetir a
    mesma informação lado a lado, contra o princípio central desta etapa
    ("reduzir informações redundantes"), então viraram uma coluna só,
    "Prioridade" (tooltip mostra o motivo); (2) "Próxima reunião" não tem
    dado confiável no sistema hoje (nenhum agendamento, só tarefas do tipo
    reunião já concluídas) — em vez de uma coluna inteira repetindo "Não
    disponível" em toda linha (zero informação, poluição visual), a coluna
    foi omitida por enquanto, exatamente como a própria seção 20 do pedido
    permite. Ordenação padrão da tabela trocou de "ritmo de investimento"
    pra "prioridade operacional" (mesma ordem de `sortClientPriorities`),
    coerente com o resto da tela — "Ordenar por nome" continua disponível.

    Arquivos: `lib/client-priority.ts` (novo), `app/priorities-panel.tsx`
    (novo, substitui `app/attention-center.tsx`), `lib/agency-metrics.ts`
    (`computePortfolioCounts` reaproveitado, `sortCardsBySpendRhythm`
    removido por ficar sem uso), `lib/monthly-reports.ts`
    (`formatLastOptimizationLabel`), `app/page.tsx` (reescrita). Removidos:
    `lib/attention-center.ts`, `app/attention-center.tsx`.

47. ✅ Fundação do novo Design System, aplicada só na Visão Geral (sem
    migration, sem mudança de regra de negócio/cálculo/query/permissão/
    filtro/search param/dado exibido — só camada visual). Primeira etapa de
    uma direção visual nova pro produto inteiro: interação inspirada em
    ClickUp (já era o padrão do sistema — navegação rápida, ação
    contextual, edição inline), linguagem visual inspirada em densidade de
    workspace operacional tipo Meta Ads Manager (superfícies neutras,
    bordas finas, pouquíssima sombra, azul só pra ação/seleção) — nunca uma
    cópia literal (sem logotipo, ícones ou layout pixel-perfect de nenhuma
    ferramenta de terceiros).

    **Fundação de tokens** (`globals.css`, aditivo — nenhum token
    compartilhado tocado): estendido o prefixo `--overview-*` já aberto na
    Etapa 41 com `surface`/`surface-subtle`/`surface-hover`/`surface-
    selected`, `border`/`border-strong`, `text-primary`/`text-secondary`/
    `text-muted`, `brand-subtle`, `success`/`success-subtle`, `warning`/
    `warning-subtle`, `danger`/`danger-subtle` (light + dark). Não são
    cores novas — tokenizam o mesmo azul/verde/laranja/vermelho já usados
    à mão em badges espalhados pelo sistema, só com nome semântico em vez
    de classe Tailwind repetida. Prefixo mantido de propósito: quando esse
    sistema for promovido pras demais telas, esses tokens é que vão virar
    os globais sem prefixo — não o contrário.

    **10 componentes novos e reutilizáveis** em `src/components/workspace/`
    — extraídos só onde havia reuso real (nunca um só ponto de uso):
    `Button`/`IconButton` (variantes primary/secondary/ghost/danger ×
    tamanhos sm/md — usados 8+ vezes só nesta página: navegação de mês,
    gatilho de Filtros, ação de linha da tabela/Prioridades, "Ordenar
    por"), `Select` (o `<select>` padronizado da toolbar e do popover de
    filtros), `StatusDot` (● + texto — a preferência do novo sistema sobre
    pills grandes pra severidade/situação), `Badge` (pill discreto, pros
    poucos casos em que uma etiqueta ainda ajuda), `Metric` (label+valor,
    generaliza o antigo `StatItem` local), `ProgressBar` (barra de
    investimento nova, ver nota abaixo), `PageHeader`, `SectionHeader`,
    `EmptyState`, `Toolbar`.

    **`ProgressBar` é uma variante nova, não uma edição de
    `AgencyInvestmentBar`** — decisão direta da seção 24 do pedido:
    `AgencyInvestmentBar` (`app/agency-investment-bar.tsx`) é usada por
    Sprints (`account-card-summary.tsx`) e Relatórios (`reports/
    [clientId]/page.tsx`), então editá-la mudaria essas telas também, o que
    esta rodada proíbe. Por isso a Visão Geral passou a usar um componente
    novo, com o mesmo contrato de dados (planned/actual/expectedToDate),
    marcador maior (handle circular, não mais um traço fino) com tooltip
    nativo — e `AgencyInvestmentBar` continua exatamente como estava.

    **Fonte**: Inter carregada via `next/font/google` e aplicada só no
    wrapper raiz da Visão Geral (`page.tsx`), nunca em `layout.tsx` — o
    `body` global continua com a fonte de sempre, então nenhuma outra tela
    muda. (Achado ao investigar a fonte atual: `Geist`/`Geist Mono` já
    estavam configuradas em `layout.tsx` mas o `body` em `globals.css`
    nunca usava `var(--font-sans)`, só `Arial, Helvetica, sans-serif` —
    ou seja, o sistema inteiro sempre rendeu no fallback do SO. Não mexi
    nisso agora — é uma mudança global, fora do escopo desta rodada — só
    registro o achado como dívida técnica.)

    **Workspace contínuo**: "Saúde da operação" e "Controle de
    investimento" passaram a compartilhar uma única superfície (borda +
    divisor horizontal, não dois cards com sombra própria) — a página lê
    como um workspace contínuo, não CARD-espaço-CARD-espaço-CARD. Tabela de
    clientes com cabeçalho `surface-subtle`, linhas ~44–52px, hover sutil,
    `StatusDot` no lugar dos badges de situação/prioridade. "Prioridades de
    hoje" ganhou linhas ~52px (perto do pedido, um pouco acima do teto de
    56px quando o problema principal + idade + responsável não cabem numa
    linha só — preferi manter as 3 informações legíveis a forçar truncagem
    agressiva).

    **Dívida técnica registrada** (pedida explicitamente na seção 17):
    `ClientCombobox` (compartilhado com Sprints/Relatórios) não foi migrado
    — continua com o visual antigo dentro da nova toolbar, pra não afetar
    as outras telas; vira variante ou candidato a promoção quando a
    migração chegar nessas telas. Tooltip/Popover/DropdownMenu como
    componentes formais não foram construídos — o popover de Filtros
    continua com a mesma implementação inline de sempre (só reskinada) e
    tooltips continuam via `title` nativo, ambos plenamente funcionais mas
    ainda não abstraídos. Nenhum `loading.tsx`/skeleton foi criado (não
    existia antes, não é regressão, só uma lacuna que já existia).

    **Estratégia de migração progressiva** (não implementada agora, só
    descrita): aplicar os componentes de `components/workspace/` uma tela
    por vez (Clientes → Sprints → Relatórios → Configurações → painel do
    cliente → Sidebar/Top Bar por último, por serem os elementos mais
    "chrome" do sistema), sempre com a mesma rodada de validação visual
    isolada já usada nesta etapa; só depois de todas migradas, promover os
    tokens `--overview-*` pros nomes globais sem prefixo e aposentar
    `--background`/`--card`/`--border-default` antigos.

    Arquivos novos: `src/components/workspace/{button,select,status-dot,
    badge,metric,progress-bar,page-header,section-header,empty-state,
    toolbar}.tsx`. Alterados (só classes/estrutura visual, nenhuma lógica):
    `globals.css`, `app/page.tsx`, `app/agency-filters.tsx`, `app/
    priorities-panel.tsx`. Não tocados: `app/agency-investment-bar.tsx`,
    `app/client-combobox.tsx`, Sidebar, Top Bar, Clientes, Sprints,
    Relatórios, Configurações, painel individual do cliente.

48. ✅ Ajuste pontual na Visão Geral: reversão só da cor de fundo geral
    introduzida na Etapa 41, mantendo 100% do resto da reformulação visual
    da Etapa 47 (fonte, densidade, componentes, hierarquia, botões, inputs,
    selects, tabelas, barras, bordas, sombras, espaçamentos, estados
    interativos, estrutura). A nova direção visual foi aprovada — só o tom
    de fundo não foi.

    **Investigação primeiro** (histórico via `git diff`/`git show`, não
    suposição): o token `--overview-bg` foi criado na Etapa 41 (antes disso
    o wrapper raiz da Visão Geral não tinha nenhuma classe de fundo própria,
    então herdava o token compartilhado `--background`). A Etapa 47 não
    mexeu no valor de `--overview-bg` — só adicionou tokens novos depois
    dele. Ou seja, o "antes da última reformulação visual" pedido é
    literalmente o valor de `--background`.

    **Mudança**: `--overview-bg` passou de `#eef1f6` (claro) / `#0b0d12`
    (escuro) para `var(--background)`, isto é, `#f7f7f5` (claro) / `#141412`
    (escuro) — os mesmos valores que o resto do sistema sempre usou.
    Referenciar a variável em vez de repetir o hex evita que os dois valores
    divirjam de novo por acidente no futuro.

    **Nada mais foi tocado**: todos os tokens da Etapa 47
    (`--overview-surface*`, `--overview-border*`, `--overview-text-*`,
    `--overview-brand-subtle`, `--overview-success/warning/danger*`),
    `--navy`, `--shadow-card`, `--shadow-float`, a fonte Inter, os 10
    componentes de `components/workspace/`, e a estrutura de `page.tsx`/
    `agency-filters.tsx`/`priorities-panel.tsx` continuam exatamente como
    estavam — confirmado por `git diff --stat` mostrando só `globals.css`
    (9 inserções, 3 remoções) alterado nesta rodada.

    **Contraste verificado, sem necessidade de ajuste**: a separação visual
    de cards/tabela/toolbar/"Prioridades de hoje"/"Controle de
    investimento" em relação ao fundo depende principalmente da borda
    (`--overview-border`, inalterada) e não de um contraste forte entre
    fundo e superfície — então restaurar o fundo não criou problema real de
    legibilidade. Por isso nenhum token de superfície/borda/texto/sombra
    foi tocado, como pedido.

    Arquivo alterado: `globals.css` (só o valor de `--overview-bg`, claro e
    escuro). Nenhum outro arquivo desta rodada.

49. ✅ Ajuste na tabela de clientes da Visão Geral: removida a coluna
    "Prioridade" (duplicava "Status" sem explicar o motivo da
    classificação — a severidade detalhada continua só em "Saúde da
    operação" e "Prioridades de hoje"), adicionada a coluna "Esperado até
    hoje" e separado "Status" da coluna "Investimento" (antes os dois
    apareciam juntos na mesma célula). Nova ordem: Cliente | Gestor |
    Investimento | Esperado até hoje | Sprint atual | Status | Última
    otimização | Abrir cliente.

    **"Esperado até hoje" não é um cálculo novo**: é `monthExpectedToDate`
    (o mesmo valor que já decide "Status" via `classifySpendStatus`,
    comparando realizado × esperado com margem de ±10%) expresso como % do
    planejado do mês — mesma regra usada em "Investimento", nunca uma conta
    paralela.

    **"Sprint atual"** reaproveita `card.sprintNumber` (já calculado em
    `operation-data.ts`, mesmo dado mostrado na página do cliente) —
    mostra "Sprint N" ou "—" quando não há sprint em andamento nessa data.

    **"Abrir cliente"** (renomeada de "Ação") agora é sempre um link direto
    pra `/clients/[id]` — antes apontava pra uma ação contextual ligada à
    prioridade (ex.: "Ver tarefa atrasada"), que deixou de fazer sentido
    sem a coluna Prioridade.

    **Decisão registrada**: o pedido não mencionava a coluna "Última
    otimização" na lista de colunas a manter, mas também instruía
    explicitamente "não remover nenhuma outra coluna além de Prioridade" —
    por isso ela foi mantida (logo após "Status", antes de "Abrir
    cliente"), em vez de removida por omissão. Se a intenção era só as 7
    colunas citadas, é reverter numa próxima rodada.

    Arquivo alterado: `app/page.tsx` (só a tabela de clientes — filtros,
    "Saúde da operação", "Controle de investimento", "Prioridades de
    hoje", ordenação padrão e todos os cálculos por trás continuam
    exatamente iguais).

50. ✅ Refatoração completa da lógica de sprints: de blocos fixos de dias do
    mês (1–7, 8–14, 15–21, 22–28, resto) para **semanas operacionais reais
    do calendário** (sempre segunda a domingo). Regra final (corrigida
    depois de validar com o usuário): **nenhuma sprint atravessa a
    fronteira do mês** — quando a semana cruzaria a virada, ela é cortada
    no último dia do mês (fica mais curta que 7 dias) e uma nova sprint
    começa no dia 1 do mês seguinte (que na maioria das vezes não cai numa
    segunda-feira). Toda sprint pertence a exatamente um mês.

    **Duas versões nesta etapa**: a primeira implementação permitia uma
    sprint atravessar o mês (ex.: uma única sprint 27/jul–02/ago, com o
    financeiro dividido por trás em `sprint_manual_spend_by_month`). Depois
    de ver isso em prática, o usuário decidiu que prefere sprints nunca
    atravessarem o mês, mesmo cortadas. A tabela e a UI de divisão por mês
    foram **removidas** (nunca chegaram a ter dado real gravado) — deixá-las
    seria manter uma feature permanentemente inatingível.

    **Investigação prévia** (antes de tocar no banco): o esquema já tinha
    granularidade diária em dois pontos-chave — `sprint_planned_allocations`
    (planejado por dia, Etapa 38) e `daily_spend` (gasto sincronizado por
    dia, Etapa 4). Isso significa que o "planejado do mês" já podia ser
    somado corretamente por interseção de data, sem depender de "de qual
    sprint" cada dia vem — o bug real estava só na CAMADA DE APLICAÇÃO, que
    filtrava sprints por "começa neste mês" (`start_date` dentro do range)
    em 5 arquivos diferentes. `sprint_number` nunca foi uma coluna do
    banco: era recalculado de forma independente em 4 lugares diferentes
    (todos assumindo 1 sprint = 1 mês), removido nesta rodada.

    **Migrations** (rodar as duas, nesta ordem, depois de
    `monthly-budget.sql`):
    - `supabase/weekly-sprints.sql`: cria `ensure_weekly_sprints` (gera
      semanas segunda-domingo a partir de "hoje", nunca do formato das
      sprints que já existem), redefine `apply_monthly_budget_change` pra
      selecionar sprints por sobreposição em vez de só `start_date`, e cria
      (depois removida, ver abaixo) `sprint_manual_spend_by_month`.
    - `supabase/sprint-month-boundary-fix.sql` (correção): corrige
      `ensure_weekly_sprints` pra cortar a semana no fim do mês em vez de
      atravessar; corrige qualquer sprint que já tenha sido gerada
      atravessando o mês (só podia ter acontecido se `weekly-sprints.sql`
      já tinha rodado nesta base) — corta cada uma no fim do mês e cria uma
      sprint nova pro restante, **movendo tarefas e alocações de planejado**
      da parte que virou "mês seguinte" pro sprint_id novo, sem apagar
      nada; remove `sprint_manual_spend_by_month` (deixou de fazer
      sentido — toda sprint passa a pertencer a um mês só).
    - `generate_sprints_for_month`/`generate_next_month_sprints` (blocos de
      dia): não removidas — sprints antigas nesse formato continuam
      existindo e consultáveis, histórico preservado — só não são mais
      chamadas por nenhum fluxo.
    - **Limitação documentada**: sprints antigas no formato de blocos de
      dia (1–7, 8–14...) não são convertidas nem divididas em semanas —
      não existe uma correspondência correta entre "dia 3 de um bloco de 7
      dias" e "dia 3 de uma semana real", e inventar essa conversão
      distorceria o histórico. Só a geração de sprints **novas** (a partir
      de agora) usa a regra semanal.

    **Centralização do cálculo** (`lib/sprint-week.ts`, novo +
    `lib/sprint-financials.ts`, estendido): `formatSprintPeriodLabel`
    (identidade "13–19 jul" — substitui "Sprint N" em toda a interface, e
    também cobre naturalmente as sprints curtas cortadas no fim do mês, ex.
    "27–31 jul"). Financeiro por mês: `sumPlannedForMonth` (soma direta das
    alocações diárias por interseção de data — não precisa saber "de qual
    sprint" pro total do mês), `sumExpectedToDateForMonth` (mesma ideia,
    mais precisa que o cálculo proporcional antigo porque usa o valor real
    de cada dia em vez de assumir uma taxa diária uniforme),
    `computeSprintMonthActualSpend`/`sumActualSpendForMonth` (gasto real
    recortado pela interseção sprint×mês). Todas as telas (Visão Geral,
    Sprints, página do cliente, Relatórios, painel-mensal legado) passaram
    a usar essas mesmas funções — nenhuma reimplementa o filtro por conta
    própria.

    **Auto-cura da geração de sprints**: o sistema nunca teve um cron
    automatizado gerando sprints do mês seguinte (`generate_next_month_sprints`
    existia mas nunca era chamada por nada — gap já existente, confirmado
    na investigação). Em vez de depender de agendamento externo, as páginas
    Sprints e Cliente agora chamam `ensure_weekly_sprints` a cada
    carregamento (idempotente, seguro, barato) — a semana atual e as
    próximas sempre existem, sem precisar configurar nada a mais.

    **Páginas atualizadas**: Visão Geral (`app/page.tsx` — coluna "Sprint
    atual" mostra o período da semana, não mais "Sprint N"), Sprints
    (`app/sprints/*` — mesmo período em toda visão), página do cliente
    (`app/clients/[id]/page.tsx`, `client-context-bar.tsx` — "Semana atual ·
    13–19 jul"), Relatórios (`reports/report-data.ts`), orçamento mensal
    (`monthly-budget.ts`/`monthly-budget-editor.tsx` — rótulo "Sprints
    afetadas" também usa o período em vez de "Sprint N").

    Arquivos novos: `supabase/weekly-sprints.sql`,
    `supabase/sprint-month-boundary-fix.sql`, `lib/sprint-week.ts`.
    Alterados: `lib/sprint-financials.ts`, `lib/monthly-budget.ts`,
    `lib/spend-chart-data.ts`, `lib/supabase/database.types.ts`,
    `app/operation/operation-data.ts`, `app/operation/task-drawer-panel.tsx`,
    `app/page.tsx`, `app/clients/page.tsx`, `app/clients/[id]/page.tsx`,
    `app/clients/[id]/layout.tsx`, `app/clients/[id]/tasks/new/page.tsx`,
    `app/clients/client-context-bar.tsx`, `app/clients/sprint-card.tsx`,
    `app/clients/monthly-budget-panel.tsx`,
    `app/clients/monthly-budget-editor.tsx`, `app/sprints/page.tsx`,
    `app/sprints/current-client-group.tsx`,
    `app/sprints/monthly-sprints-group.tsx`, `app/reports/page.tsx`,
    `app/reports/report-data.ts`, `app/painel-mensal/page.tsx` (tela legada,
    sem link em nenhum menu, corrigida só no cálculo de planejado por
    consistência). Nenhuma mudança de design, fonte, cor ou identidade
    visual — só arquitetura, dados e cálculo.

50.1 ✅ Correção crítica: a geração de sprints das duas rodadas anteriores
    ficou com **duas regras simultaneamente ativas** — a antiga
    (`generate_sprints_for_month`, blocos 1–7/8–14/15–21/22–28/29-fim, já
    tinha gerado sprints pra este mês antes desta etapa existir) e a nova
    (`ensure_weekly_sprints`, semanas segunda-domingo) rodaram por cima uma
    da outra sem nenhuma verificação de sobreposição — a única proteção
    existente (`unique(client_id, start_date)`) só barra duas sprints com
    o MESMO dia de início, nunca duas com datas diferentes que se cruzam.
    Resultado real reportado: 9 sprints em julho/2026 (5 blocos antigos +
    4 semanas novas), com dias se repetindo em até duas sprints e duas
    sprints classificadas como "atual" ao mesmo tempo.

    **Regra de calendário única e definitiva**, verificada executando a
    lógica (não só lendo o código) contra ~20 meses diferentes — início em
    qualquer dia da semana, fevereiro bissexto e não bissexto, meses de
    28/29/30/31 dias — via script de verificação executado durante o
    desenvolvimento (não commitado, mesma convenção de scripts ad-hoc já
    usada em etapas anteriores), resultado completo mostrado na entrega
    desta correção:
    - primeiro período: dia 1 do mês até o domingo seguinte (parcial se o
      mês não começar numa segunda);
    - períodos do meio: sempre segunda a domingo, 7 dias;
    - último período: da última segunda-feira até o fim do mês (parcial se
      o mês não terminar num domingo);
    - nenhuma lacuna, nenhuma sobreposição, nenhuma sprint atravessa mês.
    Para julho/2026: exatamente 5 sprints — 01–05, 06–12, 13–19, 20–26,
    27–31.

    **Migration** (`supabase/sprint-calendar-reconciliation.sql`, roda
    depois de `sprint-month-boundary-fix.sql`):
    - `compute_month_sprint_periods(year, month)`: a única fonte da regra
      de calendário — todo o resto do sistema (geração e reconciliação)
      usa essa mesma função, nunca reimplementa o cálculo.
    - `reconcile_client_month_sprints`/`reconcile_all_client_sprints`:
      detecta automaticamente todo cliente/mês com sobreposição real (não
      mexe em meses históricos que só têm o formato antigo sem conflito —
      esses continuam preservados como estavam) e consolida pro calendário
      canônico. Tarefas são reatribuídas pelo próprio `due_date` (nunca
      pela sprint antiga); alocações de planejado (`sprint_planned_allocations`)
      são reatribuídas pela própria `date` — ambas já granulares por dia,
      então a soma financeira do mês é preservada exatamente, sem inventar
      nenhuma distribuição nova. Comentários e gasto manual
      (`manual_actual_spend`), que não têm granularidade diária, vão pro
      período canônico que contém a data de início do bloco antigo — uma
      aproximação documentada (RAISE NOTICE avisa quando isso acontece,
      pra revisão manual em "Editar gasto real"). Nenhum registro é
      apagado antes de seus dados serem migrados; no pior caso (uma
      tarefa cujo `due_date` não bate com nenhum período do mês, o que não
      deveria acontecer em uso normal) a tarefa fica sem sprint vinculada
      (`sprint_id = null`, `on delete set null` na FK) em vez de ser
      apagada — sempre visível em "Outras tarefas".
    - **Proteção de banco real contra sobreposição**: a constraint
      `unique(client_id, start_date)` nunca impedia dois intervalos
      diferentes se cruzarem — só valores idênticos. Adicionada uma
      `exclude using gist (client_id with =, date_range with &&)` (extensão
      `btree_gist`, coluna gerada `date_range`) que bloqueia fisicamente
      qualquer INSERT/UPDATE que crie sobreposição, não importa qual código
      tente fazer isso no futuro.
    - `generate_sprints_for_month`/`generate_next_month_sprints` (blocos de
      dia): **removidas de vez** (não só paradas de chamar) — elas serem
      mantidas como funções chamáveis foi exatamente a causa raiz desta
      correção ("duas regras ativas"). `ensure_weekly_sprints`/
      `backfill_weekly_sprints` também removidas, substituídas por
      `ensure_client_sprints` (mesma regra única de calendário).
    - Validação (`validate_client_sprint_calendar`) roda ao final da
      migration pra todo cliente — se sobrar qualquer sobreposição ou
      sprint atravessando mês, a migration para com erro em vez de deixar
      o banco parcialmente corrigido.

    **Geração deixa de rodar durante o carregamento de página** (Etapa 50
    original chamava `ensure_weekly_sprints` a cada visita a `/clients/[id]`
    — a própria leitura da página gerando registros repetidamente, prática
    que este pedido identificou como incorreta). Removido de
    `app/clients/[id]/layout.tsx` e `app/clients/[id]/page.tsx`; a geração
    contínua agora só acontece via `GET /api/cron/ensure-sprints`
    (`lib/sprint-generation.ts`, mesmo padrão de `/api/cron/sync-meta`) —
    chamada manual ou por cron externo, nunca client-side, nunca dentro de
    um Server Component de página.

    **Distribuição financeira**: como o planejado já é granular por dia
    (`sprint_planned_allocations`) e a reconciliação move essas linhas (não
    recria), o total do orçamento do mês é preservado exatamente — nenhuma
    duplicação, nenhuma perda. `apply_monthly_budget_change` (correção
    anterior) já distribui por dia e soma por sprint automaticamente, então
    sprints de tamanho variável (5/7/7/7/5 dias) já recebem
    `orçamento_diário × dias_da_sprint` sem precisar de nenhuma mudança
    nova aqui.

    **Testes**: não há suíte automatizada de testes neste projeto (mesma
    situação de todas as etapas anteriores). A lógica de calendário foi
    verificada executando (não só lendo) o algoritmo num script ad-hoc
    (mesma convenção já usada em etapas anteriores, não commitado) contra
    os casos pedidos — janeiro
    (início em dia útil), meses começando numa segunda, meses começando
    num domingo, fevereiro bissexto (2024) e não bissexto (2026), meses de
    28/29/30/31 dias — todos passaram (sem lacuna, sem sobreposição, sem
    sprint atravessando mês, soma de dias = dias do mês, primeiro/último
    período correto). A reconciliação de dados (migração de tarefas/
    alocações/comentários) **não pôde ser executada aqui** — este ambiente
    não tem acesso à base Supabase real; ao rodar a migration, o próprio
    SQL Editor mostra um relatório linha a linha (RAISE NOTICE) do que foi
    movido/removido para os dados reais.

    Arquivos novos: `supabase/sprint-calendar-reconciliation.sql`,
    `lib/sprint-generation.ts`, `app/api/cron/ensure-sprints/route.ts`.
    Alterados: `app/clients/[id]/layout.tsx`, `app/clients/[id]/page.tsx`,
    `lib/sprint-week.ts` (comentário), `lib/supabase/database.types.ts`.

    **Correção pós-entrega**: ao rodar a migration acima pela primeira vez,
    o passo que cria a sprint canônica do 1º período do mês (ex.: julho
    01–05) colidia com o bloco antigo (01–07) porque os dois sempre
    **começam no mesmo dia 1 do mês** — só o fim difere. A migration fazia
    um `INSERT` cego pra cada período, o que violava a constraint
    `unique(client_id, start_date)` com o erro `duplicate key value
    violates unique constraint "sprints_client_id_start_date_key"`.
    Corrigido em `reconcile_client_month_sprints` e `ensure_client_sprints`
    (mesma regra nas duas, pra nunca haver comportamento divergente): em
    vez de checar o intervalo exato antes de inserir, a busca agora é por
    `start_date` — se já existir uma sprint com esse início e fim
    diferente, ela é **convertida em lugar** (`UPDATE` do `end_date`, id
    preservado, todo dado já ligado ao id continua ligado sem precisar
    mover nada) em vez de tentar inserir uma segunda linha. Os dias que
    "sobravam" do intervalo antigo mais longo (ex.: dia 06 e 07 do bloco
    01–07 encolhido pra 01–05) são realinhados num passo novo que só roda
    depois que todos os períodos canônicos do mês já existem, garantindo
    que sempre há um destino válido (tarefas por `due_date`, alocações por
    `date`, sem duplicar nem perder valor).

    **2ª correção pós-entrega**: a correção acima expôs um segundo erro —
    `duplicate key value violates unique constraint
    "tasks_template_sprint_unique"` — ao realinhar uma tarefa recorrente
    pra uma sprint canônica recém-criada, essa sprint já tinha sua própria
    tarefa gerada automaticamente a partir do mesmo template (criada no
    próprio passo 3a, por `generate_sprint_tasks_from_templates`), violando
    `unique(template_id, sprint_id)`. Corrigido com a função nova
    `reconcile_move_task_to_sprint(task_id, target_sprint_id)`, usada nos
    dois lugares que movem tarefas (realinhamento pós-conversão e migração
    de blocos antigos, uma única regra pras duas): antes de mover, checa se
    o destino já tem uma tarefa do mesmo template — se tiver, essa
    duplicada foi criada nesta própria migration e não pode ter nenhuma
    interação real ainda (concluída, comentário, responsável), então é
    descartada com segurança (comentários que porventura já tenha são
    migrados antes de apagar) em favor da tarefa que está sendo movida, que
    pode carregar histórico real.

51 ✅ Reorganização da relação Página do Cliente x Relatório do Cliente —
    as duas telas continuam separadas (objetivos diferentes: Cliente =
    acompanhar/decidir/executar; Relatório = revisar/analisar/explicar/
    planejar), mas ganharam navegação direta uma pra outra e dois blocos que
    faltavam no Relatório pra ele funcionar como fechamento mensal de
    gestão, não só painel de mídia.

    **Levantamento (antes de qualquer código)**: a única duplicação real
    entre as duas páginas era o resumo financeiro do mês (planejado/
    realizado/%) — já apresentado de formas diferentes (cards + gráfico no
    Cliente; bloco compacto + barra no Relatório) e já vindo das mesmas
    funções centrais (`sumPlannedForMonth`/`sumActualSpendForMonth`/
    `classifySpendStatus`), então não havia cálculo duplicado, só a mesma
    pergunta respondida nos dois lugares — mantido, é a informação
    compartilhada que o próprio pedido permite (seção 23). Dois blocos do
    pedido não existiam em lugar nenhum: "Acompanhamento operacional" (Bloco
    do Cliente) e "Comportamento por sprint" + "Análise do gestor" (Blocos
    do Relatório). "Pendências" já existia como `report_action_items`, mas
    misturado dentro de "Próximo mês" — sem separação de "execução em
    aberto" (Pendências) x "síntese estratégica" (Próximos Passos). As
    informações estruturais do cliente (Etapa 27) só apareciam em
    Configurações > Clientes, nunca na própria página do cliente.

    **Migration** (`supabase/report-manager-analysis.sql`): `monthly_reports`
    ganha 5 colunas pro Bloco "Análise do gestor" (retrospectivo: o que
    funcionou, o que não funcionou, problemas, oportunidades, aprendizados
    — nunca confundido com `next_month_*`, que é prospectivo); `report_action_items`
    ganha `title` e `dependency` (agência/cliente/terceiro) pras Pendências.
    Aditiva — nenhuma coluna existente muda, nenhum dado é migrado ou
    reatribuído.

    **Página do Cliente** (central operacional, sem virar relatório):
    - `ClientContextBar`: ação "Ver relatório" (linka direto pro relatório
      do cliente no mês atual, sem passar pela lista geral) e status
      contratual + tempo de relacionamento (reaproveita `CLIENT_STATUS_*`/
      `formatRelationshipDuration`, já existentes desde a Etapa 27/30.4).
    - `OperationalTrackingPanel` (novo): última/próxima otimização, reunião
      e entrega de criativo, numa faixa compacta — nunca inventa cadência:
      "próxima" é sempre a próxima tarefa desse tipo já cadastrada, nunca
      uma previsão calculada. Lógica pura em `lib/operational-tracking.ts`.
    - `EssentialInfoPanel` (novo): as informações estruturais do cliente
      (Etapa 27 — objetivo, produto/serviço principal, região, público,
      diferenciais, restrições, datas sazonais, resumo operacional,
      observações), num `<details>` recolhível por padrão — referência de
      contexto, não compete com o operacional acima.
    - Nada removido: Sprint Atual, tarefas, orçamento, gráfico e alertas
      continuam exatamente como estavam.

    **Relatório do Cliente** (fechamento mensal de gestão): 3 blocos novos/
    reorganizados, usando sempre dados e regras já centrais:
    - **Comportamento por sprint** (novo): uma linha por sprint do mês
      (período/planejado/realizado/%/situação/execução), via
      `computeSprintBehaviorRows` (`lib/monthly-reports.ts`) — reaproveita
      `computeSprintMonthActualSpend`/`computeSprintExpectedToDate`/
      `classifySpendStatus`/`formatSprintPeriodLabel`, nenhum cálculo novo.
    - **Análise do gestor** (novo): os 5 campos estruturados do pedido,
      editáveis pela mesma action genérica (`updateReportFieldsAction`) já
      usada pelo resumo executivo e por Próximos Passos.
    - **Pendências** (separado de "Próximo mês"): a lista que já existia
      (`report_action_items`) agora é sua própria seção, com título e
      dependência (agência/cliente/terceiro) — nunca substitui as tarefas
      operacionais da sprint, que continuam só em `/clients/[id]`.
    - **Próximos Passos**: os campos `next_month_*` que já existiam,
      isolados da lista de pendências — síntese estratégica, não checklist.
    - "Voltar ao cliente" no cabeçalho, ao lado de "← Relatórios" — preserva
      a navegação direta nos dois sentidos pedida na seção 24.
    - Snapshot de finalização (`finalizeReportAction`) passa a incluir
      `sprintBehavior`, pro relatório finalizado congelar também esse bloco
      novo — os 5 campos de Análise do Gestor não entram no snapshot pelo
      mesmo motivo que `next_month_*` nunca entraram: são colunas de
      `monthly_reports`, não dado recalculado a partir de sprints/tarefas.

    **Não implementado nesta rodada** (fora de escopo, por pedido explícito):
    seletor de mês na própria página do cliente (ela sempre mostra o mês
    atual — "Ver relatório" linka pro relatório desse mesmo mês); PDF, IA,
    link público, novas integrações, automação de "enviar pendência pra
    tarefa" além da que já existia.

    **Testes**: não há suíte automatizada de testes neste projeto (mesma
    situação de todas as etapas anteriores). Verificado manualmente: nenhum
    `onClick`/`onChange`/`onSubmit` novo em Server Component (todas as ações
    novas usam `action={...}` de Server Actions, mesmo padrão de sempre);
    `tsc --noEmit`, lint e build sem erros.

    Arquivos novos: `supabase/report-manager-analysis.sql`,
    `lib/operational-tracking.ts`, `app/clients/operational-tracking-panel.tsx`,
    `app/clients/essential-info-panel.tsx`. Alterados:
    `lib/supabase/database.types.ts`, `lib/monthly-reports.ts`,
    `app/reports/report-data.ts`, `app/reports/report-actions.ts`,
    `app/reports/[clientId]/page.tsx`, `app/clients/[id]/layout.tsx`,
    `app/clients/client-context-bar.tsx`, `app/clients/[id]/page.tsx`.

52 ✅ Hierarquia visual e UX de "Tarefas da Sprint" — só apresentação, sem
    tocar em regra de negócio, geração de tarefas, banco de dados, conclusão/
    edição/exclusão, responsáveis, filtros ou outras telas.

    **Levantamento**: `TaskRow` (`app/clients/task-row.tsx`) já era o
    componente único reaproveitado por `TaskList` (tarefas soltas),
    `SprintTaskList` (tarefas da sprint, dentro de `SprintCard`) e a tela
    Sprints (`monthly-consolidated-group.tsx`) — nenhuma duplicação de
    componente encontrada. `SprintTaskList` é usada exclusivamente por
    `SprintCard`, que por sua vez é reaproveitado pela página do cliente e
    pelas duas telas de Sprints — qualquer ajuste em `TaskRow`/
    `SprintTaskList` reflete nos três lugares automaticamente.

    **Mudanças** (todas em `TaskRow` e `SprintTaskList`, mesma ordem
    [conclusão] [data] [tarefa] [responsável] [status] [ações] de antes):
    - Data: nova `formatCompactTaskDate` (`lib/format.ts`) — "07/07 · TER"
      em largura fixa, substitui o dia da semana por extenso.
    - Nome da tarefa: removido o tipo (`TASK_TYPE_LABEL`) ao lado do
      título — tarefas geradas por template já têm o tipo como próprio
      título (ex.: "Otimização"), mostrar os dois repetia a mesma palavra.
    - Tarefas concluídas: removido o tachado e o badge "Feito" — agora só
      o check verde + opacidade reduzida da linha (um sinal em vez de três).
    - Tarefas atrasadas: círculo e data em vermelho discreto (sem negrito) +
      badge "Atrasado"; o nome da tarefa continua em cor neutra.
    - Status temporal: badge só aparece quando agrega informação
      ("Atrasado", "Hoje") — removido pra tarefas futuras normais
      (eliminado o badge "Pendente" redundante com o próprio check vazio).
    - Cabeçalho da lista: "2 de 4 concluídas" subiu pra mesma linha do
      título/ação (antes ficava isolado abaixo da barra); barra mais fina;
      "+ Adicionar tarefa na sprint" virou "+ Tarefa".
    - Densidade: padding vertical da linha reduzido levemente.

    **Testes**: não há suíte automatizada neste projeto. Confirmado
    manualmente que nenhum `onClick`/`onChange`/`onSubmit` foi introduzido
    em Server Component; `completeTaskAction` (concluir), os links do drawer
    (editar/excluir/comentar) e a busca de responsável continuam
    exatamente como estavam — só o CSS/JSX da apresentação mudou.
    `tsc --noEmit`, lint e build sem erros.

    Arquivos alterados: `app/clients/task-row.tsx`,
    `app/clients/sprint-task-list.tsx`, `lib/format.ts` (função
    `formatWeekdayAndDate`, que só era usada aqui, foi substituída por
    `formatCompactTaskDate`).

53 ✅ Dois erros na identificação e exibição das sprints.

    **Causa raiz #1 — "Bateu meta" em sprint futura/sem planejamento**:
    `lib/spend-status.ts` tinha `SPEND_STATUS_LABEL.dentro = "Bateu meta"` —
    e `classifySpendStatus` tratava um período que ainda não começou
    (`expected <= 0` com planejamento configurado) como `"dentro"`, já que 0
    gasto vs. 0 esperado batia matematicamente. Uma sprint futura com
    orçamento definido caía exatamente nesse ramo e mostrava "Bateu meta".

    **Causa raiz #2 — sprint errada marcada como atual**: `app/clients/[id]/page.tsx`
    calculava "hoje" com `new Date()` puro (instante real do relógio),
    diferente de toda outra tela do sistema, que já usa `todayUTC()`
    (meia-noite UTC do dia civil em `America/Sao_Paulo`, `lib/today.ts`).
    Como o Brasil é UTC-3, entre ~21h e 23h59 (horário de SP) o relógio UTC
    real já virou o dia seguinte — nesse intervalo, `new Date()` produzia um
    "hoje" adiantado em 1 dia, fazendo a sprint 06–12/jul virar "concluída"
    e a 13–19/jul virar "atual" horas antes do dia realmente virar.

    **Correção — Bloco 1: remover "Bateu meta"**. `spend-status.ts`:
    `dentro` → **"Dentro"**, `sem_meta` → **"Sem planejamento"** (nunca
    "Meta não configurada"/"Bateu meta"/"Meta atingida"). Estados
    financeiros permitidos: Abaixo/Dentro/Acima/Sem planejamento — mais um
    quinto estado novo, temporal-mas-tratado-como-financeiro, explicado
    abaixo.

    **Correção — Bloco 2: sprint futura nunca tem classificação financeira
    normal**. `SpendStatus` ganha `"nao_iniciado"` ("Ainda não iniciada") —
    só produzido por `classifySprintSpendStatus` (nova, `sprint-financials.ts`),
    nunca por `classifySpendStatus` (que continua puramente numérica, sem
    saber se o período já começou). Uma sprint futura mostra 0% gasto, 0%
    esperado, badge "Ainda não iniciada", saldo "Período ainda não
    iniciado" e a barra sem marcador — nunca "Dentro"/"Bateu meta".

    **Correção — Bloco 4/5/6/7: uma única regra de sprint atual**.
    Centralizado em `lib/sprint-financials.ts`:
    - `isDateWithinPeriod(date, start, end)` — comparação civil YYYY-MM-DD,
      bordas inclusivas, sem nenhuma conversão de timezone.
    - `findSprintForDate(sprints, date)` — substitui a mesma expressão
      `s.start_date <= todayStr && s.end_date >= todayStr` que estava
      duplicada em 4 arquivos (`app/page.tsx`, `app/sprints/page.tsx`,
      `app/clients/page.tsx`, `app/clients/[id]/layout.tsx`).
    - `getSprintTemporalStatus(sprint, today)` — única fonte de
      concluída/atual/futura, usada por `computeSprintFinancials`.
    - `classifySprintSpendStatus(sprint, actual, expected, plannedTotal, today)` —
      única fonte do status financeiro por sprint (futura → sempre
      "nao_iniciado"), usada tanto por `computeSprintFinancials` (cartão da
      sprint) quanto por `computeSprintBehaviorRows` (Comportamento por
      Sprint do Relatório, Etapa 51) — essa segunda função chamava
      `classifySpendStatus` direto, sem saber se a sprint tinha começado, e
      também mostraria "Bateu meta" pra sprints futuras dentro do mês do
      relatório.
    - `assertSingleCurrentSprint(sprints, today)` — validação de
      desenvolvimento (não lança exceção, só avisa no console fora de
      produção) que detecta mais de uma sprint "atual" simultânea — segunda
      camada de defesa além da constraint `sprints_no_overlap` (Etapa 50).

    **Timezone operacional**: `America/Sao_Paulo`, já centralizado em
    `lib/today.ts` desde antes desta etapa (`APP_TIMEZONE`) — o problema
    nunca foi a ausência de uma constante central, foi um único call site
    (`[id]/page.tsx`) que não a usava. Nenhuma outra tela tinha esse bug —
    confirmado grepando todo `new Date()` sem argumento no repositório: só
    havia esse, os demais são todos timestamps reais (`updated_at`,
    `synced_at`), não "hoje" operacional.

    **Reutilização global**: página do cliente, `/clients`, `/sprints`,
    Visão Geral e Relatórios (Comportamento por Sprint) passaram a usar as
    mesmas 4 funções centrais acima — nenhuma tela ficou com sua própria
    comparação de data ou sua própria regra de status.

    **Testes**: não há suíte automatizada neste projeto. A lógica de data/
    status foi extraída e executada de verdade num script ad-hoc (não
    commitado) reproduzindo os dois bugs originais bit a bit (`new Date()`
    puro às 22h de 12/07 em SP vira 13/07 em UTC → 06–12 "concluída" e
    13–19 "atual", exatamente o reportado) e confirmando a correção
    (`todayUTC()` mantém 06–12 "atual" e 13–19 "futura" no mesmo instante),
    além de bordas inclusivas, virada de mês, virada de ano, planejado
    zero, sprint concluída sem planejamento (continua "sem_meta", não
    "nao_iniciado") e ausência de NaN/Infinity em qualquer cenário.
    `tsc --noEmit`, lint e build sem erros.

    Arquivos alterados: `lib/spend-status.ts`, `lib/sprint-financials.ts`,
    `lib/monthly-reports.ts`, `app/clients/[id]/page.tsx`,
    `app/clients/[id]/layout.tsx`, `app/clients/page.tsx`, `app/page.tsx`,
    `app/sprints/page.tsx`, `app/clients/sprint-card.tsx`,
    `app/clients/sprint-financial-bar.tsx`, `app/clients/client-metrics-cards.tsx`,
    `app/reports/page.tsx`, `app/reports/[clientId]/page.tsx`,
    `app/sprints/account-card-summary.tsx`.

54 ✅ Reorganização de conteúdo e hierarquia da Página do Cliente (exclusiva
    desta tela — banco, RLS, cálculos financeiros, identificação de sprints,
    tarefas, Meta API, Relatórios, Sidebar/Topbar e identidade visual geral
    não foram tocados).

    **Levantamento**: os 4 cards do topo vinham de `ClientMetricsCards`
    (`app/clients/client-metrics-cards.tsx`), só usada nesta página.
    Projeção do mês vinha de `computeMonthProjection` (`lib/client-metrics.ts`)
    — mantida no arquivo (é possível que volte a ser útil), só parou de ser
    chamada aqui. O gráfico vinha de `SpendChart`/`computeCumulativeSpendSeries`
    (`app/clients/spend-chart.tsx`+`lib/spend-chart-data.ts`), usados só
    aqui. Acompanhamento operacional e Prioridades (antes "Atenção") já
    existiam (Etapa 51/anteriores) — só precisavam de reordenação, ajuste de
    rótulo e duas lacunas reais: nenhum dos três nunca tinha nenhum registro
    mostrava "Nunca" em destaque, e uma reunião/otimização/entrega atrasada
    (nunca concluída) ficava invisível (nem "última" nem "próxima" a
    capturavam). Sprints do mês listava todas as sprints juntas, sem separar
    a atual das demais.

    **Removido do topo** (nenhum apagado do sistema, só reapresentado):
    `ClientMetricsCards`, `SpendChart`, `spend-chart-data.ts` — como não
    tinham nenhum outro consumidor, foram deletados por completo (ver
    padrão de "não deixar código morto" já seguido nas etapas anteriores).
    `computeMonthProjection` continua em `lib/client-metrics.ts`, só sem uso
    nesta página.

    **Bloco 1 — Investimento do mês** (`month-investment-summary.tsx`,
    novo): planejado, realizado, % realizado, % esperado, diferença em R$
    pro ritmo esperado e situação (Dentro/Acima/Abaixo/Sem planejamento — a
    mesma nomenclatura da Etapa 53, nunca "Bateu meta"). Reaproveita
    `AgencyInvestmentBar` (já usada na Visão Geral e em Relatórios — nenhuma
    barra nova) no lugar do gráfico removido. Nenhum cálculo novo: os
    mesmos `monthPlanned`/`monthActual`/`monthExpectedToDate`/`monthStatus`
    de sempre (`sumPlannedForMonth`/`sumActualSpendForMonth`/
    `sumExpectedToDateForMonth`/`classifySpendStatus`). `MonthlyBudgetPanel`
    (edição de orçamento) continua logo abaixo, mesmo componente e mesma
    regra de sempre.

    **Bloco 2 — Acompanhamento operacional**: "Última execução operacional"
    (Etapa 15: tarefa criada/concluída/editada/comentada ou sprint
    comentada — nunca sync do Meta ou login) integrada ao cabeçalho da
    própria seção em vez de card isolado; texto local "Sem registro" no
    lugar de "Nunca" (só aqui — `formatLastActivityLabel`/
    `formatLastOptimizationLabel` continuam retornando o texto de sempre
    pra quem mais os usa, Visão Geral inclusive). `computeOperationalTracking`
    (`lib/operational-tracking.ts`) ganhou a detecção que faltava: uma
    tarefa atrasada (nunca concluída) agora sempre vence uma futura como
    "próxima" — antes ficava invisível, sem aparecer nem como última nem
    como próxima; a UI marca esse caso com "(atrasada)" em âmbar.

    **Bloco 3 — Prioridades** (antes "Atenção", `attention-panel.tsx`): só o
    rótulo mudou — a lógica de severidade/agrupamento (`buildAttentionAlerts`,
    `KIND_PRIORITY`) já existia e já limitava a 3 visíveis com "Ver
    todas as N" (só o texto do link foi ajustado); nenhum score novo.

    **Bloco 4 — Sprint atual**: passa a mostrar só a sprint com
    `temporalStatus === "atual"` (regra central da Etapa 53), nunca todas
    juntas. Se nenhuma existir, mensagem explícita em vez de escolher
    qualquer uma. Mesmo `SprintCard` de sempre, mesmas ações.

    **Bloco 5 — Histórico do mês** (novo): as demais sprints do mês
    (concluídas e futuras), recolhidas por padrão (`defaultOpen={false}`) —
    cada uma já mostra seu próprio selo temporal (Concluída/Futura), sem
    repetir a sprint atual.

    **Testes**: não há suíte automatizada neste projeto. Confirmado
    manualmente: os 4 cards antigos, a projeção e o gráfico não aparecem
    mais; investimento/realizado/esperado/diferença continuam batendo com
    os mesmos números de antes (nenhuma fonte de dado trocada); existe
    sempre no máximo uma "Sprint atual" (mesma garantia de
    `assertSingleCurrentSprint` da Etapa 53); tarefas, comentários e ações
    da sprint continuam funcionando (mesmo componente); informações
    essenciais continuam acessíveis, sem mudança de posição relativa às
    outras seções secundárias. `tsc --noEmit`, lint e build sem erros.

    Arquivos novos: `app/clients/month-investment-summary.tsx`. Removidos:
    `app/clients/client-metrics-cards.tsx`, `app/clients/spend-chart.tsx`,
    `lib/spend-chart-data.ts`. Alterados: `app/clients/[id]/page.tsx`,
    `app/clients/attention-panel.tsx`, `app/clients/operational-tracking-panel.tsx`,
    `lib/operational-tracking.ts`.

55. ✅ **Área Equipe — membros da equipe desacoplados de `auth.users`**

    **Investigação prévia**: o único registro de identidade existente era
    `profiles` (`id uuid primary key references auth.users (id) on delete
    cascade`) — 1:1 obrigatório com uma conta de login, papel
    `role check (role in ('admin','gestor'))` misturando cargo e autorização
    no mesmo campo. 13 colunas em 8 arquivos SQL diferentes apontavam direto
    pra `profiles(id)` (`client_managers.user_id`, `tasks.assignee_id`,
    `comments.author_id`, `clients.primary_manager_id`,
    `sprint_task_templates.default_assignee_id`,
    `monthly_budget_changes.changed_by`, `monthly_reports.finalized_by`,
    `report_timeline_events.responsible_id`/`created_by`,
    `report_comment_selections.created_by`,
    `report_action_items.responsible_id`, `operational_activities.user_id`,
    além de `client_task_templates.default_assignee_id` — essa última numa
    tabela já desativada desde a Etapa 12, sem nenhum código lendo dela, por
    isso ficou de fora do repoint). Não existia nenhum conceito de
    organização/agência/tenant em lugar nenhum do schema. `is_admin()` e
    `is_client_manager()` (`supabase/policies.sql`) resolviam tudo comparando
    com `auth.uid()` direto. `getCurrentProfile()` (`lib/auth.ts`) buscava em
    `profiles` e devolvia `{id, name, role}` — mais de 30 pontos do app usam
    esse retorno. Não existe tabela de reuniões: "reunião" já é
    `tasks.type = 'reuniao'` desde a Etapa 45. Não havia rota `/team`
    preparada; o item "Equipe" na Sidebar já existia, sem `href`, mostrando
    "Em breve".

    **Decisão de arquitetura**: nova tabela `team_members` como identidade
    operacional canônica, com `auth_user_id` **opcional** (nullable,
    `references auth.users on delete set null`) — um membro pode existir,
    ser responsável por clientes/tarefas e aparecer no histórico sem nunca
    ter login. `profiles` **não foi apagada** (dado preservado, mesmo
    espírito da Etapa 12 com `client_task_templates`: fica desativada, nada
    no app volta a lê-la). Pra repontar as 12 colunas sem precisar de
    `UPDATE` em nenhuma linha, o backfill reaproveita o mesmo `id` de cada
    `profiles` existente como `id` do `team_member` correspondente — todo
    valor já gravado nessas colunas (que hoje é um `profiles.id`) já bate
    certinho com o novo `team_members.id`, então só a *constraint* muda de
    tabela-alvo, o dado em si nunca muda. `is_admin()`/`is_client_manager()`
    mantiveram o mesmo nome e assinatura (só o corpo passou a consultar
    `team_members`), então nenhuma policy escrita em nenhuma migration
    anterior precisou ser reescrita. `getCurrentProfile()` manteve o retorno
    `{id, name, role}` (ganhou só `organizationId` a mais) — como
    `team_members.id` substitui `profiles.id` com o mesmo valor pros
    membros migrados, todo `.eq("assignee_id", profile.id)`/`created_by:
    profile.id` já existente no app passou a apontar certo sem precisar
    tocar em cada chamada individualmente.

    **Multi-agência (preparado, não implementado por completo)**: nova
    tabela `organizations` com uma única linha semeada
    ("Organização principal", nenhum nome de agência hardcoded); todo
    `team_member` tem `organization_id not null`; RLS de `team_members`
    isola por organização (`organization_id = current_organization_id()`).
    Não foi construída nenhuma UI de troca de organização nem convite
    entre agências — fora de escopo desta etapa.

    **Dois conceitos separados**: `job_title` (cargo operacional, texto
    livre — "Gestor de tráfego", "Coordenador de mídia") nunca decide
    autorização; `system_role` (`admin`/`gestor`) é só isso. `status`
    (Ativo/Inativo, nunca apaga) é independente de `invitation_status`
    (Sem acesso/Convite pendente/Acesso ativo) — um membro pode estar
    "Ativo na equipe" e "Sem acesso ao sistema" ao mesmo tempo.

    **Fluxo de convite** (`app/team/actions.ts`, só server-side): admin
    clica "Convidar para o sistema" → valida admin + mesma organização +
    e-mail válido + ainda sem `auth_user_id` → `createAdminClient()`
    (service_role, já existia em `lib/supabase/admin.ts` pro sync do Meta)
    chama `auth.admin.inviteUserByEmail` → se o e-mail já existir no
    Supabase Auth, localiza o usuário no servidor (`listUsers` paginado) em
    vez de tentar criar duplicado, e nunca revela detalhes da conta
    encontrada na resposta → vincula `auth_user_id` e marca
    `invitation_status` (`convite_pendente` pra usuário novo,
    `acesso_ativo` pra usuário já existente vinculado) → se qualquer passo
    falhar, o membro continua existindo (nunca é apagado por causa de falha
    no envio). "Revogar acesso" bloqueia login via
    `auth.admin.updateUserById(id, { ban_duration: "876000h" })` sem apagar
    a conta (preserva autoria de comentários antigos, que sempre apontou
    pra `team_members.id`, nunca pra `auth.users` diretamente). A
    `service_role` key nunca é importada fora de `app/team/actions.ts` /
    `lib/meta-sync.ts` / `lib/sprint-generation.ts` (os únicos arquivos que
    usam `createAdminClient()`), nunca é `NEXT_PUBLIC_`, nunca aparece em
    log nem em mensagem de erro (toda falha vira um redirect com texto
    curto, nunca o objeto de erro cru do Supabase).

    **Vínculo `auth.users` ↔ `team_members`**: escrito no momento do
    convite (a chamada admin já devolve o id do usuário criado/localizado);
    como rede de segurança, `getCurrentProfile()` também tenta um vínculo
    idempotente pós-login (só quando ainda não há `auth_user_id`, buscando
    por e-mail com `invitation_status = 'convite_pendente'`) — nunca
    reautoriza só por e-mail depois que o vínculo já existe, e usuário
    autenticado sem `team_member` correspondente não recebe nenhum acesso
    automático (a Sidebar simplesmente não aparece, mesmo padrão que já
    existia pra qualquer `profile` nulo).

    **Página `/team`**: tabela compacta (Membro/Cargo/Papel/Clientes/
    Status/Acesso/Ação), resumo discreto no topo ("X ativos · Y com acesso ·
    Z convites pendentes"), sem cards grandes, sem jargão técnico visível.
    Aberta pra Admin e Gestor (Gestor só visualiza — RLS de
    `team_members_insert`/`update` é admin-only, e o botão "+ Novo membro" e
    as ações de convite/desativação somem da UI pra Gestor, mas a garantia
    real está no servidor). "+Novo membro"/"Editar" abrem um drawer lateral
    (mesmo padrão de `MonthlyBudgetHistoryDrawer`), com Dados/Operação
    (clientes atribuídos, tarefas pendentes, reuniões futuras — calculadas
    a partir de `tasks` já existentes, sem tabela nova)/Acesso. Desativar
    mostra o impacto (nº de clientes/tarefas) antes de confirmar
    (`window.confirm`, mesmo padrão do `DeleteClientButton`).

    **Seletores/atribuição**: `clients.primary_manager_id`,
    `client_managers` (gestores de apoio), `tasks.assignee_id` e
    `sprint_task_templates.default_assignee_id` agora listam membros ativos
    da equipe (`team_members` com `status = 'ativo'`), sem mais filtrar por
    `role = 'gestor'` — qualquer membro ativo pode ser responsável,
    reforçando que cargo/autorização são coisas diferentes. Visibilidade de
    clientes entre gestores **não mudou** (RLS de `clients_select`
    intocada). Tarefa com responsável desativado preserva o histórico e
    mostra "(inativo)" ao lado do nome; nunca é reatribuída
    automaticamente.

    **Não implementado nesta etapa** (fora do pedido): exclusão permanente
    de membro pela interface principal; filtros dedicados de
    gestor/responsável (não existiam antes — nada pra migrar); troca de
    organização/convite entre agências; gamificação, bonificação, folha de
    pagamento.

    **Testes**: não há suíte automatizada neste projeto. Confirmado
    manualmente/por leitura: exatamente as 12 colunas repontadas continuam
    com os mesmos valores após o backfill (mesmo `id` reaproveitado, sem
    `UPDATE` de dado); `is_admin()`/`is_client_manager()` mantiveram nome e
    assinatura; nenhuma chamada restante grava `auth.users.id` cru em
    `author_id`/`assignee_id`/`user_id` de log (`tasks-actions.ts`,
    `comments-actions.ts` e `report-actions.ts` foram corrigidos pra usar
    `getCurrentProfile().id`); `client-form.tsx` não referencia mais
    "Supabase Auth" na mensagem de lista vazia. `tsc --noEmit`, `npm run
    lint` e `npm run build` sem erros.

    Arquivos novos: `supabase/team-members.sql`, `lib/team-members.ts`,
    `app/team/page.tsx`, `app/team/team-table.tsx`,
    `app/team/team-member-drawer.tsx`, `app/team/deactivate-member-button.tsx`,
    `app/team/actions.ts`. Alterados: `lib/auth.ts`,
    `lib/supabase/database.types.ts`, `app/sidebar.tsx`,
    `app/clients/task-row.tsx`, `app/clients/client-form.tsx`,
    `app/clients/tasks-actions.ts`, `app/clients/comments-actions.ts`,
    `app/reports/report-actions.ts`, `app/reports/report-data.ts`, e as
    consultas a `profiles` em `app/page.tsx`, `app/clients/page.tsx`,
    `app/clients/[id]/page.tsx`, `app/clients/[id]/layout.tsx`,
    `app/clients/new/page.tsx`, `app/clients/[id]/edit/page.tsx`,
    `app/clients/[id]/tasks/new/page.tsx`,
    `app/clients/[id]/tasks/[taskId]/edit/page.tsx`, `app/sprints/page.tsx`,
    `app/reports/page.tsx`, `app/settings/clients/page.tsx`,
    `app/settings/sprint-task-templates/page.tsx`.

56. ✅ **Telemetria operacional interna (`operational_events`)**

    **Investigação prévia**: não existia reabertura de tarefa em lugar
    nenhum do app (só "reabrir relatório mensal", entidade diferente) —
    `task_reopened` fica reservado na taxonomia, sem emissão, até essa
    funcionalidade existir. `updateTaskAction` fazia um `update` cego em
    `assignee_id`/`due_date` sem nunca ler o valor anterior — não dava pra
    saber se houve reatribuição/alteração de prazo, nem preservar o prazo
    original. `tasks` não tinha `completed_at`, nem contadores de
    reatribuição/alteração de prazo/reabertura. `operational_activities`
    (Etapa 15) já existe, mas é um log fino e específico (5 tipos, sem
    prazo/atraso/metadata) que alimenta o painel "Acompanhamento
    operacional" — não dava pra virar a base desta telemetria sem quebrar
    esse contrato já lido pela UI, por isso a tabela nova coexiste com ela
    em vez de substituí-la. Não existe `idempotency_key` em nenhum lugar do
    schema — a convenção já usada no projeto pra evitar duplicata é índice
    único parcial + `on conflict do nothing`, replicada aqui. "Reunião" e
    "entrega de criativos" continuam sendo só `tasks.type`, sem tabela
    própria (Etapa 45) — não foi criada nenhuma tabela nova só pra gerar
    evento.

    **Schema**: `operational_events` (append-only, sem policy de
    update/delete pra ninguém) com a taxonomia completa pedida via `check`
    de `event_type` (espelhada 1:1 em `lib/operational-events.ts`,
    `OperationalEventType`, nunca string solta no código), ator separado em
    `actor_team_member_id`/`actor_auth_user_id`, `expected_at`/
    `completed_at`/`was_on_time`/`delay_seconds` (segundos, convertido pra
    horas/dias só na apresentação), `correlation_id` (liga
    `task_completed` ao `optimization_completed`/`meeting_completed`/
    `creative_delivery_completed` da mesma conclusão), `idempotency_key`
    (índice único parcial). `tasks` ganhou `original_due_date` (nunca
    reescrito depois da criação), `completed_at`, `completion_count`,
    `reassignment_count`, `due_date_change_count`, `reopened_count` —
    aditivo, backfill de `original_due_date = due_date` (não recupera um
    valor anterior à migration, que nunca existiu) e `completed_at` fica
    `null` pro histórico (sem dado confiável de quando cada tarefa antiga
    foi concluída — mesma decisão já tomada pelo backfill de
    `operational_activities`).

    **Serviço central**: `lib/record-operational-event.ts`
    (`recordOperationalEvent`) — único ponto que grava na tabela; sempre
    chamado depois de uma mutação já ter tido sucesso, nunca no navegador.
    Ator/organização sempre resolvidos no servidor via `getCurrentProfile()`
    (que ganhou `authUserId`); a RLS de insert é a segunda camada de defesa
    (`organization_id = current_organization_id()` e, quando há ator,
    `actor_team_member_id = current_team_member_id()`), então mesmo um
    insert direto forjado não conseguiria gravar em nome de outra
    organização ou de outro usuário.

    **Transação**: conclusão de tarefa passou a rodar inteira dentro de
    `complete_task_and_record_event` (função de banco) — atualiza `tasks` e
    grava `task_completed` (+ o evento específico do tipo, correlacionado)
    numa única transação; nunca tarefa concluída sem evento nem evento sem
    conclusão real. `apply_monthly_budget_change` (já existente, Etapa 38)
    foi estendida do mesmo jeito pra também gravar
    `monthly_budget_created`/`monthly_budget_changed` atomicamente. Os
    demais eventos (membro da equipe, cliente, relatório, criação/
    atribuição/alteração de prazo de tarefa) são gravados sequencialmente
    na mesma Server Action logo após a mutação principal ter sucesso —
    disclosure explícito: não são uma transação de banco única, mas o risco
    é baixo (cada mutação principal já é um único `update`/`insert` que
    raramente falha parcialmente) e o registro do evento nunca derruba a
    ação principal se falhar.

    **Idempotência**: `idempotency_key` só nos dois eventos com risco real
    de duplo clique/retry (`task_completed` e o evento correlacionado do
    tipo), no formato `evento:tarefa:versão` (usando `completion_count`
    como versão) — `on conflict (idempotency_key) where idempotency_key is
    not null do nothing`, mesma convenção de índice único parcial já usada
    em outras tabelas do projeto.

    **No prazo/atraso**: calculado server-side em
    `complete_task_and_record_event`, usando `(due_date + 1)::timestamp at
    time zone 'America/Sao_Paulo'` (o prazo vence à meia-noite do dia
    seguinte no fuso da agência — a tarefa pode ser concluída o dia inteiro
    do `due_date`, mesma regra de `lib/task-status.ts`). Guardado tanto em
    relação ao prazo vigente quanto ao original (`was_on_time_original_due_date`
    em metadata), pra nunca parecer que uma tarefa sempre esteve no prazo
    só porque o prazo foi adiado depois de vencida.

    **Eventos instrumentados** (com dado real, sem nada inventado):
    `team_member_created/updated/deactivated/reactivated/invited/
    access_activated/access_revoked` (`app/team/actions.ts`, mais o
    fallback de vínculo pós-login em `lib/auth.ts`); `client_created/
    manager_assigned/manager_changed/status_changed`
    (`app/clients/actions.ts`, `app/settings/clients/actions.ts`);
    `task_created/assigned/reassigned/due_date_changed/completed`
    (`app/clients/tasks-actions.ts`); `optimization_completed/
    meeting_completed/creative_delivery_completed` (derivados de
    `task_completed` conforme `tasks.type`, correlacionados);
    `monthly_budget_created/changed` (RPC); `monthly_report_started/
    ready_for_review/finalized/reopened` (`app/reports/report-data.ts`,
    `app/reports/report-actions.ts`).

    **Ainda não implementados** (disclosure explícito, seção 20 do
    pedido): `task_reopened` (funcionalidade de reabrir tarefa não existe);
    `meeting_scheduled/rescheduled/cancelled` e
    `creative_delivery_scheduled` (reunião/criativo são só `tasks.type` —
    "agendar"/"reagendar" já SÃO `task_created`/`task_due_date_changed`,
    duplicar seria o mesmo acontecimento sem informação nova; "cancelar"
    exigiria exclusão de tarefa, que não existe); `creative_delivery_late`
    e outros eventos de TRANSIÇÃO DE ESTADO (seção 20/21) — exigem um job
    de monitoramento, explicitamente fora de escopo nesta etapa.

    **Equipe — Atividade operacional**: nova seção no drawer do membro
    (`app/team/operational-activity-panel.tsx`), com seletor 7 dias/30
    dias/Mês atual (padrão Mês atual) — indicadores só descritivos (tarefas
    concluídas/no prazo/atrasadas, taxa no prazo, atraso médio,
    otimizações/reuniões/criativos realizados, reaberturas, reatribuições
    recebidas/repassadas), nunca chamados de "produtividade", sem score nem
    ranking. Timeline paginada abaixo (15 por página), sem metadata bruto —
    só rótulo/cliente/tarefa/prazo já resolvidos
    (`lib/team-member-activity.ts`).

    **Segurança**: nenhuma escrita em `operational_events` acontece no
    navegador; `actor_id`/`organization_id`/`was_on_time`/`delay_seconds`
    são sempre calculados no servidor, nunca aceitos de input do cliente; a
    RLS de insert é a rede de segurança adicional (ver acima); tabela é
    append-only pra qualquer papel, inclusive admin.

    **Testes**: não há suíte automatizada neste projeto. Confirmado por
    leitura/rastreamento manual: cada `record_operational_event`/RPC só
    grava depois da mutação principal ter sucesso; `actor_team_member_id`
    nunca é copiado do responsável da tarefa (sempre quem está logado,
    resolvido via `getCurrentProfile()`); `original_due_date` nunca é
    reescrito em `updateTaskAction`; a constraint `on conflict
    (idempotency_key) where idempotency_key is not null` previne duplicata
    de `task_completed` em double-click/retry; nenhum evento de estado
    (`*_late`) é emitido (não implementados). `tsc --noEmit`, `npm run
    lint` e `npm run build` sem erros.

    Arquivos novos: `supabase/operational-events.sql`,
    `lib/operational-events.ts`, `lib/record-operational-event.ts`,
    `lib/team-member-activity.ts`, `app/team/operational-activity-panel.tsx`.
    Alterados: `lib/auth.ts`, `lib/supabase/database.types.ts`,
    `app/clients/tasks-actions.ts`, `app/clients/actions.ts`,
    `app/settings/clients/actions.ts`, `app/reports/report-actions.ts`,
    `app/reports/report-data.ts`, `app/team/actions.ts`,
    `app/team/page.tsx`, `app/team/team-member-drawer.tsx`.

57. ✅ **Análises da Conta e Otimizações (substitui a tarefa recorrente "Otimização")**

    **Estrutura anterior**: "otimização" era só `tasks.type = 'otimizacao'`,
    gerada automaticamente por um template global (`sprint_task_templates`,
    Etapa 12) — o gestor só marcava a tarefa como feita, sem nenhum registro
    do que foi analisado/alterado, sem cadência configurável (só um lookback
    fixo de 14 dias já usado em `buildAttentionAlerts`), sem correlação com
    otimizações específicas. `lib/operational-tracking.ts` já documentava
    explicitamente essa ausência de regra de cadência.

    **Remoção da geração futura**: o(s) template(s) globais com
    `type = 'otimizacao'` foram desativados (`is_active = false`, nunca
    apagados) — identificado pelo `type` sistêmico da coluna, nunca por
    comparação de título (título de template não-"outro" é derivado,
    inclusive não editável na UI). Tarefas antigas desse tipo permanecem
    intactas para histórico/auditoria; a tela de templates globais
    (`/settings/sprint-task-templates`) não deixa mais criar um NOVO
    template do tipo Otimização (a opção só aparece se um template já
    existente desse tipo estiver sendo editado), fechando o loop de alguém
    recriar o padrão antigo sem querer. O formulário de nova tarefa avulsa
    também parou de sugerir "Otimização" como tipo padrão.

    **`account_reviews`**: uma linha por análise — sem data fixa, `reviewed_at`
    sempre resolvido no servidor (nunca aceito do frontend), vínculo
    automático e obrigatório com a sprint (`start_date <= reviewed_at <=
    end_date` no fuso operacional; zero ou mais de uma sprint correspondente
    vira erro explícito, nunca salva silenciosamente). `previous_review_at`/
    `seconds_since_previous_review` gravados no momento da criação (nunca
    recalculados depois). Motivo (`reason`, 6 opções) e resultado
    (`outcome`: `NO_CHANGE`/`OPTIMIZATION_PERFORMED`/`ISSUE_IDENTIFIED`) como
    taxonomia centralizada (`lib/account-reviews.ts`), com `check` no banco
    garantindo as regras de negócio (NO_CHANGE sem otimizações,
    OPTIMIZATION_PERFORMED com pelo menos uma, ISSUE_IDENTIFIED com
    descrição). Imutável nesta primeira versão — sem policy de update/delete
    pra ninguém.

    **`account_optimizations`**: sempre pertence a uma análise (nunca isolada);
    10 tipos × ações compatíveis por tipo (seções 7/8 do pedido), com `check`
    no banco validando a combinação tipo↔ação (defesa em profundidade — a UI
    já só mostra ações compatíveis com o tipo selecionado).

    **Transação**: `record_account_review` (função de banco) grava a
    análise + as otimizações + a tarefa opcional da pendência + todos os
    `operational_events` correspondentes numa única transação — nunca
    análise salva sem otimização obrigatória, nunca evento sem entidade.
    `account_review_recorded` (sempre) + o evento específico do resultado
    (`account_review_no_change`/`_optimization_performed`/`_issue_identified`)
    + um `account_optimization_recorded` por otimização + `task_created`
    (se a pendência virou tarefa) compartilham o mesmo `correlation_id`.

    **Registro rápido**: drawer com motivo → resultado → seção condicional
    (otimizações realizadas / problema identificado). Primeiro componente
    verdadeiramente client-side do app (decisão deliberada, ver comentário
    no próprio arquivo) — o fluxo tem 3 seções condicionais + um repetidor
    dinâmico de otimizações que o padrão CSS-only (`<details>`/`peer`) já
    usado no projeto não cobre sem gambiarra; ainda assim submete por uma
    única Server Action nativa, sem API própria. Cada otimização é um
    registro independente (permite mais de uma do mesmo tipo, ex.: Criativo
    → Pausou + Criativo → Criou teste).

    **Cadência**: `account_review_cadences` (uma linha por cliente,
    configurável em Editar cliente — `reviews_per_week`,
    `max_business_days_without_review`) — nunca datas fixas, só a meta e o
    intervalo tolerado. Conta no máximo 1 análise por dia civil por cliente
    pra frequência semanal (evita múltiplas análises no mesmo dia inflarem a
    meta, sem nunca descartar os eventos em si — o histórico completo
    continua existindo). `businessDaysSince` (já existente, Etapa 15) é
    reaproveitado pro intervalo atual, nunca duplicado.

    **UI**: seção "Análises da conta" dentro do componente compartilhado de
    Sprint (logo depois de Tarefas — usado nos 4 pontos onde `SprintCard`/
    `SprintCardBody` já é chamado), resumo compacto no card fechado
    ("N análises"), drawer de detalhe (sem JSON bruto, sem IDs técnicos). Na
    página do cliente, o bloco "Acompanhamento operacional" perdeu a coluna
    fixa de Otimização (virou só Reunião/Entrega de criativo,
    `lib/operational-tracking.ts` reduzido de 3 pra 2 tipos rastreados) e
    ganhou um painel irmão "Análises da conta" com os 5 dados pedidos:
    Última análise / Cadência / Intervalo atual / Última otimização /
    Próximo limite.

    **Áreas que dependiam da tarefa Otimização — o que foi ajustado e o que
    ficou como gap explícito**: o sinal "otimização recente" usado em
    `buildAttentionAlerts` (Prioridades da página do cliente) e os textos de
    `lib/client-priority.ts`/`lib/account-priority.ts` ("Otimização vencida"
    → "Análise da conta vencida" etc.) já usam `account_reviews`. **Gap
    conhecido, não corrigido nesta rodada** (disclosure explícito): o mesmo
    sinal em `app/operation/operation-data.ts` (Visão Geral/Sprints) e o
    contador `optimizationsDone` de `lib/monthly-reports.ts`
    (`computeAgencyExecutionSummary`, usado no Relatório Mensal) continuam
    lendo `tasks.type === 'otimizacao'` — funcionam sem quebrar hoje (tarefas
    históricas ainda existem), mas como nenhuma tarefa nova desse tipo será
    gerada, esses dois pontos vão parar de refletir a realidade em poucas
    semanas (o lookback de 14 dias vai esvaziar) se não forem migrados pra
    `account_reviews` numa etapa seguinte — sinalizado aqui de propósito em
    vez de ser descoberto depois.

    **Não implementado nesta etapa** (fora do pedido): dashboard completo de
    Inteligência Operacional (as queries por gestor/cliente/sprint/tipo já
    são possíveis diretamente contra `account_reviews`/`account_optimizations`,
    que carregam todas as chaves necessárias — `team_member_id`, `client_id`,
    `sprint_id`, `optimization_type` — sem precisar de schema novo); jobs de
    monitoramento automático; edição/correção de análise já registrada
    (imutável nesta versão); gamificação, score, ranking, bônus.

    **Testes**: não há suíte automatizada neste projeto. Confirmado por
    leitura/rastreamento manual: `record_account_review` valida motivo/
    resultado antes de gravar (mesmas regras do `check` do banco, mensagem
    mais amigável); `reviewed_at`/`team_member_id`/`organization_id` sempre
    resolvidos no servidor, nunca aceitos do formulário; a RLS de insert
    exige `team_member_id = current_team_member_id()`; zero ou duas sprints
    candidatas vira exceção (nunca salva errado); tarefas históricas de
    Otimização continuam existindo e navegáveis; Reporte/Checar saldo
    continuam sendo gerados normalmente pelos templates ativos. `tsc
    --noEmit`, `npm run lint` e `npm run build` sem erros.

    Arquivos novos: `supabase/account-reviews.sql`, `lib/account-reviews.ts`,
    `lib/account-review-cadence.ts`, `app/clients/account-review-actions.ts`,
    `app/clients/account-reviews-section.tsx`,
    `app/clients/record-account-review-drawer.tsx`,
    `app/clients/account-review-detail-drawer.tsx`,
    `app/clients/account-review-cadence-panel.tsx`. Alterados:
    `lib/supabase/database.types.ts`, `lib/operational-events.ts`,
    `lib/operational-tracking.ts`, `lib/attention-alerts.ts`,
    `lib/client-priority.ts`, `lib/account-priority.ts`,
    `app/clients/[id]/page.tsx`, `app/clients/[id]/edit/page.tsx`,
    `app/clients/[id]/tasks/new/page.tsx`, `app/clients/sprint-card.tsx`,
    `app/clients/operational-tracking-panel.tsx`,
    `app/settings/sprint-task-templates-list.tsx`.

58. ✅ **Reorganização da hierarquia visual e densidade de informação da página do cliente**

    Tarefa só de UX/reorganização — nenhuma regra de negócio, cálculo,
    RLS ou tabela mudou. Nova ordem de blocos: Cabeçalho → Investimento do
    mês → Prioridades (só se houver alerta crítico) → Acompanhamento da
    conta → Rotinas do cliente → Prioridades (posição padrão) → Sprint
    atual → Histórico do mês → demais conteúdos.

    **Investimento do mês**: absorveu o card separado "Orçamento de
    [mês]" (`monthly-budget-panel.tsx`, removido) — o mesmo valor
    planejado não aparece mais duas vezes. `MonthInvestmentSummary` ganhou
    os props de edição/histórico de orçamento; "Editar orçamento"
    (`MonthlyBudgetEditor`) e o indicador discreto "●" com tooltip nativo
    (valor anterior/atual/data, mesmo `title=` de antes) continuam
    idênticos, só reposicionados dentro do mesmo card. "Ver histórico"
    permanece restrito a admin com mais de 1 alteração no mês, abrindo o
    mesmo `MonthlyBudgetHistoryDrawer` de sempre.

    **Acompanhamento da conta** (renomeado só na UI — `account_reviews`/
    `account_optimizations` continuam com o mesmo nome no banco) virou o
    bloco operacional central da página, substituindo
    `account-review-cadence-panel.tsx` por `account-follow-up-panel.tsx`:
    mesmo resumo de cadência (`computeAccountReviewCadenceStatus`, sem
    nenhum cálculo novo — só o rótulo de estado "Em dia"/"Atenção"/"Em
    risco" derivado dos mesmos números) + CTA principal "+ Registrar
    análise" (antes só existia dentro do card da Sprint) + preview das 2
    análises mais recentes com tipo de otimização, reaproveitando a
    mesma janela de 60 dias já buscada na página (`accountReviews.slice(0,
    2)`, nenhuma query nova). "Ver histórico" abre
    `AccountReviewsHistoryDrawer` (novo, mesmo padrão de drawer da página
    inteira), que lista a janela de 60 dias completa — de novo, sem query
    adicional. "Configurar" cadência (quando não configurada, admin) linka
    pro formulário que já existia em `/clients/[id]/edit` desde a Etapa 57
    — nenhuma tela nova.

    **Rotinas do cliente** (renomeado de "Acompanhamento operacional",
    mesmo motivo de nome — ficava parecido demais com "Acompanhamento da
    conta"): removida a linha "Última execução operacional" (ficou
    redundante com os indicadores mais específicos que já existem). O
    dado (`client_last_operational_activity`) continua sendo lido e usado
    normalmente em Prioridades — só a linha de exibição saiu da tela.

    **Prioridades**: `AttentionPanel` agora retorna `null` quando não há
    nenhum alerta (antes mostrava um card "Nenhuma ação urgente"). Quando
    existe alerta crítico, a página renderiza o bloco logo após
    Investimento do mês; caso contrário, ele volta pra posição padrão
    (depois de Rotinas do cliente). Mesma lógica de severidade/agrupamento
    de sempre (`buildAttentionAlerts`, `KIND_PRIORITY`) — só a posição e a
    exibição vazia mudaram.

    **Sprint atual**: `sprint-card.tsx`/`account-reviews-section.tsx` não
    foram tocados (exigência explícita do pedido) — o CTA e o preview de
    análises de nível de página são um componente novo e independente,
    não uma segunda implementação do que já existe dentro do card da
    Sprint (que continua mostrando só as análises daquela sprint
    específica).

    **Testes**: não há suíte automatizada neste projeto. Confirmado por
    leitura/rastreamento manual: nenhuma query nova foi adicionada (grep
    confirma que os 5 componentes reorganizados só eram importados por
    `app/clients/[id]/page.tsx`, seguro reorganizar sem efeito colateral
    em outras telas); `AgencyInvestmentBar`, `SprintFinancialBar`,
    `MonthlyBudgetEditor`, `computeAccountReviewCadenceStatus`,
    `computeOperationalTracking`, `buildAttentionAlerts` não foram
    alterados. `tsc --noEmit`, `npm run lint` e `npm run build` sem erros.
    Sem acesso a credenciais do Supabase neste ambiente — não foi possível
    abrir a página num navegador contra dados reais; verificação feita por
    leitura de código e pelos três comandos acima.

    Arquivos novos: `app/clients/account-follow-up-panel.tsx`,
    `app/clients/account-reviews-history-drawer.tsx`. Removidos:
    `app/clients/monthly-budget-panel.tsx`,
    `app/clients/account-review-cadence-panel.tsx`. Alterados:
    `app/clients/[id]/page.tsx`, `app/clients/month-investment-summary.tsx`,
    `app/clients/operational-tracking-panel.tsx`,
    `app/clients/attention-panel.tsx`,
    `app/clients/monthly-budget-history-drawer.tsx` (comentário).

59. ✅ **Atualização para o Cliente (a partir de uma Análise da Conta)**

    Primeira evolução do sistema de Análises da Conta (Etapa 57): gera, a
    partir de uma análise já registrada, um texto pronto pra colar no
    WhatsApp do cliente — sem nenhuma IA nesta versão (`generation_method`
    já vem preparado pra aceitar `'ai'` no futuro, mas só `'template'` é de
    fato gerado).

    **`client_updates`** (`supabase/client-updates.sql`, roda depois de
    `account-reviews.sql`): `account_review_id` é `unique` — no máximo uma
    atualização por análise; um segundo clique em "Gerar atualização" nunca
    cria duplicata, só reabre a existente (checado na própria action antes
    de inserir). RLS: select/insert seguem exatamente `is_admin() or
    is_client_manager(client_id)` de `account_reviews`, sem matriz nova de
    permissões; diferente de `account_reviews` (imutável), aqui existe
    policy de update — o texto é editável e os campos de cópia/envio mudam
    depois de criada — mas nunca de delete.

    **Geração (`lib/client-updates.ts`, `buildClientUpdateText`)**: função
    pura, só com dados já registrados na análise (motivo do ponto:
    `account_optimizations.reason`; ação: `.description`, com fallback pro
    par tipo/ação quando a descrição está vazia; `issue_description`;
    `notes`) — nunca inventa frase nenhuma. "Próximos passos" nunca aparece
    nesta versão: não existe campo estruturado equivalente no modelo atual
    de análise, e o pedido explicitamente proíbe inventar conteúdo — a
    seção some por completo em vez de aparecer vazia ou genérica (mesma
    regra "se não houver, não mostrar a seção" aplicada às outras duas
    seções). Verificado manualmente com 6 cenários (otimização com 3 ações,
    sem otimização com/sem observação, problema identificado, uma única
    ação sem motivo preenchido, caracteres especiais/emoji/texto longo) —
    todos batem com os exemplos do pedido.

    **Onde vive**: dentro do `AccountReviewDetailDrawer` já existente (Etapa
    57) — nenhum drawer novo. Seção "Atualização para o cliente" logo depois
    de Observações: sem atualização, um CTA compacto de uma linha; com
    atualização, `ClientUpdateEditor` (segundo componente client-side do
    app, mesma justificativa de `RecordAccountReviewDrawer`: textarea com
    autosave debounced 700ms e clipboard não têm como ser `<form>` +
    Server Action + redirect). Ação rápida "Gerar atualização" também
    aparece no banner de sucesso logo depois de registrar uma análise
    (`?reviewSaved=<id>`), sempre opcional, nunca automática.

    **Autosave/cópia/envio**: as 4 Server Actions de mutação
    (`client-update-actions.ts`) são chamadas diretamente do componente
    cliente (sem `<form>`, sem redirect) — `updateClientUpdateContentAction`
    sempre salva o conteúdo, mas só grava `CLIENT_UPDATE_EDITED` se o último
    evento gerado/editado desta atualização tiver mais de 2 minutos
    (deduplicação simples, não um sistema de versionamento); "Copiar texto"
    faz o clipboard no navegador e só então chama a action (registra
    `copied_at`/`copied_by`/evento, nunca abre WhatsApp); "Marcar como
    enviada" tem confirmação compacta inline antes de gravar `sent_at`/
    `sent_by`; "Marcar como não enviada" só aparece no menu "⋯" depois de já
    enviada.

    **Eventos operacionais** (estende a taxonomia existente, mesma tabela
    `operational_events` — nenhuma tabela paralela): `client_update_generated`,
    `client_update_edited`, `client_update_copied`, `client_update_marked_sent`,
    `client_update_marked_unsent`, entidade nova `client_update`. Payload
    inclui `client_id`/`account_review_id` (em `metadata` no evento de
    geração) — nunca duplica o conteúdo da mensagem no evento, que já está
    em `client_updates.content`. Com isso dá pra medir no futuro: % de
    análises que geram atualização, tempo análise→geração→cópia→envio,
    gestores que mais comunicam, clientes que recebem atualização com mais
    frequência, análises sem comunicação posterior — nenhuma dessas métricas
    foi implementada agora, só os eventos que as tornam possíveis depois.

    **Indicadores discretos** (seções 14/15): mesmo componente `ReviewPreviewRow`
    (reaproveitado do Acompanhamento da Conta e do "Ver histórico") e a lista
    de análises dentro da Sprint (`AccountReviewsSection`) ganharam um texto
    secundário — "Atualização gerada"/"Atualização copiada"/"Atualização
    enviada" — que só aparece quando existe uma atualização; sem atualização
    gerada, nada é mostrado (nenhum "Sem atualização" repetido em toda
    linha). Sem badge grande, sem coluna nova.

    **Não implementado nesta etapa** (fora do pedido, seção 19): integração
    com WhatsApp (nem oficial nem por link `wa.me`); envio automático; IA/LLM;
    áudio; PDF; relatório completo; templates customizáveis por agência;
    aprovação do admin; notificações; dashboard de comunicação; qualquer
    métrica visual nova na Inteligência Operacional — só os eventos que as
    viabilizarão depois.

    **Testes**: não há suíte automatizada neste projeto. `buildClientUpdateText`
    verificado manualmente com os 6 cenários acima (script ad-hoc, descartado
    depois). Confirmado por leitura/rastreamento manual: `account_review_id`
    unique impede duplicata mesmo em duplo clique; RLS de update permite só
    quem já podia ver/editar a análise (`is_admin()`/`is_client_manager`);
    `updateClientUpdateContentAction` sempre persiste o conteúdo mesmo
    quando o evento é deduplicado; nenhuma regra de orçamento/investimento/
    sprint/tarefa/otimização/relatório/equipe foi tocada — só a tabela nova
    e a taxonomia estendida de eventos. `tsc --noEmit`, `npm run lint` e
    `npm run build` sem erros. Sem acesso a credenciais do Supabase neste
    ambiente — não foi possível abrir a página num navegador contra dados
    reais.

    Arquivos novos: `supabase/client-updates.sql`, `lib/client-updates.ts`,
    `app/clients/client-update-actions.ts`, `app/clients/client-update-editor.tsx`.
    Alterados: `lib/supabase/database.types.ts`, `lib/operational-events.ts`,
    `lib/format.ts` (`formatDateTimeWithYear`),
    `app/clients/account-review-detail-drawer.tsx`,
    `app/clients/account-reviews-section.tsx`,
    `app/clients/account-follow-up-panel.tsx`, `app/clients/[id]/page.tsx`,
    `app/clients/account-review-actions.ts` (redirect com `reviewSaved`).

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
