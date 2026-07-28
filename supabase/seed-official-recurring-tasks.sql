-- Seed das 3 recorrências oficiais da reforma do sistema de tarefas (28/07):
-- Checar saldo, Reportar cliente, Otimização. Todas aplicam a "todos os
-- clientes" (atuais e futuros) — decisão do usuário. Metas semanais também
-- definidas em conversa: Checar saldo 2x/semana, Reportar cliente 1x/semana,
-- Otimização 3x/semana.
--
-- "Otimização" é a única com uses_account_review=true (integração de
-- backend real com account_reviews/account_optimizations, ver Etapa 57 e
-- supabase/recurring-tasks.sql) — por isso não nasce pelo formulário de
-- /settings/recurring-tasks, que esconde essa flag de propósito. As outras
-- duas estão aqui só por conveniência: dá pra cadastrar pela interface
-- também, se preferir, em vez de rodar este arquivo.
--
-- Cadência operacional (revisão posterior, ver supabase/recurring-task-
-- cadence.sql): Checar saldo — segunda e quinta; Reportar cliente — terça;
-- Otimização — automática (depende do comportamento da conta, não de
-- calendário). Não é configurável pelo admin, mesmo espírito de
-- `uses_account_review` — método operacional da agência, não preferência
-- de UI.
--
-- Idempotente (checa por título antes de inserir) — seguro rodar mais de
-- uma vez. Rode depois de supabase/recurring-tasks.sql e
-- supabase/recurring-task-cadence.sql (que adiciona as colunas de cadência
-- usadas aqui), e ANTES do Passo 3 de
-- supabase/cleanup-legacy-recurring-tasks.sql, pra nunca haver uma janela
-- em que o modelo antigo já parou de gerar e o novo ainda não existe
-- (decisão do usuário, 28/07).

do $$
declare
  v_checar_saldo_id uuid;
  v_report_id uuid;
  v_otimizacao_id uuid;
begin
  -- Checar saldo — 2x por semana, sem checklist. Cadência fixa: segunda e
  -- quinta (garante que a conta começou bem a semana e evita problema perto
  -- do fim de semana).
  if not exists (select 1 from recurring_tasks where title = 'Checar saldo') then
    insert into recurring_tasks (title, icon, color, applies_to_all, is_active, has_checklist, uses_account_review, cadence_mode, fixed_weekdays)
    values ('Checar saldo', '💰', '#4169E1', true, true, false, false, 'fixed_days', array[1, 4]::smallint[])
    returning id into v_checar_saldo_id;

    insert into recurring_task_goal_history (recurring_task_id, weekly_goal) values (v_checar_saldo_id, 2);
  end if;

  -- Reportar cliente — 1x por semana, sem checklist. Cadência fixa: terça
  -- (segunda é dia operacional; terça já dá tempo de analisar a conta antes
  -- de reportar e ainda sobra semana pra agir sobre o feedback do cliente).
  if not exists (select 1 from recurring_tasks where title = 'Reportar cliente') then
    insert into recurring_tasks (title, icon, color, applies_to_all, is_active, has_checklist, uses_account_review, cadence_mode, fixed_weekdays)
    values ('Reportar cliente', '📊', '#4169E1', true, true, false, false, 'fixed_days', array[2]::smallint[])
    returning id into v_report_id;

    insert into recurring_task_goal_history (recurring_task_id, weekly_goal) values (v_report_id, 1);
  end if;

  -- Otimização — 3x por semana. has_checklist + uses_account_review=true:
  -- "registrar execução" cria um account_review (reason='ROUTINE') por
  -- baixo, e cada item marcado vira uma linha em account_optimizations —
  -- por isso item_key abaixo precisa bater exatamente com os valores de
  -- account_optimizations.optimization_type (uppercase, ver constraint em
  -- supabase/recurring-tasks.sql), não é um slug livre como numa recorrência
  -- comum.
  if not exists (select 1 from recurring_tasks where title = 'Otimização') then
    insert into recurring_tasks (title, icon, color, applies_to_all, is_active, has_checklist, uses_account_review)
    values ('Otimização', '🎯', '#4169E1', true, true, true, true)
    returning id into v_otimizacao_id;

    insert into recurring_task_goal_history (recurring_task_id, weekly_goal) values (v_otimizacao_id, 3);

    insert into recurring_task_checklist_items (recurring_task_id, item_key, label, sort_order) values
      (v_otimizacao_id, 'AUDIENCE', 'Público', 0),
      (v_otimizacao_id, 'CREATIVE', 'Criativo', 1),
      (v_otimizacao_id, 'CAMPAIGN', 'Campanha', 2),
      (v_otimizacao_id, 'BUDGET', 'Orçamento', 3),
      (v_otimizacao_id, 'PLACEMENT', 'Posicionamento', 4),
      (v_otimizacao_id, 'TRACKING', 'Conversão', 5),
      (v_otimizacao_id, 'REMARKETING', 'Remarketing', 6);
  end if;
end $$;
