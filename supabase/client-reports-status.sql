-- Reports: estado do report (rascunho/enviado) — segue o ajuste pedido pelo
-- usuário depois da primeira versão (supabase/client-reports.sql, já
-- aplicada): "Reports" continua sendo um módulo dentro da gestão do
-- cliente (nunca uma aba própria), mas agora com um ciclo de vida explícito
-- em vez de "salvo = pronto". Rode depois de supabase/client-reports.sql.
--
-- `status` decide quando a execução da recorrência "Reportar cliente" é
-- registrada: nunca ao salvar um rascunho, só quando o gestor confirma que
-- o conteúdo foi de fato enviado ao cliente (`markClientReportSentAction`).
-- Copiar o texto pro WhatsApp NÃO marca como enviado sozinho — o gestor pode
-- copiar e ainda ajustar antes de mandar, decisão explícita do usuário.

alter table client_reports add column if not exists status text not null default 'draft';

alter table client_reports drop constraint if exists client_reports_status_check;
alter table client_reports add constraint client_reports_status_check check (status in ('draft', 'sent'));

alter table client_reports add column if not exists sent_at timestamptz;
alter table client_reports add column if not exists sent_by uuid references team_members (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Taxonomia nova em operational_events (client_report_sent) — mesma
-- constraint estendida de novo, lista completa reproduzida (inclui
-- team_member_deleted/task_deleted, adicionados por admin-permissions.sql —
-- omitidos por engano na primeira versão de client-reports.sql).
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
  'client_update_marked_sent', 'client_update_marked_unsent',
  'client_report_generated', 'client_report_edited', 'client_report_sent'
));
