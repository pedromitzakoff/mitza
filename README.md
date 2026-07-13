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

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
