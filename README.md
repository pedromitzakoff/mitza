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
  selo vermelho de sempre
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

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
