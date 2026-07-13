-- Etapa 55: área "Equipe" — membros da equipe da agência como entidade
-- operacional própria, desacoplada de auth.users. Rode por último, depois de
-- TODAS as migrations existentes (repoint de FKs que hoje apontam pra
-- `profiles`, criadas em arquivos anteriores).
--
-- Problema que esta migration resolve: até aqui, toda referência de
-- "responsável" (tasks.assignee_id, clients.primary_manager_id,
-- comments.author_id, etc.) apontava direto pra `profiles`, e `profiles.id`
-- é OBRIGATORIAMENTE igual a um `auth.users.id` (fk on delete cascade). Isso
-- significa que a agência só consegue registrar alguém como responsável se
-- essa pessoa já tiver login no sistema — não dá pra cadastrar um membro da
-- equipe (pra fins de atribuição/histórico/relatório) sem também criar
-- acesso. `team_members` separa as duas coisas: todo FK operacional passa a
-- apontar pra `team_members(id)`; o vínculo com login (`auth_user_id`) é
-- OPCIONAL e só existe quando o membro é convidado e aceita o convite.
--
-- `profiles` NÃO é apagada nesta migration (dado histórico preservado, sem
-- estrutura paralela ativa: a partir daqui nada no app volta a ler
-- `profiles`, só `team_members` — mesmo espírito de
-- supabase/global-sprint-task-templates.sql, que desativou
-- `client_task_templates` em vez de derrubá-la). O trigger
-- `handle_new_user` (policies.sql) também fica como está — inofensivo, só
-- passa a criar uma linha em `profiles` que nada mais lê.

-- ---------------------------------------------------------------------------
-- organizations: preparação pra multi-agência (seção 4 do pedido), sem
-- implementar multi-tenant completo agora. Uma única linha é semeada abaixo
-- e todo membro/organização existente aponta pra ela — nenhum nome de
-- agência fica hardcoded no código, só este dado semeado uma vez.
-- ---------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

insert into organizations (name)
select 'Organização principal'
where not exists (select 1 from organizations);

-- ---------------------------------------------------------------------------
-- team_members: identidade operacional canônica. `auth_user_id` opcional —
-- um membro pode existir, ser atribuído a clientes/tarefas e aparecer no
-- histórico sem nunca ter tido acesso ao sistema.
-- ---------------------------------------------------------------------------
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  email text not null,
  job_title text,
  system_role text not null default 'gestor' check (system_role in ('admin', 'gestor')),
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  avatar_url text,
  auth_user_id uuid references auth.users (id) on delete set null,
  invitation_status text not null default 'sem_acesso'
    check (invitation_status in ('sem_acesso', 'convite_pendente', 'acesso_ativo')),
  invited_at timestamptz,
  invited_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references team_members (id) on delete set null
);

-- Dedup: mesmo e-mail não pode existir duas vezes na mesma organização
-- (normalizado em minúsculas — a aplicação já faz trim()+lowercase() antes
-- de gravar, isto aqui é a segunda camada de defesa).
create unique index if not exists team_members_org_email_unique
  on team_members (organization_id, lower(email));

-- Um auth.users só pode estar linkado a UM team_member por vez.
create unique index if not exists team_members_auth_user_unique
  on team_members (auth_user_id) where auth_user_id is not null;

create index if not exists team_members_org_idx on team_members (organization_id);
create index if not exists team_members_status_idx on team_members (organization_id, status);

create or replace function set_team_members_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists team_members_set_updated_at on team_members;
create trigger team_members_set_updated_at
  before update on team_members
  for each row execute function set_team_members_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: um team_member por profile existente. Reaproveita o MESMO id
-- (profiles.id == auth.users.id, por construção) como id do team_member —
-- assim nenhum dos ~12 FKs que hoje apontam pra profiles(id) precisa de
-- UPDATE de dados: eles já guardam o valor certo, só a CONSTRAINT muda de
-- tabela-alvo (ver bloco de repoint abaixo). Idempotente via
-- "on conflict (id) do nothing".
-- ---------------------------------------------------------------------------
insert into team_members (
  id, organization_id, name, email, system_role, status, auth_user_id, invitation_status, created_at
)
select
  p.id,
  (select id from organizations order by created_at limit 1),
  p.name,
  lower(u.email),
  p.role,
  'ativo',
  p.id,
  'acesso_ativo',
  p.created_at
from profiles p
join auth.users u on u.id = p.id
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Repoint de FKs: profiles(id) -> team_members(id). Nenhuma linha muda de
-- valor (mesmo id preservado no backfill acima) — só a constraint passa a
-- apontar pra outra tabela. `client_task_templates.default_assignee_id` fica
-- de fora de propósito: a tabela já está desativada desde
-- global-sprint-task-templates.sql (is_active = false em todas as linhas) e
-- nenhum código do app lê mais dela.
-- ---------------------------------------------------------------------------
alter table client_managers drop constraint if exists client_managers_user_id_fkey;
alter table client_managers add constraint client_managers_user_id_fkey
  foreign key (user_id) references team_members (id) on delete cascade;

alter table tasks drop constraint if exists tasks_assignee_id_fkey;
alter table tasks add constraint tasks_assignee_id_fkey
  foreign key (assignee_id) references team_members (id) on delete set null;

alter table comments drop constraint if exists comments_author_id_fkey;
alter table comments add constraint comments_author_id_fkey
  foreign key (author_id) references team_members (id) on delete set null;

alter table clients drop constraint if exists clients_primary_manager_id_fkey;
alter table clients add constraint clients_primary_manager_id_fkey
  foreign key (primary_manager_id) references team_members (id) on delete set null;

alter table sprint_task_templates drop constraint if exists sprint_task_templates_default_assignee_id_fkey;
alter table sprint_task_templates add constraint sprint_task_templates_default_assignee_id_fkey
  foreign key (default_assignee_id) references team_members (id) on delete set null;

alter table monthly_budget_changes drop constraint if exists monthly_budget_changes_changed_by_fkey;
alter table monthly_budget_changes add constraint monthly_budget_changes_changed_by_fkey
  foreign key (changed_by) references team_members (id) on delete set null;

alter table monthly_reports drop constraint if exists monthly_reports_finalized_by_fkey;
alter table monthly_reports add constraint monthly_reports_finalized_by_fkey
  foreign key (finalized_by) references team_members (id) on delete set null;

alter table report_timeline_events drop constraint if exists report_timeline_events_responsible_id_fkey;
alter table report_timeline_events add constraint report_timeline_events_responsible_id_fkey
  foreign key (responsible_id) references team_members (id) on delete set null;

alter table report_timeline_events drop constraint if exists report_timeline_events_created_by_fkey;
alter table report_timeline_events add constraint report_timeline_events_created_by_fkey
  foreign key (created_by) references team_members (id) on delete set null;

alter table report_comment_selections drop constraint if exists report_comment_selections_created_by_fkey;
alter table report_comment_selections add constraint report_comment_selections_created_by_fkey
  foreign key (created_by) references team_members (id) on delete set null;

alter table report_action_items drop constraint if exists report_action_items_responsible_id_fkey;
alter table report_action_items add constraint report_action_items_responsible_id_fkey
  foreign key (responsible_id) references team_members (id) on delete set null;

alter table operational_activities drop constraint if exists operational_activities_user_id_fkey;
alter table operational_activities add constraint operational_activities_user_id_fkey
  foreign key (user_id) references team_members (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Helpers de identidade — nomes de função PRESERVADOS (is_admin,
-- is_client_manager) pra toda policy já escrita em outras migrations
-- continuar funcionando sem alteração; só o corpo muda, de `profiles` pra
-- `team_members`.
-- ---------------------------------------------------------------------------
create or replace function current_team_member_id() returns uuid as $$
  select id from team_members where auth_user_id = auth.uid() and status = 'ativo' limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function current_organization_id() returns uuid as $$
  select organization_id from team_members where auth_user_id = auth.uid() and status = 'ativo' limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from team_members
    where auth_user_id = auth.uid() and system_role = 'admin' and status = 'ativo'
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_client_manager(p_client_id uuid) returns boolean as $$
  select exists (
    select 1 from client_managers cm
    join team_members tm on tm.id = cm.user_id
    where cm.client_id = p_client_id and tm.auth_user_id = auth.uid() and tm.status = 'ativo'
  );
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Policies que comparavam author_id/user_id diretamente com auth.uid()
-- precisam trocar pra current_team_member_id(): essas colunas agora guardam
-- team_members.id, que só POR COINCIDÊNCIA é igual a auth.uid() pros membros
-- migrados acima (mesmo id reaproveitado) — pra um membro novo, criado com
-- gen_random_uuid() e só depois linkado a um auth_user_id diferente, a
-- comparação direta com auth.uid() estaria errada.
-- ---------------------------------------------------------------------------
drop policy if exists comments_insert on comments;
create policy comments_insert on comments
  for insert with check (author_id = current_team_member_id());

drop policy if exists comments_update on comments;
create policy comments_update on comments
  for update using (is_admin() or author_id = current_team_member_id())
  with check (is_admin() or author_id = current_team_member_id());

drop policy if exists comments_delete on comments;
create policy comments_delete on comments
  for delete using (is_admin() or author_id = current_team_member_id());

drop policy if exists operational_activities_insert on operational_activities;
create policy operational_activities_insert on operational_activities
  for insert with check (auth.uid() is not null and user_id = current_team_member_id());

-- ---------------------------------------------------------------------------
-- RLS de organizations/team_members.
--
-- organizations: só leitura (nenhuma tela edita organização nesta etapa).
--
-- team_members: select aberto a qualquer membro ativo da MESMA organização
-- (mesmo padrão de colaboração já usado em clients/sprints/tasks desde a
-- Etapa 15 — gestor precisa ver a equipe toda pra atribuir responsáveis e
-- colaborar, só não pode ADMINISTRAR). Write (insert/update) restrito a
-- admin da mesma organização; não há policy de delete (exclusão
-- permanente não é oferecida pela interface principal nesta etapa, seção 19
-- do pedido).
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;

create policy organizations_select on organizations
  for select using (id = current_organization_id());

alter table team_members enable row level security;

create policy team_members_select on team_members
  for select using (organization_id = current_organization_id());

create policy team_members_insert on team_members
  for insert with check (is_admin() and organization_id = current_organization_id());

create policy team_members_update on team_members
  for update using (is_admin() and organization_id = current_organization_id())
  with check (is_admin() and organization_id = current_organization_id());
