-- Etapa 15: log de atividade operacional relevante (tarefa criada/editada/
-- concluída, comentário em tarefa ou sprint) — usado pra detectar
-- automaticamente quando um cliente ou uma sprint estão sem acompanhamento.
-- Sync do Meta, daily_spend, login e geração automática de tarefas por
-- template NUNCA geram evento aqui (essas rotinas nunca chamam o insert).
-- Rode depois de supabase/operation-collaboration-rls.sql.

create table if not exists operational_activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid references sprints (id) on delete set null,
  task_id uuid references tasks (id) on delete set null,
  user_id uuid references profiles (id) on delete set null,
  activity_type text not null check (
    activity_type in ('task_created', 'task_completed', 'task_updated', 'task_commented', 'sprint_commented')
  ),
  source_type text,
  source_id uuid,
  metadata jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists operational_activities_client_idx
  on operational_activities (client_id, occurred_at desc);

create index if not exists operational_activities_sprint_idx
  on operational_activities (sprint_id, occurred_at desc)
  where sprint_id is not null;

alter table operational_activities enable row level security;

-- Select segue a mesma abertura de colaboração das outras tabelas.
create policy operational_activities_select on operational_activities
  for select using (auth.uid() is not null);

-- Insert só pode gravar em nome de quem está logado — nunca em nome de
-- outro usuário, e nunca sem usuário (evento sempre tem autor humano).
create policy operational_activities_insert on operational_activities
  for insert with check (auth.uid() is not null and user_id = auth.uid());

-- Log imutável: sem policy de update/delete, então ninguém (além do
-- service role, que ignora RLS) consegue alterar ou apagar um evento.

-- ---------------------------------------------------------------------------
-- Views agregadas: "última atividade" por cliente e por sprint, num único
-- select em vez de uma query por cliente. security_invoker garante que a
-- view respeita a RLS de quem está consultando, não de quem criou a view.
-- ---------------------------------------------------------------------------
create or replace view client_last_operational_activity
  with (security_invoker = true) as
  select client_id, max(occurred_at) as last_activity_at
  from operational_activities
  group by client_id;

create or replace view sprint_last_operational_activity
  with (security_invoker = true) as
  select sprint_id, max(occurred_at) as last_activity_at
  from operational_activities
  where sprint_id is not null
  group by sprint_id;

-- ---------------------------------------------------------------------------
-- Backfill: só o que dá pra inferir com segurança dos dados existentes.
--
-- task_created: só para tarefas com template_id nulo (as geradas por
-- template não são execução humana), usando tasks.created_at.
--
-- task_commented / sprint_commented: todo comentário sempre foi criado por
-- uma ação humana (createCommentAction), então todo comments existente vira
-- evento, usando comments.created_at e comments.author_id.
--
-- NÃO backfilla task_completed: não existe coluna de "quando foi concluída"
-- em tasks, só o status atual — inventar uma data de conclusão seria dado
-- fabricado, não inferido. A partir desta migration, toda conclusão nova
-- passa a gerar o evento certinho (via completeTaskAction); o histórico de
-- conclusões anteriores a esta etapa simplesmente não existe, o que é mais
-- correto do que chutar uma data.
--
-- Idempotente: cada bloco só insere o que ainda não existe (checagem por
-- task_id+activity_type ou por source_id+activity_type).
-- ---------------------------------------------------------------------------
create or replace function backfill_operational_activities() returns void as $$
begin
  insert into operational_activities (client_id, task_id, activity_type, occurred_at, created_at)
  select t.client_id, t.id, 'task_created', t.created_at, t.created_at
  from tasks t
  where t.template_id is null
    and not exists (
      select 1 from operational_activities oa
      where oa.task_id = t.id and oa.activity_type = 'task_created'
    );

  insert into operational_activities (
    client_id, task_id, sprint_id, user_id, activity_type, source_type, source_id, occurred_at, created_at
  )
  select
    t.client_id,
    t.id,
    t.sprint_id,
    c.author_id,
    'task_commented',
    'comment',
    c.id,
    c.created_at,
    c.created_at
  from comments c
  join tasks t on t.id = c.commentable_id
  where c.commentable_type = 'task'
    and not exists (
      select 1 from operational_activities oa
      where oa.source_id = c.id and oa.activity_type = 'task_commented'
    );

  insert into operational_activities (
    client_id, sprint_id, user_id, activity_type, source_type, source_id, occurred_at, created_at
  )
  select
    s.client_id,
    s.id,
    c.author_id,
    'sprint_commented',
    'comment',
    c.id,
    c.created_at,
    c.created_at
  from comments c
  join sprints s on s.id = c.commentable_id
  where c.commentable_type = 'sprint'
    and not exists (
      select 1 from operational_activities oa
      where oa.source_id = c.id and oa.activity_type = 'sprint_commented'
    );
end;
$$ language plpgsql;
