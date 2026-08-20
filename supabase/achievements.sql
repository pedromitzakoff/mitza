-- Conquistas / Marcos (Auditoria "Sistema de Conquistas") — reaproveita
-- 100% `operational_events` (Etapa 56): uma conquista é, por definição, um
-- acontecimento histórico e imutável — exatamente o que essa tabela já
-- garante (append-only, sem policy de update/delete). Nenhuma tabela nova.
--
-- Extensão estritamente ADITIVA das duas constraints CHECK — a lista
-- completa abaixo é copiada de `client-reports-reaffirm.sql` (a versão mais
-- recente confirmada em produção, ver commit "Corrige lista da constraint
-- de operational_events na reafirmação de client_reports"), só acrescentando
-- 'achievement_unlocked'/'achievement' no fim de cada lista. Nenhum valor
-- existente é removido ou renomeado — nenhum evento já gravado muda de
-- comportamento.
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
  'client_report_generated', 'client_report_edited', 'client_report_sent',
  'achievement_unlocked'
));

alter table operational_events drop constraint if exists operational_events_entity_type_check;
alter table operational_events add constraint operational_events_entity_type_check check (entity_type in (
  'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report',
  'account_review', 'account_optimization', 'client_update', 'client_report',
  'achievement'
));

-- ---------------------------------------------------------------------------
-- record_achievement_event: única operação que grava uma conquista — mesmo
-- padrão de "1 RPC por escrita de operational_events" já usado em todo o
-- resto do produto (complete_task_and_record_event, apply_monthly_budget_change,
-- record_account_review), nunca um insert direto vindo do código de rota.
--
-- Idempotência é a razão de existir desta função: `p_idempotency_key` é
-- SEMPRE calculado pelo motor (`lib/achievement-engine.ts`) como
-- `achievement:{scope}:{subjectId}:{achievementType}:{windowKey}` — o
-- `on conflict ... do nothing` garante que reprocessar (rerun manual, deploy,
-- cron duplicado) nunca duplica a mesma conquista, mesmo padrão exato já
-- provado em `complete_task_and_record_event`.
--
-- `entity_id` recebe um uuid novo a cada chamada (`gen_random_uuid()`) só
-- pra satisfazer o `not null` da coluna — não existe uma tabela de domínio
-- "achievements" pra apontar (decisão da Auditoria: reaproveitar
-- `operational_events` em vez de criar uma). Ele nunca participa da
-- idempotência (isso é só `idempotency_key`), então gerar um valor novo em
-- toda chamada — mesmo numa tentativa que será descartada pelo conflito —
-- não tem efeito nenhum além de nunca ser lido de volta.
--
-- `source = 'system'` (já um valor válido da constraint existente) — a
-- conquista é detectada pelo motor, nunca uma ação de um usuário logado.
-- `actor_team_member_id` só é setado pro escopo Pessoa (marco individual);
-- Cliente e Agência gravam `null` (mesma regra de "ator pode ser null" já
-- suportada pela policy de insert existente).
-- ---------------------------------------------------------------------------
create or replace function record_achievement_event(
  p_organization_id uuid,
  p_client_id uuid,
  p_actor_team_member_id uuid,
  p_occurred_at timestamptz,
  p_idempotency_key text,
  p_metadata jsonb
) returns jsonb as $$
declare
  v_id uuid;
begin
  insert into operational_events (
    organization_id, event_type, actor_team_member_id, actor_auth_user_id,
    client_id, entity_type, entity_id, occurred_at, source, idempotency_key, metadata
  ) values (
    p_organization_id, 'achievement_unlocked', p_actor_team_member_id, null,
    p_client_id, 'achievement', gen_random_uuid(), p_occurred_at, 'system', p_idempotency_key, p_metadata
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  return jsonb_build_object('eventId', v_id, 'inserted', v_id is not null);
end;
$$ language plpgsql;
