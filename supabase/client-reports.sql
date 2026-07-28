-- Nova aba "Reports" — histórico oficial da comunicação de resultados com o
-- cliente (mensagem de WhatsApp), DIFERENTE da aba "Relatórios" já existente
-- (supabase/monthly-reports.sql — relatório de gestão INTERNO, sem geração
-- de texto/cópia). Mesmo espírito de `client_updates` (supabase/client-
-- updates.sql — gera texto por template, nenhuma IA), mas por PERÍODO
-- arbitrário (não por account_review) e com métricas próprias, editáveis,
-- resolvidas pelo objetivo (`clients.performance_goal`) do cliente.
--
-- Rode depois de supabase/recurring-task-optimization-refactor.sql (usa
-- `register_recurring_execution`, redefinida aqui de novo só pra aceitar o
-- novo parâmetro).

-- ---------------------------------------------------------------------------
-- client_reports: um registro por report gerado — nunca apagado (histórico
-- oficial), mas editável (diferente de account_reviews/client_updates, que
-- só marca timestamps por cima; aqui o próprio conteúdo pode ser reaberto e
-- salvo de novo, decisão explícita do usuário). `metrics` é jsonb — array de
-- `{ key, label, value }`, na ordem de exibição — nunca colunas tipadas por
-- métrica: o conjunto de métricas varia por objetivo (leads/vendas/
-- seguidores) e pode incluir métricas manuais sem integração nenhuma (ex.:
-- cliques/CPC/alcance/engajamento, que a MITZA ainda não rastreia em lugar
-- nenhum — entram em branco pra preenchimento manual, mesmo campo editável
-- cobre isso). `performance_goal` é um SNAPSHOT do objetivo do cliente no
-- momento da geração — nunca recalculado se o objetivo mudar depois (mesmo
-- espírito de "meta congelada" já usado em recurring_task_goal_history).
-- ---------------------------------------------------------------------------
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

create policy client_reports_select on client_reports
  for select using (is_admin() or is_client_manager(client_id));

create policy client_reports_insert on client_reports
  for insert with check (
    (is_admin() or is_client_manager(client_id))
    and created_by = current_team_member_id()
  );

-- Editável de propósito (diferente de account_reviews/client_updates,
-- imutáveis por conteúdo) — "os reports devem permanecer editáveis",
-- decisão explícita do usuário. Sem policy de delete: um report já gerado
-- nunca é apagado, só reaberto e salvo de novo.
create policy client_reports_update on client_reports
  for update using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- Integração com a recorrência "Reportar cliente": mesmo espírito de
-- uses_account_review (Otimização) — flag de integração de BACKEND, nunca
-- exposta em /settings/recurring-tasks. Quando true, o drawer da recorrência
-- troca a observação livre por um botão "Gerar report", que abre este
-- módulo com cliente e sprint já resolvidos; salvar o report registra a
-- execução automaticamente (não duas ações separadas pro gestor).
-- ---------------------------------------------------------------------------
alter table recurring_tasks add column if not exists uses_report boolean not null default false;

alter table recurring_tasks drop constraint if exists recurring_tasks_single_backend_integration_check;
alter table recurring_tasks add constraint recurring_tasks_single_backend_integration_check
  check (not (uses_account_review and uses_report));

update recurring_tasks set uses_report = true where title = 'Reportar cliente';

alter table recurring_task_executions add column if not exists client_report_id uuid references client_reports (id) on delete set null;

-- ---------------------------------------------------------------------------
-- register_recurring_execution (redefinida): só ganha o novo parâmetro
-- `p_client_report_id` (guardado direto, sem branch — só é não-nulo quando
-- quem chama já criou/atualizou o `client_reports` antes e está só
-- registrando a execução em seguida, mesmo padrão de "duas escritas, uma
-- action" já usado por account_review). Resto da função idêntico à versão
-- anterior (supabase/recurring-task-optimization-refactor.sql).
-- ---------------------------------------------------------------------------
create or replace function register_recurring_execution(
  p_recurring_task_id uuid,
  p_client_id uuid,
  p_team_member_id uuid,
  p_auth_user_id uuid,
  p_notes text,
  p_checklist_selected_keys text[] default null,
  p_optimization_selections jsonb default null,
  p_client_report_id uuid default null,
  p_source text default 'web'
) returns jsonb as $$
declare
  v_uses_account_review boolean;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_sprint_id uuid;
  v_sprint_count int;
  v_execution_id uuid;
  v_review_result jsonb;
  v_review_id uuid;
  v_optimizations jsonb;
begin
  select uses_account_review into v_uses_account_review from recurring_tasks where id = p_recurring_task_id;
  if v_uses_account_review is null then
    raise exception 'Tarefa recorrente não encontrada.';
  end if;

  select count(*) into v_sprint_count
    from sprints
    where client_id = p_client_id and start_date <= v_today and end_date >= v_today;

  if v_sprint_count = 0 then
    raise exception 'Nenhuma sprint encontrada para a data de hoje — não é possível registrar a execução.';
  elsif v_sprint_count > 1 then
    raise exception 'Mais de uma sprint encontrada para a data de hoje — problema técnico, execução não registrada.';
  end if;

  select id into v_sprint_id
    from sprints
    where client_id = p_client_id and start_date <= v_today and end_date >= v_today;

  if v_uses_account_review then
    v_optimizations := coalesce(p_optimization_selections, '[]'::jsonb);

    v_review_result := record_account_review(
      p_client_id => p_client_id,
      p_team_member_id => p_team_member_id,
      p_auth_user_id => p_auth_user_id,
      p_reason => 'ROUTINE',
      p_reason_other_description => null,
      p_outcome => case when jsonb_array_length(v_optimizations) > 0 then 'OPTIMIZATION_PERFORMED' else 'NO_CHANGE' end,
      p_notes => p_notes,
      p_issue_description => null,
      p_issue_category => null,
      p_optimizations => v_optimizations,
      p_create_task => false,
      p_task_responsible_id => null,
      p_task_due_date => null,
      p_source => p_source
    );
    v_review_id := (v_review_result ->> 'reviewId')::uuid;
  end if;

  insert into recurring_task_executions (
    recurring_task_id, client_id, sprint_id, team_member_id, performed_by_auth_user_id,
    account_review_id, checklist_selected_keys, optimization_selections, client_report_id, notes
  ) values (
    p_recurring_task_id, p_client_id, v_sprint_id, p_team_member_id, p_auth_user_id,
    v_review_id,
    case when v_uses_account_review then null else p_checklist_selected_keys end,
    case when v_uses_account_review then p_optimization_selections else null end,
    p_client_report_id,
    case when v_uses_account_review or p_client_report_id is not null then null else p_notes end
  )
  returning id into v_execution_id;

  return jsonb_build_object('executionId', v_execution_id, 'sprintId', v_sprint_id, 'accountReviewId', v_review_id);
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Taxonomia nova em operational_events — estende as constraints já
-- existentes (mesmo padrão de client-updates.sql), nunca uma tabela
-- paralela de eventos.
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
  'client_report_generated', 'client_report_edited'
));

alter table operational_events drop constraint if exists operational_events_entity_type_check;
alter table operational_events add constraint operational_events_entity_type_check check (entity_type in (
  'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report',
  'account_review', 'account_optimization', 'client_update', 'client_report'
));
