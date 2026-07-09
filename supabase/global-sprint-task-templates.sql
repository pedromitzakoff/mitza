-- Etapa 12: tarefas padrão de sprint deixam de ser configuradas por cliente
-- e passam a ser uma configuração global (admin, em /settings), aplicada a
-- "todos os clientes" ou a uma lista de clientes selecionados.
-- Rode depois de supabase/task-templates.sql.

-- ---------------------------------------------------------------------------
-- sprint_task_templates: configuração global. weekday segue ISO (1=seg..7=dom).
-- applies_to_all = true vale para todo cliente (atual e futuro); quando
-- false, os clientes valem estão em sprint_task_template_clients.
-- ---------------------------------------------------------------------------
create table if not exists sprint_task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('otimizacao', 'verificacao_saldo', 'report', 'outro')),
  default_assignee_id uuid references profiles (id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7),
  applies_to_all boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sprint_task_template_clients (
  template_id uuid not null references sprint_task_templates (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  primary key (template_id, client_id)
);

create index if not exists sprint_task_template_clients_client_id_idx
  on sprint_task_template_clients (client_id);

alter table sprint_task_templates enable row level security;

create policy sprint_task_templates_all on sprint_task_templates
  for all using (is_admin()) with check (is_admin());

alter table sprint_task_template_clients enable row level security;

create policy sprint_task_template_clients_all on sprint_task_template_clients
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- generate_sprint_tasks_from_templates (redefinida): agora lê a configuração
-- global em vez de client_task_templates. Mesma garantia de idempotência
-- (tasks_template_sprint_unique, criada em task-templates.sql).
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
    select t.id, t.title, t.type, t.default_assignee_id, t.weekday
    from sprint_task_templates t
    where t.is_active = true
      and (
        t.applies_to_all
        or exists (
          select 1 from sprint_task_template_clients stc
          where stc.template_id = t.id and stc.client_id = p_client_id
        )
      )
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
-- trg_create_initial_sprints (redefinida): não semeia mais nada por cliente
-- ao criar. Um cliente novo só ganha as tarefas dos templates globais
-- marcados como "todos os clientes" (a própria geração da sprint já cobre
-- isso, via generate_sprint_tasks_from_templates acima).
-- ---------------------------------------------------------------------------
create or replace function trg_create_initial_sprints() returns trigger as $$
begin
  perform generate_sprints_for_month(new.id, extract(year from current_date)::int, extract(month from current_date)::int);
  return new;
end;
$$ language plpgsql;

drop function if exists seed_default_client_task_templates(uuid);

-- ---------------------------------------------------------------------------
-- backfill_sprint_tasks_from_templates: substitui
-- backfill_client_task_templates_and_tasks. Roda a geração (idempotente)
-- pra todas as sprints já existentes, a partir dos templates globais
-- ativos no momento — usado depois de criar/editar um template global, se
-- você quiser aplicá-lo a sprints que já existem. Rode:
--   select backfill_sprint_tasks_from_templates();
-- ---------------------------------------------------------------------------
create or replace function backfill_sprint_tasks_from_templates() returns void as $$
declare
  s record;
begin
  for s in select id, client_id, start_date, end_date from sprints loop
    perform generate_sprint_tasks_from_templates(s.client_id, s.id, s.start_date, s.end_date);
  end loop;
end;
$$ language plpgsql;

drop function if exists backfill_client_task_templates_and_tasks();

-- ---------------------------------------------------------------------------
-- Migração de tasks.template_id: tarefas já geradas por client_task_templates
-- perdem o vínculo com o template que as originou (a tarefa em si não é
-- apagada, nem seu status/comentários). template_id passa a apontar para
-- sprint_task_templates.
-- ---------------------------------------------------------------------------
alter table tasks drop constraint if exists tasks_template_id_fkey;

update tasks set template_id = null where template_id is not null;

alter table tasks
  add constraint tasks_template_id_fkey
  foreign key (template_id) references sprint_task_templates (id) on delete set null;

-- ---------------------------------------------------------------------------
-- client_task_templates fica desativada (histórico preservado, mas nada mais
-- lê essa tabela). Pode ser removida de vez numa limpeza futura, se quiser.
-- ---------------------------------------------------------------------------
update client_task_templates set is_active = false;
