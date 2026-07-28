-- Refatoração do registro de otimizações: o checklist genérico de 7
-- categorias (Público/Criativo/Campanha/Orçamento/Posicionamento/Conversão/
-- Remarketing, cada uma sempre gravada com optimization_action='OTHER')
-- deixa de ser como o gestor registra a Otimização. No lugar, o drawer
-- passa a oferecer 4 grupos com ações específicas (Campanhas/Públicos/
-- Criativos/Orçamento — ver `OPTIMIZATION_QUICK_GROUPS`,
-- src/lib/recurring-tasks.ts), cada uma com sua ação real (ex.: Pausei,
-- Ativei, Aumentei) e uma quantidade opcional (quantas vezes aquela ação
-- foi feita nesta execução). O gestor pensa em decisões tomadas, não em
-- categorias tocadas.
--
-- `p_checklist_selected_keys` continua existindo pra qualquer recorrência
-- futura com checklist genérico (uses_account_review=false) — inalterado.
-- A única mudança é: quando uses_account_review=true, os `account_
-- optimizations` nascem de `p_optimization_selections` (type+action+quantity
-- reais), não mais do checklist genérico com action fixo.
--
-- Rode depois de supabase/account-optimization-quantity.sql (que já
-- adiciona `quantity` a account_optimizations e atualiza
-- record_account_review pra gravá-la).

alter table recurring_task_executions add column if not exists optimization_selections jsonb;

create or replace function register_recurring_execution(
  p_recurring_task_id uuid,
  p_client_id uuid,
  p_team_member_id uuid,
  p_auth_user_id uuid,
  p_notes text,
  p_checklist_selected_keys text[] default null,
  p_optimization_selections jsonb default null,
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
    account_review_id, checklist_selected_keys, optimization_selections, notes
  ) values (
    p_recurring_task_id, p_client_id, v_sprint_id, p_team_member_id, p_auth_user_id,
    v_review_id,
    case when v_uses_account_review then null else p_checklist_selected_keys end,
    case when v_uses_account_review then p_optimization_selections else null end,
    case when v_uses_account_review then null else p_notes end
  )
  returning id into v_execution_id;

  return jsonb_build_object('executionId', v_execution_id, 'sprintId', v_sprint_id, 'accountReviewId', v_review_id);
end;
$$ language plpgsql;
