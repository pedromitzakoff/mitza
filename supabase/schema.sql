-- Etapa 1: schema inicial do banco.
-- Rode este arquivo inteiro no SQL Editor do Supabase (ou via `supabase db push`
-- apontando para esta pasta como migration).
--
-- RLS (row level security) e as policies de admin/gestor entram na Etapa 2,
-- junto com a autenticação. Por enquanto as tabelas ficam sem RLS para
-- facilitar o desenvolvimento local.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: espelha auth.users, guarda nome e papel (admin | gestor)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null default 'gestor' check (role in ('admin', 'gestor')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meta_ad_account_id text not null check (meta_ad_account_id ~ '^act_[0-9]+$'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- client_managers: relação N:N entre gestores (profiles) e clientes
-- ---------------------------------------------------------------------------
create table if not exists client_managers (
  client_id uuid not null references clients (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (client_id, user_id)
);

create index if not exists client_managers_user_id_idx on client_managers (user_id);

-- ---------------------------------------------------------------------------
-- sprints: blocos fixos de 7 dias por mês (1-7, 8-14, 15-21, 22-28, resto)
-- ---------------------------------------------------------------------------
create table if not exists sprints (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  planned_spend numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, start_date),
  check (end_date >= start_date)
);

create index if not exists sprints_client_id_idx on sprints (client_id);

-- ---------------------------------------------------------------------------
-- daily_spend: populado pela sync com a Meta Insights API
-- ---------------------------------------------------------------------------
create table if not exists daily_spend (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  date date not null,
  spend numeric(12, 2) not null default 0,
  synced_at timestamptz not null default now(),
  unique (client_id, date)
);

create index if not exists daily_spend_client_date_idx on daily_spend (client_id, date);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  title text not null,
  type text not null check (type in ('otimizacao', 'verificacao_saldo', 'report', 'outro')),
  assignee_id uuid references profiles (id) on delete set null,
  due_date date not null,
  status text not null default 'pendente' check (status in ('pendente', 'feito', 'atrasado')),
  recurrence text not null default 'nenhuma' check (recurrence in ('nenhuma', 'diaria', 'semanal', 'mensal')),
  sprint_id uuid references sprints (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_client_id_idx on tasks (client_id);
create index if not exists tasks_assignee_id_idx on tasks (assignee_id);
create index if not exists tasks_sprint_id_idx on tasks (sprint_id);

-- ---------------------------------------------------------------------------
-- comments: genérico, serve tanto para sprints quanto para tasks
-- ---------------------------------------------------------------------------
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  commentable_type text not null check (commentable_type in ('sprint', 'task')),
  commentable_id uuid not null,
  author_id uuid references profiles (id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_commentable_idx on comments (commentable_type, commentable_id);

-- ---------------------------------------------------------------------------
-- Geração automática das sprints (blocos fixos de 7 dias + resto do mês)
-- ---------------------------------------------------------------------------

-- Cria as sprints do mês informado para um cliente, se ainda não existirem.
create or replace function generate_sprints_for_month(
  p_client_id uuid,
  p_year int,
  p_month int
) returns void as $$
declare
  month_start date := make_date(p_year, p_month, 1);
  month_end date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  block_start_day int;
  b_start date;
  b_end date;
begin
  foreach block_start_day in array array[1, 8, 15, 22, 29] loop
    b_start := month_start + (block_start_day - 1);

    if b_start > month_end then
      continue; -- mês não tem esse bloco (ex.: fevereiro sem dia 29)
    end if;

    if block_start_day = 29 then
      b_end := month_end; -- último bloco = resto do mês
    else
      b_end := least(b_start + 6, month_end);
    end if;

    insert into sprints (client_id, start_date, end_date, planned_spend)
    values (p_client_id, b_start, b_end, 0)
    on conflict (client_id, start_date) do nothing;
  end loop;
end;
$$ language plpgsql;

-- Gera as sprints do mês seguinte para todos os clientes.
-- Pensada para ser chamada por uma rotina agendada (pg_cron, Edge Function
-- com cron, ou rota do Next.js com cron do Vercel) — a própria agenda fica
-- para uma etapa futura, aqui só a lógica de geração.
create or replace function generate_next_month_sprints() returns void as $$
declare
  next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  c record;
begin
  for c in select id from clients loop
    perform generate_sprints_for_month(c.id, extract(year from next_month)::int, extract(month from next_month)::int);
  end loop;
end;
$$ language plpgsql;

-- Ao cadastrar um cliente, gera automaticamente as sprints do mês atual.
create or replace function trg_create_initial_sprints() returns trigger as $$
begin
  perform generate_sprints_for_month(new.id, extract(year from current_date)::int, extract(month from current_date)::int);
  return new;
end;
$$ language plpgsql;

drop trigger if exists clients_create_initial_sprints on clients;
create trigger clients_create_initial_sprints
  after insert on clients
  for each row execute function trg_create_initial_sprints();
