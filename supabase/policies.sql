-- Etapa 2: papéis, RLS e proteção por linha.
-- Rode depois de supabase/schema.sql.

-- ---------------------------------------------------------------------------
-- Cria automaticamente um profile (papel default 'gestor') para todo novo
-- usuário do Supabase Auth. Promover alguém a admin é uma operação manual:
--   update profiles set role = 'admin' where id = '<uuid do usuário>';
-- ---------------------------------------------------------------------------
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    'gestor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers usados pelas policies abaixo.
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_client_manager(p_client_id uuid) returns boolean as $$
  select exists (
    select 1 from client_managers
    where client_id = p_client_id and user_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public;

-- Resolve o client_id de um comentário a partir do que ele comenta.
create or replace function commentable_client_id(p_type text, p_id uuid) returns uuid as $$
  select case p_type
    when 'task' then (select client_id from tasks where id = p_id)
    when 'sprint' then (select client_id from sprints where id = p_id)
  end;
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

create policy profiles_select on profiles
  for select using (id = auth.uid() or is_admin());

create policy profiles_update on profiles
  for update using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- clients: admin vê e edita tudo; gestor só vê os clientes atribuídos.
-- ---------------------------------------------------------------------------
alter table clients enable row level security;

create policy clients_select on clients
  for select using (is_admin() or is_client_manager(id));

create policy clients_write on clients
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- client_managers
-- ---------------------------------------------------------------------------
alter table client_managers enable row level security;

create policy client_managers_select on client_managers
  for select using (is_admin() or user_id = auth.uid());

create policy client_managers_write on client_managers
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- sprints: planned_spend só é editável pelo admin (spec do produto).
-- ---------------------------------------------------------------------------
alter table sprints enable row level security;

create policy sprints_select on sprints
  for select using (is_admin() or is_client_manager(client_id));

create policy sprints_write on sprints
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- daily_spend: só a sync (via service role, que ignora RLS) escreve aqui.
-- ---------------------------------------------------------------------------
alter table daily_spend enable row level security;

create policy daily_spend_select on daily_spend
  for select using (is_admin() or is_client_manager(client_id));

create policy daily_spend_write on daily_spend
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- tasks: admin ou gestor do cliente podem criar/editar.
-- ---------------------------------------------------------------------------
alter table tasks enable row level security;

create policy tasks_select on tasks
  for select using (is_admin() or is_client_manager(client_id));

create policy tasks_write on tasks
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- comments: visível/editável por quem gerencia o cliente do item comentado;
-- só o autor (ou admin) edita/apaga um comentário já criado.
-- ---------------------------------------------------------------------------
alter table comments enable row level security;

create policy comments_select on comments
  for select using (
    is_admin() or is_client_manager(commentable_client_id(commentable_type, commentable_id))
  );

create policy comments_insert on comments
  for insert with check (
    author_id = auth.uid()
    and (is_admin() or is_client_manager(commentable_client_id(commentable_type, commentable_id)))
  );

create policy comments_update on comments
  for update using (is_admin() or author_id = auth.uid())
  with check (is_admin() or author_id = auth.uid());

create policy comments_delete on comments
  for delete using (is_admin() or author_id = auth.uid());
