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

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
