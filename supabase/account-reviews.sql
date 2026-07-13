-- Etapa 57: Análises da Conta e Otimizações — substitui o modelo antigo de
-- tarefa recorrente "Otimização" por um registro estruturado (account_reviews
-- + account_optimizations), integrado à telemetria de operational_events
-- (Etapa 56). Rode por último, depois de supabase/operational-events.sql.
--
-- account_reviews/account_optimizations são a fonte de verdade do que foi
-- analisado/otimizado — operational_events continua sendo só a camada
-- histórica append-only, nunca a fonte de estado (mesma regra da Etapa 56).

-- ---------------------------------------------------------------------------
-- Desativa a geração futura do template global "Otimização" (seção 2):
-- desativar, nunca apagar — preserva o registro do template e todas as
-- tarefas já geradas por ele (histórico intocado, `generate_sprint_tasks_
-- from_templates` já filtra `is_active = true`, então isto por si só já
-- impede novas tarefas de Otimização em sprints futuras). Identificado pelo
-- `type` sistêmico (nunca por comparação de título — títulos de templates
-- não-"outro" são derivados, nunca editáveis pelo admin).
-- ---------------------------------------------------------------------------
update sprint_task_templates set is_active = false where type = 'otimizacao';

-- ---------------------------------------------------------------------------
-- account_review_cadences: configuração mínima de cadência por cliente
-- (seção 25) — nenhuma data fixa de otimização, só uma meta de frequência e
-- um intervalo máximo tolerado. Admin-only (mesmo padrão de configuração de
-- orçamento/KPIs).
-- ---------------------------------------------------------------------------
create table if not exists account_review_cadences (
  client_id uuid primary key references clients (id) on delete cascade,
  reviews_per_week smallint not null default 3 check (reviews_per_week > 0),
  max_business_days_without_review smallint not null default 3 check (max_business_days_without_review > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_account_review_cadences_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists account_review_cadences_set_updated_at on account_review_cadences;
create trigger account_review_cadences_set_updated_at
  before update on account_review_cadences
  for each row execute function set_account_review_cadences_updated_at();

alter table account_review_cadences enable row level security;

create policy account_review_cadences_select on account_review_cadences
  for select using (is_admin() or is_client_manager(client_id));

create policy account_review_cadences_write on account_review_cadences
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- account_reviews: "Analisei esta conta e tomei uma decisão operacional."
-- Sem data fixa — pode ser registrada a qualquer momento; reviewed_at é
-- sempre resolvido pelo servidor (nunca enviado pelo frontend).
-- ---------------------------------------------------------------------------
create table if not exists account_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid not null references sprints (id) on delete restrict,
  team_member_id uuid references team_members (id) on delete set null,
  performed_by_auth_user_id uuid references auth.users (id) on delete set null,

  reviewed_at timestamptz not null default now(),

  reason text not null check (reason in (
    'ROUTINE', 'PERFORMANCE_ALERT', 'INVESTMENT_ALERT', 'CLIENT_REQUEST', 'OPPORTUNITY', 'OTHER'
  )),
  reason_other_description text,

  outcome text not null check (outcome in ('NO_CHANGE', 'OPTIMIZATION_PERFORMED', 'ISSUE_IDENTIFIED')),

  notes text,

  issue_description text,
  issue_category text,
  issue_task_id uuid references tasks (id) on delete set null,

  previous_review_at timestamptz,
  seconds_since_previous_review integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (reason <> 'OTHER' or reason_other_description is not null),
  check (outcome <> 'ISSUE_IDENTIFIED' or (issue_description is not null and length(trim(issue_description)) > 0))
);

create index if not exists account_reviews_client_reviewed_idx on account_reviews (client_id, reviewed_at desc);
create index if not exists account_reviews_sprint_idx on account_reviews (sprint_id);
create index if not exists account_reviews_team_member_idx on account_reviews (team_member_id, reviewed_at desc);
create index if not exists account_reviews_org_idx on account_reviews (organization_id, reviewed_at desc);

alter table account_reviews enable row level security;

create policy account_reviews_select on account_reviews
  for select using (is_admin() or is_client_manager(client_id));

-- Insert sempre pelo fluxo confiável (record_account_review, abaixo) rodando
-- como o próprio usuário autenticado — a policy ainda assim exige que o
-- team_member_id gravado seja o de quem está logado, nunca outro (seção 36).
create policy account_reviews_insert on account_reviews
  for insert with check (
    (is_admin() or is_client_manager(client_id))
    and team_member_id = current_team_member_id()
  );

-- Imutável nesta primeira versão (seção 37) — sem policy de update/delete.

-- ---------------------------------------------------------------------------
-- account_optimizations: mudança efetivamente realizada; sempre pertence a
-- uma análise (nunca existe isolada).
-- ---------------------------------------------------------------------------
create table if not exists account_optimizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  account_review_id uuid not null references account_reviews (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid not null references sprints (id) on delete restrict,

  optimization_type text not null check (optimization_type in (
    'CREATIVE', 'AUDIENCE', 'BID', 'BUDGET', 'CAMPAIGN', 'AD_SET', 'PLACEMENT',
    'ACCOUNT_STRUCTURE', 'TRACKING', 'OTHER'
  )),
  optimization_action text not null,

  description text,
  reason text,
  expected_impact text,

  created_at timestamptz not null default now(),

  -- Defesa em profundidade: a ação precisa ser compatível com o tipo (a UI
  -- já só mostra ações compatíveis, mas o banco nunca confia só nisso).
  check (
    (optimization_type = 'CREATIVE' and optimization_action in ('PAUSED', 'ACTIVATED', 'ADDED', 'REPLACED', 'TEST_CREATED', 'OTHER'))
    or (optimization_type = 'AUDIENCE' and optimization_action in ('CREATED', 'PAUSED', 'ACTIVATED', 'SEGMENTATION_CHANGED', 'SEGMENTATION_EXCLUDED', 'OTHER'))
    or (optimization_type = 'BID' and optimization_action in ('INCREASED', 'DECREASED', 'STRATEGY_CHANGED', 'LIMIT_CHANGED', 'OTHER'))
    or (optimization_type = 'BUDGET' and optimization_action in ('INCREASED', 'DECREASED', 'REDISTRIBUTED', 'OTHER'))
    or (optimization_type = 'CAMPAIGN' and optimization_action in ('CREATED', 'PAUSED', 'ACTIVATED', 'CONFIGURATION_CHANGED', 'OTHER'))
    or (optimization_type = 'AD_SET' and optimization_action in ('CREATED', 'PAUSED', 'ACTIVATED', 'CONFIGURATION_CHANGED', 'OTHER'))
    or (optimization_type = 'PLACEMENT' and optimization_action in ('ADDED', 'REMOVED', 'CHANGED', 'OTHER'))
    or (optimization_type = 'ACCOUNT_STRUCTURE' and optimization_action in ('REORGANIZED', 'CONSOLIDATED', 'SPLIT', 'OTHER'))
    or (optimization_type = 'TRACKING' and optimization_action in ('CONFIGURED', 'CORRECTED', 'VALIDATED', 'OTHER'))
    or (optimization_type = 'OTHER' and optimization_action = 'OTHER')
  )
);

create index if not exists account_optimizations_review_idx on account_optimizations (account_review_id);
create index if not exists account_optimizations_client_idx on account_optimizations (client_id, created_at desc);
create index if not exists account_optimizations_type_idx on account_optimizations (optimization_type, created_at desc);
create index if not exists account_optimizations_sprint_idx on account_optimizations (sprint_id);

alter table account_optimizations enable row level security;

create policy account_optimizations_select on account_optimizations
  for select using (is_admin() or is_client_manager(client_id));

create policy account_optimizations_insert on account_optimizations
  for insert with check (is_admin() or is_client_manager(client_id));

-- Imutável — sem policy de update/delete.

-- ---------------------------------------------------------------------------
-- Taxonomia nova em operational_events (Etapa 56) — estende as constraints
-- já existentes em vez de criar uma tabela paralela de eventos.
-- ---------------------------------------------------------------------------
alter table operational_events drop constraint if exists operational_events_event_type_check;
alter table operational_events add constraint operational_events_event_type_check check (event_type in (
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
  'monthly_report_reopened',
  'account_review_recorded', 'account_review_no_change', 'account_review_optimization_performed',
  'account_review_issue_identified', 'account_optimization_recorded'
));

alter table operational_events drop constraint if exists operational_events_entity_type_check;
alter table operational_events add constraint operational_events_entity_type_check check (entity_type in (
  'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report',
  'account_review', 'account_optimization'
));

-- ---------------------------------------------------------------------------
-- record_account_review: única operação que registra uma análise — grava
-- account_reviews + account_optimizations (uma por item) + tarefa opcional
-- da pendência + todos os operational_events correspondentes, numa única
-- transação (seção 16). p_optimizations é um jsonb array de objetos
-- {type, action, description, reason, expected_impact}.
-- ---------------------------------------------------------------------------
create or replace function record_account_review(
  p_client_id uuid,
  p_team_member_id uuid,
  p_auth_user_id uuid,
  p_reason text,
  p_reason_other_description text,
  p_outcome text,
  p_notes text,
  p_issue_description text,
  p_issue_category text,
  p_optimizations jsonb,
  p_create_task boolean,
  p_task_responsible_id uuid,
  p_task_due_date date,
  p_source text default 'web'
) returns jsonb as $$
declare
  v_now timestamptz := now();
  v_reviewed_date date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_org_id uuid;
  v_client_manager_id uuid;
  v_sprint record;
  v_sprint_count int;
  v_review_id uuid;
  v_previous_review_at timestamptz;
  v_seconds_since integer;
  v_correlation_id uuid := gen_random_uuid();
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_type text;
  v_prev_same_type_at timestamptz;
  v_optimization_count int := coalesce(jsonb_array_length(p_optimizations), 0);
  v_optimization_types jsonb;
  v_task_id uuid := null;
begin
  select organization_id into v_org_id from team_members where id = p_team_member_id;
  if v_org_id is null then
    raise exception 'Membro da equipe não encontrado.';
  end if;

  -- Vínculo automático e obrigatório com a sprint (seção 20) — exatamente
  -- uma sprint deve cobrir a data de hoje no fuso operacional; nunca salva
  -- silenciosamente se encontrar zero ou mais de uma.
  select count(*) into v_sprint_count
    from sprints
    where client_id = p_client_id and start_date <= v_reviewed_date and end_date >= v_reviewed_date;

  if v_sprint_count = 0 then
    raise exception 'Nenhuma sprint encontrada para a data de hoje — não é possível registrar a análise.';
  elsif v_sprint_count > 1 then
    raise exception 'Mais de uma sprint encontrada para a data de hoje — problema técnico, análise não registrada.';
  end if;

  select id, start_date, end_date into v_sprint
    from sprints
    where client_id = p_client_id and start_date <= v_reviewed_date and end_date >= v_reviewed_date;

  if p_outcome = 'NO_CHANGE' and v_optimization_count > 0 then
    raise exception 'Resultado "Sem alteração necessária" não pode ter otimizações.';
  end if;
  if p_outcome = 'OPTIMIZATION_PERFORMED' and v_optimization_count = 0 then
    raise exception 'Resultado "Otimização realizada" exige pelo menos uma otimização.';
  end if;
  if p_outcome = 'ISSUE_IDENTIFIED' and (p_issue_description is null or length(trim(p_issue_description)) = 0) then
    raise exception 'Descrição do problema é obrigatória.';
  end if;

  select primary_manager_id into v_client_manager_id from clients where id = p_client_id;

  select reviewed_at into v_previous_review_at
    from account_reviews
    where client_id = p_client_id
    order by reviewed_at desc
    limit 1;

  v_seconds_since := case
    when v_previous_review_at is null then null
    else greatest(0, extract(epoch from (v_now - v_previous_review_at)))::int
  end;

  insert into account_reviews (
    organization_id, client_id, sprint_id, team_member_id, performed_by_auth_user_id,
    reviewed_at, reason, reason_other_description, outcome, notes,
    issue_description, issue_category, previous_review_at, seconds_since_previous_review
  ) values (
    v_org_id, p_client_id, v_sprint.id, p_team_member_id, p_auth_user_id,
    v_now, p_reason, p_reason_other_description, p_outcome, p_notes,
    p_issue_description, p_issue_category, v_previous_review_at, v_seconds_since
  )
  returning id into v_review_id;

  -- Tarefa opcional a partir da pendência (seção 14) — só quando o gestor
  -- decide explicitamente; nunca automática.
  if p_outcome = 'ISSUE_IDENTIFIED' and p_create_task then
    insert into tasks (client_id, title, type, assignee_id, due_date, sprint_id, status, recurrence, notes)
    values (
      p_client_id,
      left('Pendência: ' || p_issue_description, 200),
      'outro',
      p_task_responsible_id,
      coalesce(p_task_due_date, v_sprint.end_date),
      v_sprint.id,
      'pendente',
      'nenhuma',
      p_issue_description
    )
    returning id into v_task_id;

    update account_reviews set issue_task_id = v_task_id where id = v_review_id;

    insert into operational_events (
      organization_id, event_type, actor_team_member_id, actor_auth_user_id,
      client_id, sprint_id, entity_type, entity_id, occurred_at, source, correlation_id, metadata
    ) values (
      v_org_id, 'task_created', p_team_member_id, p_auth_user_id,
      p_client_id, v_sprint.id, 'task', v_task_id, v_now, p_source, v_correlation_id,
      jsonb_build_object(
        'task_type', 'outro', 'task_title', left('Pendência: ' || p_issue_description, 200),
        'due_date', coalesce(p_task_due_date, v_sprint.end_date),
        'assignee_team_member_id', p_task_responsible_id, 'origin', 'account_review_issue',
        'account_review_id', v_review_id
      )
    );
  end if;

  v_optimization_types := '[]'::jsonb;

  if v_optimization_count > 0 then
    for v_opt in select * from jsonb_array_elements(p_optimizations)
    loop
      v_opt_type := v_opt ->> 'type';

      insert into account_optimizations (
        organization_id, account_review_id, client_id, sprint_id,
        optimization_type, optimization_action, description, reason, expected_impact
      ) values (
        v_org_id, v_review_id, p_client_id, v_sprint.id,
        v_opt_type, v_opt ->> 'action', v_opt ->> 'description', v_opt ->> 'reason', v_opt ->> 'expected_impact'
      )
      returning id into v_opt_id;

      v_optimization_types := v_optimization_types || to_jsonb(v_opt_type);

      select created_at into v_prev_same_type_at
        from account_optimizations
        where client_id = p_client_id and optimization_type = v_opt_type and id <> v_opt_id
        order by created_at desc
        limit 1;

      insert into operational_events (
        organization_id, event_type, actor_team_member_id, actor_auth_user_id,
        client_id, sprint_id, entity_type, entity_id, occurred_at, source, correlation_id, metadata
      ) values (
        v_org_id, 'account_optimization_recorded', p_team_member_id, p_auth_user_id,
        p_client_id, v_sprint.id, 'account_optimization', v_opt_id, v_now, p_source, v_correlation_id,
        jsonb_build_object(
          'optimization_type', v_opt_type,
          'optimization_action', v_opt ->> 'action',
          'account_review_id', v_review_id,
          'client_manager_id', v_client_manager_id,
          'previous_same_type_optimization_at', v_prev_same_type_at,
          'seconds_since_previous_same_type_optimization',
            case when v_prev_same_type_at is null then null
              else greatest(0, extract(epoch from (v_now - v_prev_same_type_at)))::int end,
          'description_present', (v_opt ->> 'description') is not null and length(trim(v_opt ->> 'description')) > 0,
          'reason_present', (v_opt ->> 'reason') is not null and length(trim(v_opt ->> 'reason')) > 0,
          'expected_impact_present', (v_opt ->> 'expected_impact') is not null and length(trim(v_opt ->> 'expected_impact')) > 0
        )
      );
    end loop;
  end if;

  insert into operational_events (
    organization_id, event_type, actor_team_member_id, actor_auth_user_id,
    client_id, sprint_id, entity_type, entity_id, occurred_at, source, correlation_id, metadata
  ) values (
    v_org_id, 'account_review_recorded', p_team_member_id, p_auth_user_id,
    p_client_id, v_sprint.id, 'account_review', v_review_id, v_now, p_source, v_correlation_id,
    jsonb_build_object(
      'reason', p_reason, 'outcome', p_outcome,
      'previous_review_at', v_previous_review_at, 'seconds_since_previous_review', v_seconds_since,
      'client_manager_id', v_client_manager_id,
      'sprint_start_date', v_sprint.start_date, 'sprint_end_date', v_sprint.end_date,
      'optimization_count', v_optimization_count, 'optimization_types', v_optimization_types,
      'issue_created_task', v_task_id is not null
    )
  );

  insert into operational_events (
    organization_id, event_type, actor_team_member_id, actor_auth_user_id,
    client_id, sprint_id, entity_type, entity_id, occurred_at, source, correlation_id, metadata
  ) values (
    v_org_id,
    case p_outcome
      when 'NO_CHANGE' then 'account_review_no_change'
      when 'OPTIMIZATION_PERFORMED' then 'account_review_optimization_performed'
      when 'ISSUE_IDENTIFIED' then 'account_review_issue_identified'
    end,
    p_team_member_id, p_auth_user_id,
    p_client_id, v_sprint.id, 'account_review', v_review_id, v_now, p_source, v_correlation_id,
    jsonb_build_object('optimization_count', v_optimization_count, 'issue_created_task', v_task_id is not null)
  );

  return jsonb_build_object('reviewId', v_review_id, 'sprintId', v_sprint.id, 'taskId', v_task_id);
end;
$$ language plpgsql;
