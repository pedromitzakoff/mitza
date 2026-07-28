-- Refatoração do registro de otimizações: cada seleção (ex.: "Campanhas →
-- Pausei") passa a carregar quantas vezes aquela ação foi realizada na
-- mesma execução (ex.: pausou 2 campanhas), em vez de exigir uma linha
-- repetida por unidade. Aditivo — `quantity` sempre 1 pra linhas já
-- existentes (comportamento idêntico ao de hoje, uma unidade por linha).
--
-- Rode depois de supabase/account-reviews.sql.

alter table account_optimizations add column if not exists quantity int not null default 1;
alter table account_optimizations drop constraint if exists account_optimizations_quantity_check;
alter table account_optimizations add constraint account_optimizations_quantity_check check (quantity > 0);

-- ---------------------------------------------------------------------------
-- record_account_review (redefinida): único ponto de escrita de
-- account_optimizations — único trecho alterado é o insert, que agora lê
-- `quantity` de cada elemento de `p_optimizations` (chave opcional, default
-- 1 quando ausente — mantém compatível com qualquer chamador que ainda não
-- manda a chave). Todo o resto da função é idêntico ao original (ver
-- supabase/account-reviews.sql).
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
  v_opt_quantity int;
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
      v_opt_quantity := coalesce((v_opt ->> 'quantity')::int, 1);

      insert into account_optimizations (
        organization_id, account_review_id, client_id, sprint_id,
        optimization_type, optimization_action, description, reason, expected_impact, quantity
      ) values (
        v_org_id, v_review_id, p_client_id, v_sprint.id,
        v_opt_type, v_opt ->> 'action', v_opt ->> 'description', v_opt ->> 'reason', v_opt ->> 'expected_impact', v_opt_quantity
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
          'quantity', v_opt_quantity,
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
