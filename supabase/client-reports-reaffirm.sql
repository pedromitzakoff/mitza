-- Reafirmação idempotente de supabase/client-reports.sql — mesmo padrão de
-- supabase/register-recurring-execution-cleanup-v2.sql: descobrimos que
-- `register_recurring_execution` (redefinida nesse mesmo arquivo, com o
-- parâmetro novo `p_client_report_id`) nunca chegou a existir em produção —
-- ou seja, supabase/client-reports.sql como um todo muito provavelmente
-- nunca rodou por completo lá, o que bate com o crash "Não foi possível
-- carregar esta página" ao tentar criar/salvar um report (o Server Action
-- em `client-report-actions.ts` insere/atualiza `client_reports`
-- diretamente — se a tabela não existe, a exceção não tratada vira esse
-- error boundary genérico do Next.js).
--
-- Esta migration cobre TUDO que supabase/client-reports.sql cria, exceto a
-- redefinição de `register_recurring_execution` (já corrigida por
-- register-recurring-execution-cleanup-v2.sql — recriar de novo aqui seria
-- redundante, mesmo corpo, mesma assinatura). Escrita pra ser seguro rodar
-- tanto se client-reports.sql nunca rodou (cria tudo do zero) quanto se
-- rodou parcialmente (cada passo é idempotente — `if not exists` nas
-- tabelas/colunas/índices, `drop policy if exists` + `create policy` nas
-- policies, já que `create policy` sozinho não aceita `if not exists`).

create table if not exists client_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,

  period_start date not null,
  period_end date not null,

  performance_goal text check (performance_goal in ('leads', 'sales', 'followers')),

  metrics jsonb not null default '[]'::jsonb,
  observations text,
  final_text text not null,

  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (period_end >= period_start)
);

create index if not exists client_reports_client_idx on client_reports (client_id, period_start desc);
create index if not exists client_reports_org_idx on client_reports (organization_id, created_at desc);

create or replace function set_client_reports_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_reports_set_updated_at on client_reports;
create trigger client_reports_set_updated_at
  before update on client_reports
  for each row execute function set_client_reports_updated_at();

alter table client_reports enable row level security;

drop policy if exists client_reports_select on client_reports;
create policy client_reports_select on client_reports
  for select using (is_admin() or is_client_manager(client_id));

drop policy if exists client_reports_insert on client_reports;
create policy client_reports_insert on client_reports
  for insert with check (
    (is_admin() or is_client_manager(client_id))
    and created_by = current_team_member_id()
  );

drop policy if exists client_reports_update on client_reports;
create policy client_reports_update on client_reports
  for update using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

alter table recurring_tasks add column if not exists uses_report boolean not null default false;

alter table recurring_tasks drop constraint if exists recurring_tasks_single_backend_integration_check;
alter table recurring_tasks add constraint recurring_tasks_single_backend_integration_check
  check (not (uses_account_review and uses_report));

update recurring_tasks set uses_report = true where title = 'Reportar cliente';

alter table recurring_task_executions add column if not exists client_report_id uuid references client_reports (id) on delete set null;

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
  'client_report_generated', 'client_report_edited'
));

alter table operational_events drop constraint if exists operational_events_entity_type_check;
alter table operational_events add constraint operational_events_entity_type_check check (entity_type in (
  'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report',
  'account_review', 'account_optimization', 'client_update', 'client_report'
));

-- Checagem de diagnóstico (comentada — descomente e rode manualmente pra
-- confirmar): deve retornar 1 linha.
--
-- select table_name from information_schema.tables where table_schema = 'public' and table_name = 'client_reports';
