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
- `src/lib/auth.ts` — helper para ler o profile (id/nome/papel) do usuário logado
- `src/middleware.ts` — protege todas as rotas exceto `/login`
- `supabase/schema.sql` — schema SQL das tabelas e funções auxiliares
- `supabase/policies.sql` — trigger de criação de profile + RLS por papel

## Ordem de construção

1. ✅ Setup do projeto e schema SQL
2. ✅ Autenticação com papéis (admin/gestor) e proteção de rotas
3. CRUD de clientes e atribuição de gestores
4. Sync com a Meta Insights API
5. Dashboard financeiro por sprint com selos de status
6. CRUD de tarefas + recorrência e "atrasado"
7. Comentários genéricos (sprint e tarefa)
8. Painel geral do mês com cálculo de meta batida
9. Polimento visual da página do cliente

## Deploy

Deploy final na [Vercel](https://vercel.com). Configure as mesmas variáveis
de ambiente do `.env.local` no projeto da Vercel.
