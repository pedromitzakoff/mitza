# Mitza

Sistema web da agência para substituir o ClickUp: gestão de clientes,
acompanhamento financeiro por sprint semanal (planejado vs. gasto, puxado do
Meta), tarefas recorrentes e painel geral de metas do mês.

Construído em etapas — veja o estado de cada uma nas tasks do repositório.

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
7. Comentários genéricos (sprint e tarefa)
8. Painel geral do mês com cálculo de meta batida
9. Polimento visual da página do cliente

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
