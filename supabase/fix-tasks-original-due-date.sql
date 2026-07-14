-- Correção: "null value in column original_due_date of relation tasks
-- violates not-null constraint" ao criar cliente.
--
-- CAUSA RAIZ: `operational-events.sql` adicionou `tasks.original_due_date`
-- como NOT NULL (sem default), mas duas funções SQL que inserem em `tasks`
-- nunca foram atualizadas para preencher essa coluna:
--
--   1. `generate_sprint_tasks_from_templates` — gera as tarefas padrão de
--      cada sprint nova. É chamada por `ensure_client_sprints`, que por sua
--      vez é chamada pelo trigger `clients_create_initial_sprints` (AFTER
--      INSERT ON clients — ver schema.sql/sprint-calendar-reconciliation.sql).
--      Como o trigger roda DENTRO da mesma transação do INSERT em `clients`,
--      a violação de NOT NULL aqui reverte a criação do cliente inteira —
--      é exatamente o erro relatado.
--   2. `record_account_review` — cria uma tarefa opcional a partir de uma
--      "Análise da Conta" com problema identificado (`p_create_task`).
--      Mesmo bug, caminho diferente (não bloqueia criação de cliente, mas
--      quebraria "Registrar análise" da mesma forma).
--
-- Nenhuma tabela/coluna/constraint é alterada aqui — só as duas funções
-- (create or replace, idempotente) passam a preencher
-- `original_due_date = due_date` no momento da criação, exatamente como o
-- código da aplicação já faz (ver src/lib/task-creation.ts).

-- ---------------------------------------------------------------------------
-- 1) generate_sprint_tasks_from_templates
-- ---------------------------------------------------------------------------
create or replace function generate_sprint_tasks_from_templates(
  p_client_id uuid,
  p_sprint_id uuid,
  p_start_date date,
  p_end_date date
) returns void as $$
declare
  tpl record;
  match_date date;
begin
  for tpl in
    select t.id, t.title, t.type, t.default_assignee_id, t.weekday
    from sprint_task_templates t
    where t.is_active = true
      and (
        t.applies_to_all
        or exists (
          select 1 from sprint_task_template_clients stc
          where stc.template_id = t.id and stc.client_id = p_client_id
        )
      )
  loop
    -- Nunca cria tarefa fora dos limites da sprint: `generate_series` só
    -- percorre datas entre p_start_date e p_end_date (inclusive); se a
    -- sprint for parcial e não contiver o dia da semana configurado,
    -- `match_date` continua null e a tarefa simplesmente não é gerada (não
    -- é um erro — é a regra "sprint parcial sem o dia configurado").
    select gs.d into match_date
    from generate_series(p_start_date, p_end_date, interval '1 day') as gs(d)
    where extract(isodow from gs.d) = tpl.weekday
    limit 1;

    if match_date is not null then
      insert into tasks (
        client_id, title, type, assignee_id, due_date, original_due_date,
        sprint_id, template_id, status, recurrence
      )
      values (
        p_client_id, tpl.title, tpl.type, tpl.default_assignee_id, match_date, match_date,
        p_sprint_id, tpl.id, 'pendente', 'nenhuma'
      )
      on conflict (template_id, sprint_id) where template_id is not null do nothing;
    else
      -- Regra já vigente (Etapa 12): sprint parcial sem o dia da semana
      -- configurado nunca gera a tarefa — nunca um insert com due_date/
      -- original_due_date nulos. Log explícito (nunca falha a transação)
      -- pra ficar observável, sem mudar o comportamento estabelecido.
      raise notice 'generate_sprint_tasks_from_templates: template % (weekday %) sem dia correspondente na sprint % (% a %) — tarefa não gerada',
        tpl.id, tpl.weekday, p_sprint_id, p_start_date, p_end_date;
    end if;
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 2) record_account_review — mesma correção na tarefa opcional de pendência.
-- Corpo idêntico ao de account-reviews.sql, só com original_due_date
-- adicionado ao insert em tasks.
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
  v_task_due_date date;
begin
  select organization_id into v_org_id from team_members where id = p_team_member_id;
  if v_org_id is null then
    raise exception 'Membro da equipe não encontrado.';
  end if;

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

  if p_outcome = 'ISSUE_IDENTIFIED' and p_create_task then
    v_task_due_date := coalesce(p_task_due_date, v_sprint.end_date);

    insert into tasks (
      client_id, title, type, assignee_id, due_date, original_due_date,
      sprint_id, status, recurrence, notes
    )
    values (
      p_client_id,
      left('Pendência: ' || p_issue_description, 200),
      'outro',
      p_task_responsible_id,
      v_task_due_date,
      v_task_due_date,
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
        'due_date', v_task_due_date,
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

-- ---------------------------------------------------------------------------
-- 3) Backfill defensivo — na prática deve afetar 0 linhas, porque a coluna
-- já é NOT NULL desde operational-events.sql (nenhum insert que a omitisse
-- poderia ter sido gravado depois disso; é exatamente esse bloqueio que
-- gerou o erro relatado). Mantido só por segurança/idempotência, seguindo
-- explicitamente o pedido de nunca inventar uma data quando ambas
-- (`original_due_date`/`due_date`) estiverem nulas — aqui `due_date` nunca é
-- nulo (é NOT NULL desde o schema original), então a condição abaixo só
-- preenche quando há uma data real disponível.
-- ---------------------------------------------------------------------------
update tasks set original_due_date = due_date where original_due_date is null and due_date is not null;
