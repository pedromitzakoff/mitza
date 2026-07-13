-- Etapa 56: telemetria operacional interna (operational_events) — histórico
-- append-only de eventos de negócio, para análise/auditoria/gamificação
-- futura. Rode por último, depois de supabase/team-members.sql.
--
-- NÃO substitui nenhuma entidade de domínio: tasks/clients/sprints/
-- monthly_budget_changes/monthly_reports continuam sendo a fonte de
-- verdade do estado atual. operational_events só registra "o que
-- aconteceu", nunca é lido para decidir o estado atual de nada.
--
-- Distinto de `operational_activities` (Etapa 15): aquela tabela é um log
-- fino e específico ("quando foi a última atividade deste cliente/sprint",
-- só 5 tipos, sem prazo/atraso/metadata) que já alimenta o painel
-- "Acompanhamento operacional" da página do cliente — continua existindo,
-- sem mudança. Esta tabela nova é a camada analítica ampla pedida agora
-- (taxonomia extensa, ator separado de responsável, prazo esperado vs
-- realizado, atraso em segundos, correlação entre eventos, idempotência).
-- Não seria seguro nem simples reaproveitar/expandir operational_activities
-- pra isso: mudaria o contrato de uma tabela já lida pela UI hoje.

-- ---------------------------------------------------------------------------
-- Colunas novas em tasks — necessárias pra não perder informação histórica
-- que hoje não existe em lugar nenhum (achado da investigação: updateTaskAction
-- sobrescrevia assignee_id/due_date sem nunca ler o valor anterior; não
-- existe completed_at; não existe contador de reatribuição/alteração de
-- prazo/reabertura). Todas aditivas, default seguro, nada é apagado.
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists original_due_date date;
alter table tasks add column if not exists completed_at timestamptz;
alter table tasks add column if not exists completion_count integer not null default 0;
alter table tasks add column if not exists reassignment_count integer not null default 0;
alter table tasks add column if not exists due_date_change_count integer not null default 0;
alter table tasks add column if not exists reopened_count integer not null default 0;

-- Backfill: original_due_date = due_date atual pra tarefas já existentes.
-- Isto NÃO recupera um valor original de antes desta migration se o prazo já
-- tinha sido alterado alguma vez no passado (essa informação nunca foi
-- guardada) — é o melhor valor de partida disponível, não um dado inventado.
update tasks set original_due_date = due_date where original_due_date is null;

alter table tasks alter column original_due_date set not null;

-- completed_at fica null pra tarefas já concluídas antes desta migration —
-- não existe registro confiável de QUANDO cada uma foi concluída (mesma
-- decisão já tomada em operational-activities.sql pro backfill de
-- task_completed, que também pula esse caso pelo mesmo motivo).

-- ---------------------------------------------------------------------------
-- operational_events
-- ---------------------------------------------------------------------------
create table if not exists operational_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  event_type text not null check (event_type in (
    'team_member_created', 'team_member_updated', 'team_member_deactivated',
    'team_member_reactivated', 'team_member_invited', 'team_member_access_activated',
    'team_member_access_revoked',
    'client_created', 'client_manager_assigned', 'client_manager_changed', 'client_status_changed',
    'task_created', 'task_assigned', 'task_reassigned', 'task_due_date_changed',
    'task_completed', 'task_reopened',
    'optimization_completed',
    'meeting_scheduled', 'meeting_rescheduled', 'meeting_completed', 'meeting_cancelled',
    'creative_delivery_scheduled', 'creative_delivery_completed', 'creative_delivery_late',
    'monthly_budget_created', 'monthly_budget_changed',
    'monthly_report_started', 'monthly_report_ready_for_review', 'monthly_report_finalized',
    'monthly_report_reopened'
  )),

  -- Quem executou a ação (pode ser diferente de quem é o responsável da
  -- entidade — ver metadata.assignee_team_member_id em eventos de tarefa).
  actor_team_member_id uuid references team_members (id) on delete set null,
  actor_auth_user_id uuid references auth.users (id) on delete set null,

  client_id uuid references clients (id) on delete set null,
  sprint_id uuid references sprints (id) on delete set null,

  entity_type text not null check (entity_type in (
    'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report'
  )),
  entity_id uuid not null,

  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  expected_at timestamptz,
  completed_at timestamptz,
  was_on_time boolean,
  delay_seconds integer,

  source text not null default 'server' check (source in (
    'web', 'server', 'system', 'integration', 'migration', 'automation'
  )),

  -- Liga eventos que são duas representações analíticas do mesmo
  -- acontecimento (ex.: task_completed + optimization_completed).
  correlation_id uuid,

  -- Proteção contra duplo clique/retry: mesma convenção já usada no projeto
  -- (unique index + on conflict do nothing), não uma coluna sem garantia.
  idempotency_key text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists operational_events_org_occurred_idx
  on operational_events (organization_id, occurred_at desc);
create index if not exists operational_events_actor_occurred_idx
  on operational_events (actor_team_member_id, occurred_at desc);
create index if not exists operational_events_client_occurred_idx
  on operational_events (client_id, occurred_at desc);
create index if not exists operational_events_type_occurred_idx
  on operational_events (event_type, occurred_at desc);
create index if not exists operational_events_entity_idx
  on operational_events (entity_type, entity_id);
create index if not exists operational_events_sprint_idx
  on operational_events (sprint_id) where sprint_id is not null;
create unique index if not exists operational_events_idempotency_key_unique
  on operational_events (idempotency_key) where idempotency_key is not null;

-- Append-only: sem policy de update/delete (nem para admin) — correções
-- futuras devem ser eventos compensatórios, nunca edição do histórico.
alter table operational_events enable row level security;

create policy operational_events_select on operational_events
  for select using (organization_id = current_organization_id());

-- Insert só pode gravar dentro da própria organização e, quando houver ator,
-- só em nome de quem está de fato logado — nunca confiar em actor_id/
-- organization_id/was_on_time/delay_seconds enviados pelo cliente: o
-- servidor sempre resolve esses valores antes de inserir (ver
-- lib/record-operational-event.ts), e esta policy é a segunda camada que
-- impede um insert direto forjado mesmo que alguém tentasse pular o serviço
-- central.
create policy operational_events_insert on operational_events
  for insert with check (
    organization_id = current_organization_id()
    and (actor_team_member_id is null or actor_team_member_id = current_team_member_id())
  );

-- ---------------------------------------------------------------------------
-- complete_task_and_record_event: única operação que marca uma tarefa como
-- feita — atualiza tasks e grava task_completed (+ o evento específico do
-- tipo, correlacionado) na MESMA transação. Calcula no_prazo/atraso
-- server-side a partir do fuso operacional (nunca client-side), usando
-- "at time zone 'America/Sao_Paulo'" do Postgres (que já respeita a regra
-- de fuso, sem hardcode de offset) — o prazo vence à meia-noite do dia
-- SEGUINTE a due_date no fuso da agência, ou seja, a tarefa pode ser
-- concluída o dia inteiro do due_date, igual à regra já usada em
-- lib/task-status.ts.
-- ---------------------------------------------------------------------------
create or replace function complete_task_and_record_event(
  p_task_id uuid,
  p_actor_team_member_id uuid,
  p_actor_auth_user_id uuid,
  p_source text default 'web'
) returns jsonb as $$
declare
  v_task tasks%rowtype;
  v_now timestamptz := now();
  v_due_end timestamptz;
  v_original_due_end timestamptz;
  v_was_on_time boolean;
  v_delay_seconds integer;
  v_was_on_time_original boolean;
  v_delay_seconds_original integer;
  v_completion_count int;
  v_correlation_id uuid := gen_random_uuid();
  v_type_event text;
  v_org_id uuid;
  v_client_manager_id uuid;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Tarefa não encontrada';
  end if;

  select organization_id into v_org_id from team_members where id = p_actor_team_member_id;
  select primary_manager_id into v_client_manager_id from clients where id = v_task.client_id;

  v_completion_count := v_task.completion_count + 1;

  v_due_end := ((v_task.due_date + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_original_due_end := ((v_task.original_due_date + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_was_on_time := v_now <= v_due_end;
  v_delay_seconds := greatest(0, extract(epoch from (v_now - v_due_end)))::int;
  v_was_on_time_original := v_now <= v_original_due_end;
  v_delay_seconds_original := greatest(0, extract(epoch from (v_now - v_original_due_end)))::int;

  update tasks
  set status = 'feito', completed_at = v_now, completion_count = v_completion_count
  where id = p_task_id;

  insert into operational_events (
    organization_id, event_type, actor_team_member_id, actor_auth_user_id,
    client_id, sprint_id, entity_type, entity_id, occurred_at, expected_at, completed_at,
    was_on_time, delay_seconds, source, correlation_id, idempotency_key, metadata
  ) values (
    v_org_id, 'task_completed', p_actor_team_member_id, p_actor_auth_user_id,
    v_task.client_id, v_task.sprint_id, 'task', v_task.id, v_now, v_due_end, v_now,
    v_was_on_time, v_delay_seconds, p_source, v_correlation_id,
    'task_completed:' || v_task.id::text || ':' || v_completion_count::text,
    jsonb_build_object(
      'task_type', v_task.type,
      'task_title', v_task.title,
      'assignee_team_member_id', v_task.assignee_id,
      'client_manager_id', v_client_manager_id,
      'original_due_at', v_original_due_end,
      'current_due_at', v_due_end,
      'task_created_at', v_task.created_at,
      'completion_count', v_completion_count,
      'reopened_count', v_task.reopened_count,
      'reassignment_count', v_task.reassignment_count,
      'due_date_change_count', v_task.due_date_change_count,
      'was_on_time_original_due_date', v_was_on_time_original,
      'delay_seconds_original_due_date', v_delay_seconds_original
    )
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  if v_task.type in ('otimizacao', 'reuniao', 'entrega_criativo') then
    v_type_event := case v_task.type
      when 'otimizacao' then 'optimization_completed'
      when 'reuniao' then 'meeting_completed'
      when 'entrega_criativo' then 'creative_delivery_completed'
    end;

    insert into operational_events (
      organization_id, event_type, actor_team_member_id, actor_auth_user_id,
      client_id, sprint_id, entity_type, entity_id, occurred_at, expected_at, completed_at,
      was_on_time, delay_seconds, source, correlation_id, idempotency_key, metadata
    ) values (
      v_org_id, v_type_event, p_actor_team_member_id, p_actor_auth_user_id,
      v_task.client_id, v_task.sprint_id, 'task', v_task.id, v_now, v_due_end, v_now,
      v_was_on_time, v_delay_seconds, p_source, v_correlation_id,
      v_type_event || ':' || v_task.id::text || ':' || v_completion_count::text,
      jsonb_build_object(
        'task_title', v_task.title,
        'assignee_team_member_id', v_task.assignee_id,
        'client_manager_id', v_client_manager_id
      )
    )
    on conflict (idempotency_key) where idempotency_key is not null do nothing;
  end if;

  return jsonb_build_object(
    'correlationId', v_correlation_id, 'wasOnTime', v_was_on_time, 'delaySeconds', v_delay_seconds
  );
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- apply_monthly_budget_change (redefinida): mesma lógica de redistribuição
-- de sempre, agora também grava monthly_budget_created (primeira vez que o
-- cliente/mês recebe uma alteração) ou monthly_budget_changed, na mesma
-- transação da própria função.
-- ---------------------------------------------------------------------------
create or replace function apply_monthly_budget_change(
  p_client_id uuid,
  p_first_day date,
  p_last_day date,
  p_effective_date date,
  p_new_budget numeric,
  p_today date,
  p_changed_by uuid
) returns jsonb as $$
declare
  v_consolidated numeric(12, 2) := 0;
  v_previous_total numeric(12, 2) := 0;
  v_future_available numeric(12, 2) := 0;
  v_is_below boolean := false;
  v_future_start date;
  v_future_days int := 0;
  v_total_cents bigint := 0;
  v_base_cents bigint := 0;
  v_remainder_cents bigint := 0;
  v_sprint_count int := 0;
  v_prior_changes_count int := 0;
  v_change_id uuid;
  v_org_id uuid;
  v_event_type text;
begin
  if p_new_budget < 0 then
    raise exception 'Orçamento não pode ser negativo';
  end if;

  if p_last_day < p_today then
    raise exception 'Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.';
  end if;

  select count(*) into v_sprint_count
    from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day;

  if v_sprint_count = 0 then
    raise exception 'Sprints deste mês ainda não foram geradas para este cliente.';
  end if;

  select count(*) into v_prior_changes_count
    from monthly_budget_changes
    where client_id = p_client_id and month = p_first_day;

  -- Trava as sprints do cliente no mês pra serializar edições concorrentes.
  perform 1 from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    for update;

  select coalesce(sum(planned_amount), 0) into v_consolidated
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_effective_date;

  select coalesce(sum(planned_amount), 0) into v_previous_total
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_last_day;

  v_future_available := p_new_budget - v_consolidated;
  v_is_below := v_future_available < 0;
  if v_is_below then
    v_future_available := 0;
  end if;

  v_future_start := greatest(p_effective_date + 1, p_first_day);
  v_future_days := greatest((p_last_day - v_future_start) + 1, 0);

  if v_future_days > 0 then
    v_total_cents := round(v_future_available * 100)::bigint;
    v_base_cents := v_total_cents / v_future_days;
    v_remainder_cents := v_total_cents - v_base_cents * v_future_days;

    with future_dates as (
      select d::date as date, row_number() over (order by d) as rn
      from generate_series(v_future_start, p_last_day, interval '1 day') as d
    ),
    target_sprints as (
      select id as sprint_id, start_date, end_date from sprints
      where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    )
    insert into sprint_planned_allocations (sprint_id, client_id, date, planned_amount, updated_at)
    select
      ts.sprint_id,
      p_client_id,
      fd.date,
      (v_base_cents + case when fd.rn = v_future_days then v_remainder_cents else 0 end) / 100.0,
      now()
    from future_dates fd
    join target_sprints ts on fd.date >= ts.start_date and fd.date <= ts.end_date
    on conflict (sprint_id, date) do update
      set planned_amount = excluded.planned_amount, updated_at = now();
  end if;

  update sprints s
  set planned_spend = coalesce(sub.total, 0)
  from (
    select sprint_id, sum(planned_amount) as total
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_last_day
    group by sprint_id
  ) sub
  where s.id = sub.sprint_id
    and s.client_id = p_client_id and s.start_date >= p_first_day and s.start_date <= p_last_day;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_consolidated + v_future_available, v_is_below
  )
  returning id into v_change_id;

  select organization_id into v_org_id from team_members where id = p_changed_by;
  v_event_type := case when v_prior_changes_count = 0 then 'monthly_budget_created' else 'monthly_budget_changed' end;

  if v_org_id is not null then
    insert into operational_events (
      organization_id, event_type, actor_team_member_id, actor_auth_user_id,
      client_id, entity_type, entity_id, occurred_at, source, metadata
    ) values (
      v_org_id, v_event_type, p_changed_by, null,
      p_client_id, 'monthly_budget_change', v_change_id, now(), 'web',
      jsonb_build_object(
        'month', p_first_day,
        'previous_amount', v_previous_total,
        'new_amount', p_new_budget,
        'diff_amount', p_new_budget - v_previous_total,
        'diff_percent', case when v_previous_total > 0 then round(((p_new_budget - v_previous_total) / v_previous_total) * 100, 2) else null end,
        'effective_date', p_effective_date,
        'days_elapsed_in_month', (p_effective_date - p_first_day) + 1,
        'consolidated_amount', v_consolidated
      )
    );
  end if;

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_consolidated + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;
