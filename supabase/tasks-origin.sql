-- Etapa "Pendências — Correção de Origem" — substitui `template_id is null`
-- como sinal de "isto é uma demanda manual". Não era confiável: uma
-- migration antiga (Etapa 12, `global-sprint-task-templates.sql`) rodou
--
--   update tasks set template_id = null where template_id is not null;
--
-- ao trocar do modelo de template por cliente (`client_task_templates`) pro
-- modelo global atual (`sprint_task_templates`) — zerando `template_id` em
-- TODAS as tarefas já geradas até aquele momento. Resultado: ~124 tarefas
-- de rotina antigas (Checar saldo/Otimização/Report, geradas
-- automaticamente antes daquela troca) ficaram com `template_id` nulo,
-- indistinguíveis de demanda manual por esse campo — auditoria confirmada
-- em produção (208 tarefas com `template_id is null`: 124 com
-- type in ('otimizacao','verificacao_saldo','report') — rotina legada — e
-- 9 com outros types — demanda manual real, títulos conferidos um a um:
-- "Subir criativos novos", "Subir campanha x", "Revisão: Subir novas
-- cidades da região" etc.).
--
-- `origin` corrige isso na raiz: é gravado EXPLICITAMENTE no momento da
-- criação por cada um dos 5 caminhos que inserem em `tasks` (3 em
-- TypeScript, já atualizados: performCreateTask, a próxima ocorrência de
-- recorrência leve em completeTaskAction, sendActionItemToSprintAction; 2
-- em SQL, redefinidos nesta migration: generate_sprint_tasks_from_templates
-- e record_account_review) — nunca inferido depois, nunca recalculado por
-- uma migration futura. `template_id` continua existindo e continua
-- correto pra sua finalidade original (link de identidade pro template),
-- só deixa de ser usado como sinal de "é demanda".
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste
-- projeto que altera schema já em produção. Esta em especial CLASSIFICA
-- dado histórico (o UPDATE de backfill abaixo) — revisar com atenção antes
-- de rodar; nenhum dado é apagado ou tem due_date/título/comentário
-- alterado, só a coluna nova `origin` é preenchida.
--
-- Como desfazer: `alter table tasks drop column origin;` — reversível a
-- qualquer momento, sem perda de dado (nenhuma outra coluna é tocada).

-- ---------------------------------------------------------------------------
-- 1) Coluna nova, ainda sem valor/constraint (seguro rodar isolado a
-- qualquer momento — só cria uma coluna vazia).
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists origin text;

-- ---------------------------------------------------------------------------
-- 2) Backfill do histórico (Opção A, aprovada após auditoria com números
-- reais de produção — ver acima). Critério, em ordem:
--   a) template_id já preenchido -> 'template' (sabemos com certeza: só o
--      gerador de Modelo de Tarefa de Sprint grava esse campo hoje).
--   b) template_id nulo + type em ('otimizacao','verificacao_saldo',
--      'report') -> 'template' (heurística estrutural, não por título: são
--      os ÚNICOS 3 types que `seed_default_client_task_templates`/
--      `generate_sprint_tasks_from_templates` já geraram — confirmado
--      auditando as 2 únicas funções SQL que sempre geraram tarefa
--      automática; toda criação manual, em qualquer tela, usa 'outro').
--   c) tudo o mais -> 'manual' (demanda real).
-- ---------------------------------------------------------------------------
update tasks set origin = case
  when template_id is not null then 'template'
  when type in ('otimizacao', 'verificacao_saldo', 'report') then 'template'
  else 'manual'
end
where origin is null;

-- ---------------------------------------------------------------------------
-- 3) Trava a coluna: obrigatória, default 'manual' (qualquer insert futuro
-- que por algum motivo esqueça de informar cai no lado seguro — nunca
-- aparece como rotina por omissão), valores fechados.
-- ---------------------------------------------------------------------------
alter table tasks alter column origin set default 'manual';
alter table tasks alter column origin set not null;

alter table tasks drop constraint if exists tasks_origin_check;
alter table tasks add constraint tasks_origin_check check (origin in ('manual', 'template'));

comment on column tasks.origin is
  'Etapa "Pendências — Correção de Origem": explícito, gravado na criação, nunca inferido depois. "template" = gerado por sprint_task_templates (generate_sprint_tasks_from_templates); "manual" = qualquer ato humano (formulário, quick-create de Pendências, tarefa opcional de Revisão de Conta, "Enviar para próxima sprint" do Relatório, próxima ocorrência de recorrência leve). Única fonte da regra "isto aparece em /pendencias" (nunca template_id, que já foi zerado em massa uma vez por outra migration).';

-- ---------------------------------------------------------------------------
-- 4) generate_sprint_tasks_from_templates (redefinida): corpo idêntico ao
-- vigente (supabase/fix-tasks-original-due-date.sql, a versão mais
-- recente), só acrescentando origin='template' ao insert.
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
    select gs.d into match_date
    from generate_series(p_start_date, p_end_date, interval '1 day') as gs(d)
    where extract(isodow from gs.d) = tpl.weekday
    limit 1;

    if match_date is not null then
      insert into tasks (
        client_id, title, type, assignee_id, due_date, original_due_date,
        sprint_id, template_id, origin, status, recurrence
      )
      values (
        p_client_id, tpl.title, tpl.type, tpl.default_assignee_id, match_date, match_date,
        p_sprint_id, tpl.id, 'template', 'pendente', 'nenhuma'
      )
      on conflict (template_id, sprint_id) where template_id is not null do nothing;
    else
      raise notice 'generate_sprint_tasks_from_templates: template % (weekday %) sem dia correspondente na sprint % (% a %) — tarefa não gerada',
        tpl.id, tpl.weekday, p_sprint_id, p_start_date, p_end_date;
    end if;
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 5) record_account_review (redefinida): corpo idêntico ao vigente
-- (supabase/account-review-diagnosis.sql, a versão mais recente), só
-- acrescentando origin='manual' ao insert da tarefa opcional (gestor
-- decide explicitamente via "Criar tarefa a partir desta revisão" —
-- nunca automática).
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
  if p_create_task and (p_issue_description is null or length(trim(p_issue_description)) = 0) then
    raise exception 'Contexto da tarefa é obrigatório.';
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

  if p_create_task then
    v_task_due_date := coalesce(p_task_due_date, v_sprint.end_date);

    insert into tasks (
      client_id, title, type, assignee_id, due_date, original_due_date,
      sprint_id, status, recurrence, notes, origin
    )
    values (
      p_client_id,
      left('Revisão: ' || p_issue_description, 200),
      'outro',
      p_task_responsible_id,
      v_task_due_date,
      v_task_due_date,
      v_sprint.id,
      'pendente',
      'nenhuma',
      p_issue_description,
      'manual'
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
        'task_type', 'outro', 'task_title', left('Revisão: ' || p_issue_description, 200),
        'due_date', v_task_due_date,
        'assignee_team_member_id', p_task_responsible_id, 'origin', 'account_review_follow_up',
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
