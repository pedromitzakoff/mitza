-- Permissões admin x gestor: exclusão de tarefa passa a ser admin-only
-- também no banco (defesa em profundidade), não só na Server Action.
-- NÃO EXECUTAR sem aprovação — só roda manualmente no SQL Editor do
-- Supabase quando o admin decidir aplicar.
--
-- tasks_write hoje é "for all" (select/insert/update/delete) liberado tanto
-- pra admin quanto pro gestor do cliente. A UI nunca chamava DELETE em
-- tasks até agora (não existia botão de excluir tarefa) — a policy
-- permitia, mas nunca era exercida. Como a nova funcionalidade de excluir
-- tarefa é admin-only, esta migration separa a policy única em três:
-- select (sem mudança), insert/update (continuam admin OU gestor do
-- cliente, sem mudança de comportamento) e delete (agora só admin).
--
-- Também adiciona a exclusão definitiva de membro da equipe (admin-only):
-- team_members nunca teve policy de delete (RLS sem policy = delete negado
-- pra todo mundo por padrão), então esta migration cria explicitamente uma,
-- só pra admin — a Server Action já bloqueia com requireAdmin(), isso é
-- defesa em profundidade no banco.
--
-- Não apaga nem altera nenhum dado — só cria/substitui policies e estende a
-- constraint de event_type de operational_events (mesmo padrão já usado em
-- account-reviews.sql e client-updates.sql) pra aceitar os novos tipos
-- 'task_deleted' e 'team_member_deleted'.

drop policy if exists tasks_write on tasks;

create policy tasks_insert on tasks
  for insert with check (is_admin() or is_client_manager(client_id));

create policy tasks_update on tasks
  for update using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

create policy tasks_delete on tasks
  for delete using (is_admin());

-- ---------------------------------------------------------------------------
-- team_members: nunca teve policy de delete — cria uma, admin-only.
-- ---------------------------------------------------------------------------
drop policy if exists team_members_delete on team_members;

create policy team_members_delete on team_members
  for delete using (is_admin());

-- ---------------------------------------------------------------------------
-- operational_events: novos tipos task_deleted e team_member_deleted.
-- ---------------------------------------------------------------------------
alter table operational_events drop constraint if exists operational_events_event_type_check;
alter table operational_events add constraint operational_events_event_type_check check (event_type in (
  'team_member_created', 'team_member_updated', 'team_member_deactivated',
  'team_member_reactivated', 'team_member_invited', 'team_member_access_activated',
  'team_member_access_revoked', 'team_member_deleted',
  'client_created', 'client_manager_assigned', 'client_manager_changed', 'client_status_changed',
  'task_created', 'task_assigned', 'task_reassigned', 'task_due_date_changed',
  'task_completed', 'task_reopened', 'task_deleted',
  'optimization_completed',
  'meeting_scheduled', 'meeting_rescheduled', 'meeting_completed', 'meeting_cancelled',
  'creative_delivery_scheduled', 'creative_delivery_completed', 'creative_delivery_late',
  'monthly_budget_created', 'monthly_budget_changed',
  'monthly_report_started', 'monthly_report_ready_for_review', 'monthly_report_finalized',
  'monthly_report_reopened',
  'account_review_recorded', 'account_review_no_change', 'account_review_optimization_performed',
  'account_review_issue_identified', 'account_optimization_recorded',
  'client_update_generated', 'client_update_edited', 'client_update_copied',
  'client_update_marked_sent', 'client_update_marked_unsent'
));
