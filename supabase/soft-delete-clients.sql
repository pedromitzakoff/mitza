-- Etapa 13: exclusão de cliente é soft delete (deleted_at), pra manter
-- sprints, tarefas, comentários e daily_spend intactos como histórico.
-- Rode depois de supabase/global-sprint-task-templates.sql.

alter table clients add column if not exists deleted_at timestamptz;

create index if not exists clients_deleted_at_idx on clients (deleted_at);

-- ---------------------------------------------------------------------------
-- generate_next_month_sprints (redefinida): cliente excluído não ganha
-- sprints do mês seguinte.
-- ---------------------------------------------------------------------------
create or replace function generate_next_month_sprints() returns void as $$
declare
  next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  c record;
begin
  for c in select id from clients where deleted_at is null loop
    perform generate_sprints_for_month(c.id, extract(year from next_month)::int, extract(month from next_month)::int);
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- backfill_sprint_tasks_from_templates (redefinida): pula sprints de
-- clientes excluídos.
-- ---------------------------------------------------------------------------
create or replace function backfill_sprint_tasks_from_templates() returns void as $$
declare
  spr record;
begin
  for spr in
    select s.id, s.client_id, s.start_date, s.end_date
    from sprints s
    join clients c on c.id = s.client_id
    where c.deleted_at is null
  loop
    perform generate_sprint_tasks_from_templates(spr.client_id, spr.id, spr.start_date, spr.end_date);
  end loop;
end;
$$ language plpgsql;
