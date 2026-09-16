-- Etapa "Histórico de Decisões Operacionais": adiciona DIAGNÓSTICO como
-- dimensão nova em account_reviews — "o que o gestor encontrou", ortogonal a
-- reason ("por que revisou") e outcome ("o que resultou da revisão").
--
-- Deliberadamente NUNCA lida por saúde/prioridade (lib/account-health-engine.ts,
-- lib/attention-alerts.ts) — nenhum dos dois é tocado por esta migration nem
-- por qualquer código desta etapa. Diagnóstico é percepção MANUAL do gestor,
-- nunca se mistura com a classificação AUTOMÁTICA de CPA/CPL já existente.
--
-- Nullable de propósito: histórico de account_reviews anterior a esta etapa
-- nunca teve diagnóstico — nenhum backfill fabricado, sem migration
-- destrutiva. Eventos antigos continuam existindo e renderizando (a
-- apresentação cai pro outcome/optimizations de sempre quando diagnosis é
-- null).
--
-- Rode depois de supabase/recurring-task-optimization-refactor.sql.

alter table account_reviews add column if not exists diagnosis text;

alter table account_reviews drop constraint if exists account_reviews_diagnosis_check;
alter table account_reviews add constraint account_reviews_diagnosis_check check (
  diagnosis is null or diagnosis in (
    'HEALTHY', 'COST_ABOVE_TARGET', 'COST_BELOW_TARGET', 'LOW_VOLUME',
    'BUDGET_LIMITED', 'CREATIVE_FATIGUE', 'AUDIENCE_FATIGUE',
    'CAMPAIGN_UNDERPERFORMING', 'INSUFFICIENT_DATA'
  )
);

create index if not exists account_reviews_diagnosis_idx
  on account_reviews (diagnosis) where diagnosis is not null;

-- ---------------------------------------------------------------------------
-- ATENÇÃO — identidade de função no Postgres (mesmo problema já documentado
-- em supabase/register-recurring-execution-cleanup-v2.sql): a identidade de
-- uma função é (nome, lista ORDENADA DE TIPOS), nunca os nomes dos
-- parâmetros. Acrescentar um parâmetro novo muda a lista de tipos, então
-- `create or replace function` sozinho NÃO substitui a versão antiga — ele
-- cria um SEGUNDO overload coexistindo com o antigo (14 parâmetros), e
-- qualquer chamada nomeada que omita `p_diagnosis` (todo chamador anterior a
-- esta etapa) passa a ter duas funções candidatas, erro "não foi possível
-- escolher a melhor função candidata". Por isso o `drop function if exists`
-- explícito abaixo, pela lista de TIPOS exata da versão anterior (idêntica
-- desde supabase/account-reviews.sql — supabase/account-optimization-quantity.sql
-- só trocou o corpo, nunca a assinatura) — só depois disso o `create or
-- replace` cria a versão de 15 parâmetros como a única existente.
-- ---------------------------------------------------------------------------
drop function if exists record_account_review(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb, boolean, uuid, date, text
);

-- record_account_review (redefinida): único trecho alterado é o novo
-- parâmetro opcional p_diagnosis (default null — compatível com qualquer
-- chamador existente que não o envie, ex.: histórico de chamadas já feitas
-- por register_recurring_execution antes desta etapa). Grava a coluna nova
-- e inclui `diagnosis` E `notes` no metadata do próprio account_review_recorded
-- (notes já existia na tabela, só nunca tinha ido pro metadata) — pra
-- Timeline Geral (lib/agency-timeline.ts) montar Diagnóstico + Ações +
-- Observação sem segunda consulta, mesmo padrão já usado pros outros campos
-- (reason/outcome/optimization_types). Todo o resto é idêntico ao já
-- redefinido em supabase/account-optimization-quantity.sql.
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
  p_source text default 'web',
  p_diagnosis text default null
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
    issue_description, issue_category, previous_review_at, seconds_since_previous_review, diagnosis
  ) values (
    v_org_id, p_client_id, v_sprint.id, p_team_member_id, p_auth_user_id,
    v_now, p_reason, p_reason_other_description, p_outcome, p_notes,
    p_issue_description, p_issue_category, v_previous_review_at, v_seconds_since, p_diagnosis
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
      'reason', p_reason, 'outcome', p_outcome, 'diagnosis', p_diagnosis, 'notes', p_notes,
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
-- register_recurring_execution — mesmo problema de identidade explicado
-- acima, agora pra esta função. A versão vigente (confirmada em
-- supabase/register-recurring-execution-cleanup-v2.sql, a mais recente que
-- redefine esta função) tem 9 parâmetros, nesta ordem de tipos exata: uuid,
-- uuid, uuid, uuid, text, text[], jsonb, uuid, text (p_client_report_id vem
-- ANTES de p_source, não depois — conferir sempre a migration mais recente,
-- nunca uma anterior, antes de redefinir esta função). Remove essa
-- assinatura e, defensivamente, as duas anteriores (7 e 8 parâmetros, já
-- historicamente removidas por register-recurring-execution-cleanup-v2.sql,
-- mas repetir o `drop if exists` aqui é inofensivo e protege contra rodar
-- esta migration num banco que nunca aplicou aquela).
-- ---------------------------------------------------------------------------
drop function if exists register_recurring_execution(uuid, uuid, uuid, uuid, text, text[], text);
drop function if exists register_recurring_execution(uuid, uuid, uuid, uuid, text, text[], jsonb, text);
drop function if exists register_recurring_execution(uuid, uuid, uuid, uuid, text, text[], jsonb, uuid, text);

-- register_recurring_execution (redefinida): corpo idêntico ao vigente
-- (register-recurring-execution-cleanup-v2.sql), só com o novo parâmetro
-- opcional p_diagnosis (default null) no final — repassado pra
-- record_account_review só quando uses_account_review=true, mesmo espírito
-- de p_optimization_selections.
create or replace function register_recurring_execution(
  p_recurring_task_id uuid,
  p_client_id uuid,
  p_team_member_id uuid,
  p_auth_user_id uuid,
  p_notes text,
  p_checklist_selected_keys text[] default null,
  p_optimization_selections jsonb default null,
  p_client_report_id uuid default null,
  p_source text default 'web',
  p_diagnosis text default null
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
      p_source => p_source,
      p_diagnosis => p_diagnosis
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
