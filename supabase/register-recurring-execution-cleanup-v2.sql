-- Reafirmação idempotente da limpeza de `register_recurring_execution` —
-- Bug crítico "não é possível registrar uma otimização" (05/08). Não temos
-- acesso ao Supabase de produção nesta sessão pra confirmar se a migration
-- anterior (supabase/register-recurring-execution-cleanup.sql, 29/07) foi
-- de fato executada, então esta migration é escrita pra ser segura de rodar
-- TANTO se a de 29/07 já rodou (vira um no-op) QUANTO se nunca rodou (aí ela
-- sozinha resolve o problema).
--
-- ---------------------------------------------------------------------------
-- Por que `create or replace function` sozinho NUNCA resolve um overload
-- ---------------------------------------------------------------------------
-- No Postgres, a IDENTIDADE de uma função é (nome, lista ordenada de TIPOS de
-- parâmetro) — nunca os nomes dos parâmetros, nunca os valores default.
-- `create or replace function` só substitui uma função already existente
-- quando essa identidade é EXATAMENTE igual à que já existe no banco. Se a
-- lista de tipos mudar (por exemplo, um parâmetro novo foi acrescentado),
-- não existe mais uma função com aquela identidade antiga pra substituir —
-- o Postgres simplesmente CRIA uma segunda função com o mesmo nome (um
-- "overload"), e as duas passam a coexistir.
--
-- `register_recurring_execution` foi redefinida 3 vezes ao longo do
-- projeto, cada vez ACRESCENTANDO um parâmetro nunca substituindo a anterior:
--   1. supabase/recurring-tasks.sql                       (7 parâmetros)
--   2. supabase/recurring-task-optimization-refactor.sql  (8 parâmetros — +p_optimization_selections)
--   3. supabase/client-reports.sql                        (9 parâmetros — +p_client_report_id, a versão vigente)
--
-- Qualquer chamada que omita um parâmetro com default (ex.:
-- `p_client_report_id`, sempre opcional) passa a ter mais de uma função
-- candidata válida — a antiga (que nem tem esse parâmetro) e a atual (que
-- tem, com default null) — e o Postgres não consegue decidir sozinho: é aí
-- que aparece o erro "Não foi possível escolher a melhor função candidata
-- entre public.register_recurring_execution(...) / public.
-- register_recurring_execution(...)".
--
-- A única forma de corrigir isso é remover explicitamente as assinaturas
-- obsoletas por `drop function` com a lista de TIPOS completa (não pelo
-- nome dos parâmetros — é assim que o Postgres diferencia overloads),
-- deixando só a assinatura final coexistindo.
-- ---------------------------------------------------------------------------

-- 1) Remove explicitamente as duas assinaturas obsoletas conhecidas (7 e 8
-- parâmetros) — `if exists` faz isso ser seguro mesmo que elas já tenham
-- sido removidas pela migration de 29/07, ou nunca tenham existido no banco
-- que está rodando isso.
drop function if exists register_recurring_execution(
  uuid, uuid, uuid, uuid, text, text[], text
);

drop function if exists register_recurring_execution(
  uuid, uuid, uuid, uuid, text, text[], jsonb, text
);

-- 2) Recria a versão final de 9 parâmetros — corpo idêntico ao de
-- supabase/client-reports.sql (nenhuma mudança de comportamento, nenhum
-- dado histórico apagado: isto só afeta a definição da função, nunca as
-- tabelas). Reafirma a função final mesmo que o passo 1 acima não tenha
-- encontrado nada pra remover — garante que, independente do estado atual
-- do banco, só existe UMA `register_recurring_execution` depois de rodar
-- este arquivo.
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

-- 3) Checagem de diagnóstico (comentada — descomente e rode manualmente se
-- quiser confirmar o resultado depois de aplicar esta migration): deve
-- retornar exatamente UMA linha, com 9 argumentos.
--
-- select
--   n.nspname as schema_name,
--   p.proname as function_name,
--   pg_get_function_identity_arguments(p.oid) as arguments
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname = 'register_recurring_execution';
