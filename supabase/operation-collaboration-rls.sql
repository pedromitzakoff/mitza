-- Etapa 15: a tela "Operação" precisa que qualquer gestor logado consiga
-- VER todos os clientes (pra colaborar), mesmo os que não são dele. Isso só
-- muda leitura (select) — escrita (concluir/criar/editar tarefa,
-- planned_spend, dados do cliente) continua exigindo admin ou gestor
-- responsável, exatamente como já era.
-- Rode depois de supabase/soft-delete-clients.sql.

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select using (auth.uid() is not null);

drop policy if exists clients_select on clients;
create policy clients_select on clients
  for select using (auth.uid() is not null);

drop policy if exists client_managers_select on client_managers;
create policy client_managers_select on client_managers
  for select using (auth.uid() is not null);

drop policy if exists sprints_select on sprints;
create policy sprints_select on sprints
  for select using (auth.uid() is not null);

drop policy if exists daily_spend_select on daily_spend;
create policy daily_spend_select on daily_spend
  for select using (auth.uid() is not null);

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks
  for select using (auth.uid() is not null);

-- comments: select abre pra qualquer autenticado (colaboração); insert
-- também abre (qualquer gestor pode comentar, mesmo sem ser responsável
-- pelo cliente) — só continua exigindo author_id = quem está logado.
drop policy if exists comments_select on comments;
create policy comments_select on comments
  for select using (auth.uid() is not null);

drop policy if exists comments_insert on comments;
create policy comments_insert on comments
  for insert with check (author_id = auth.uid());
