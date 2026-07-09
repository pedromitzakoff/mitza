-- Etapa 11: plano operacional padrão por cliente (templates de tarefa) e
-- geração idempotente das tarefas de cada sprint a partir desses templates.
-- Rode depois de supabase/schema.sql e supabase/policies.sql.

-- ---------------------------------------------------------------------------
-- client_task_templates: plano operacional semanal configurável por cliente.
-- weekday segue ISO: 1 = segunda ... 7 = domingo.
-- ---------------------------------------------------------------------------
create table if not exists client_task_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  title text not null,
  type text not null check (type in ('otimizacao', 'verificacao_saldo', 'report', 'outro')),
  default_assignee_id uuid references profiles (id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists client_task_templates_client_id_idx on client_task_templates (client_id);

alter table client_task_templates enable row level security;

create policy client_task_templates_select on client_task_templates
  for select using (is_admin() or is_client_manager(client_id));

create policy client_task_templates_write on client_task_templates
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- tasks.template_id: liga uma tarefa gerada ao template que a originou.
-- O índice único parcial (só quando não nulo) é o que garante a idempotência
-- da geração: rodar a rotina duas vezes não duplica a tarefa da mesma
-- sprint+template, o insert usa "on conflict ... do nothing".
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists template_id uuid
  references client_task_templates (id) on delete set null;

create unique index if not exists tasks_template_sprint_unique
  on tasks (template_id, sprint_id)
  where template_id is not null;

-- ---------------------------------------------------------------------------
-- Defaults do plano operacional (etapa 10): Otimização seg/qua/sex,
-- Report terça, Checar saldo de segunda a sexta. Centralizado aqui — só
-- roda uma vez por cliente (se ele já tem qualquer template, não mexe,
-- pra não sobrescrever uma configuração customizada).
-- ---------------------------------------------------------------------------
create or replace function seed_default_client_task_templates(p_client_id uuid) returns void as $$
begin
  if exists (select 1 from client_task_templates where client_id = p_client_id) then
    return;
  end if;

  insert into client_task_templates (client_id, title, type, weekday) values
    (p_client_id, 'Otimização', 'otimizacao', 1),
    (p_client_id, 'Otimização', 'otimizacao', 3),
    (p_client_id, 'Otimização', 'otimizacao', 5),
    (p_client_id, 'Report', 'report', 2),
    (p_client_id, 'Checar saldo', 'verificacao_saldo', 1),
    (p_client_id, 'Checar saldo', 'verificacao_saldo', 2),
    (p_client_id, 'Checar saldo', 'verificacao_saldo', 3),
    (p_client_id, 'Checar saldo', 'verificacao_saldo', 4),
    (p_client_id, 'Checar saldo', 'verificacao_saldo', 5);
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Gera as tarefas de uma sprint a partir dos templates ativos do cliente.
-- Cada bloco de sprint tem no máximo 7 dias, então cada weekday aparece no
-- máximo uma vez no período — não precisa de loop de múltiplas ocorrências.
-- Idempotente: o "on conflict" da tasks_template_sprint_unique garante que
-- rodar isso de novo pra mesma sprint não duplica nada.
-- ---------------------------------------------------------------------------
create or replace function generate_sprint_tasks_from_templates(
  p_client_id uuid,
  p_sprint_id uuid,
  p_start_date date,
  p_end_date date
) returns void as $$
declare
  tpl record;
  match_date date;
begin
  for tpl in
    select id, title, type, default_assignee_id, weekday
    from client_task_templates
    where client_id = p_client_id and is_active = true
  loop
    select gs.d into match_date
    from generate_series(p_start_date, p_end_date, interval '1 day') as gs(d)
    where extract(isodow from gs.d) = tpl.weekday
    limit 1;

    if match_date is not null then
      insert into tasks (client_id, title, type, assignee_id, due_date, sprint_id, template_id, status, recurrence)
      values (p_client_id, tpl.title, tpl.type, tpl.default_assignee_id, match_date, p_sprint_id, tpl.id, 'pendente', 'nenhuma')
      on conflict (template_id, sprint_id) where template_id is not null do nothing;
    end if;
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- generate_sprints_for_month (redefinida): além de criar os blocos da
-- sprint, agora também gera as tarefas de cada bloco novo a partir dos
-- templates ativos do cliente. Sprints que já existiam (conflito no
-- "on conflict") não passam por aqui de novo — ver backfill abaixo para
-- preencher tarefas de sprints já existentes.
-- ---------------------------------------------------------------------------
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
  v_sprint_id uuid;
begin
  foreach block_start_day in array array[1, 8, 15, 22, 29] loop
    b_start := month_start + (block_start_day - 1);

    if b_start > month_end then
      continue;
    end if;

    if block_start_day = 29 then
      b_end := month_end;
    else
      b_end := least(b_start + 6, month_end);
    end if;

    v_sprint_id := null;

    insert into sprints (client_id, start_date, end_date, planned_spend)
    values (p_client_id, b_start, b_end, 0)
    on conflict (client_id, start_date) do nothing
    returning id into v_sprint_id;

    if v_sprint_id is not null then
      perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, b_start, b_end);
    end if;
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- trg_create_initial_sprints (redefinida): agora semeia os templates
-- padrão do cliente antes de gerar as sprints do mês atual, pra que a
-- própria criação do cliente já venha com o plano operacional completo.
-- ---------------------------------------------------------------------------
create or replace function trg_create_initial_sprints() returns trigger as $$
begin
  perform seed_default_client_task_templates(new.id);
  perform generate_sprints_for_month(new.id, extract(year from current_date)::int, extract(month from current_date)::int);
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Backfill: para clientes/sprints que já existiam antes desta etapa.
-- Idempotente (mesmas garantias acima) e não apaga nada. Rode uma vez:
--   select backfill_client_task_templates_and_tasks();
-- ---------------------------------------------------------------------------
create or replace function backfill_client_task_templates_and_tasks() returns void as $$
declare
  c record;
  s record;
begin
  for c in select id from clients loop
    perform seed_default_client_task_templates(c.id);
  end loop;

  for s in select id, client_id, start_date, end_date from sprints loop
    perform generate_sprint_tasks_from_templates(s.client_id, s.id, s.start_date, s.end_date);
  end loop;
end;
$$ language plpgsql;
