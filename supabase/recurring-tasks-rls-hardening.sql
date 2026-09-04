-- Etapa 2A (Auditoria de Segurança — correções prioritárias): as 4 policies
-- de SELECT abaixo foram criadas em recurring-tasks.sql como
-- `for select using (true)`, sem `to authenticated` — a auditoria confirmou
-- que isso é lido pela API REST do Supabase por QUALQUER requisição
-- anônima (role `anon`), sem login nenhum na MITZA, já que nenhuma migration
-- do projeto faz `revoke`/`grant` explícito por role (o modelo de segurança
-- inteiro depende só da expressão de cada policy).
--
-- Regra de negócio real, confirmada nos consumidores antes desta correção
-- (nunca uma correção genérica "to authenticated using (true))" sem entender
-- o uso):
--   - `recurring_tasks`/`recurring_task_checklist_items`/
--     `recurring_task_goal_history` não têm coluna `client_id` (são
--     catálogo/config COMPARTILHADA da agência inteira — tipo de
--     recorrência, itens de checklist, histórico de meta semanal) e são
--     lidas por QUALQUER gestor ativo, não só admin: a fila de Sprints
--     (`fetchRecurringTaskListsForSprints`, src/lib/recurring-task-data.ts,
--     usada por `/sprints`) busca `recurring_tasks`/
--     `recurring_task_goal_history` inteiras pra montar a lista de
--     recorrências de qualquer sprint que o gestor já tem acesso via
--     `sprints_select` — e o drawer de detalhe
--     (`fetchRecurringTaskDetail`) lê `recurring_task_checklist_items` do
--     mesmo jeito. Restringir essas 3 a `is_admin()` quebraria `/sprints`
--     pra qualquer gestor. A correção certa é negar só quem não é membro
--     ativo da equipe (`current_team_member_id()`, já usado em
--     team-members.sql pro mesmo padrão de "colaboração interna, não
--     secreto") — nunca `anon`.
--   - `recurring_task_clients` TEM `client_id` — pode e deve usar o mesmo
--     padrão de toda tabela escopada por cliente (`is_admin() or
--     is_client_manager(client_id)`), mais restrito que as outras 3 e
--     consistente com `recurring_task_executions` (a 5ª tabela do domínio,
--     que já nasceu com essa regra certa em recurring-tasks.sql).
--
-- Escrita (`_write`, `is_admin()`) não muda — já estava correta.
--
-- Idempotente: `drop policy if exists` + `create policy`, seguro rodar mais
-- de uma vez e seguro rodar em cima da produção existente (só troca a
-- condição de SELECT, não toca em dado nenhum).

drop policy if exists recurring_tasks_select on recurring_tasks;
create policy recurring_tasks_select on recurring_tasks
  for select using (current_team_member_id() is not null);

drop policy if exists recurring_task_checklist_items_select on recurring_task_checklist_items;
create policy recurring_task_checklist_items_select on recurring_task_checklist_items
  for select using (current_team_member_id() is not null);

drop policy if exists recurring_task_goal_history_select on recurring_task_goal_history;
create policy recurring_task_goal_history_select on recurring_task_goal_history
  for select using (current_team_member_id() is not null);

drop policy if exists recurring_task_clients_select on recurring_task_clients;
create policy recurring_task_clients_select on recurring_task_clients
  for select using (is_admin() or is_client_manager(client_id));
