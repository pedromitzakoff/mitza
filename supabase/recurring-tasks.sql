-- Reformulação do sistema de tarefas: tarefas recorrentes (hoje: Checar
-- saldo, Reportar cliente, Otimização) deixam de "nascer e morrer" toda
-- sprint (modelo antigo: supabase/global-sprint-task-templates.sql,
-- generate_sprint_tasks_from_templates) e passam a ser um registro
-- PERMANENTE com histórico de execuções — nunca mais uma tarefa nova por
-- semana. Decisões registradas em conversa com o usuário (28/07):
--   1. Migração: não migra pendências nem configuração do modelo antigo —
--      começa limpo. Admin recria as recorrências em /settings quando a
--      interface nova estiver pronta (migração única, no fim das fases).
--   2. Meta semanal: congelada por sprint (snapshot via histórico
--      append-only), nunca recalculada retroativamente quando a meta muda.
--   3. Frequência: uma meta única por sprint (sem faixa min/max) — execução
--      acima da meta só aparece como "5/4", sem penalização nem trava.
--   4. Otimização: reaproveita account_reviews/account_optimizations (Etapa
--      57) por baixo — "registrar execução" cria um account_review com
--      reason='ROUTINE'. Nenhum histórico paralelo.
--   5. Nenhum tipo de recorrência é hardcoded: "otimizacao"/
--      "verificacao_saldo"/"report" eram enum fixo no rascunho anterior
--      deste arquivo — revisado para dado (nome/ícone/cor/checklist), não
--      código, porque a agência já antecipa recorrências futuras (Conferir
--      Pixel, Revisar Google Ads, Revisar CRM, ...) que precisam nascer só
--      de um cadastro em /settings, sem deploy. A ÚNICA exceção continua
--      sendo o vínculo com account_reviews (ver `uses_account_review`
--      abaixo) — é uma integração de backend real, não uma preferência de
--      UI, então fica fora do que o admin pode configurar livremente.
--
-- Rode depois de supabase/account-reviews.sql (e de tudo antes dele).

-- ---------------------------------------------------------------------------
-- account_optimizations.optimization_type ganha 'REMARKETING' — os outros 6
-- itens do checklist padrão de Otimização (Público/Criativo/Campanha/
-- Orçamento/Posicionamento/Conversão) já mapeiam 1:1 pros tipos existentes
-- (AUDIENCE/CREATIVE/CAMPAIGN/BUDGET/PLACEMENT/TRACKING) — só Remarketing
-- não tinha equivalente. Ação sempre 'OTHER' pra esses registros (o
-- checklist não pergunta "qual ação exatamente", só "o que foi tocado").
-- ---------------------------------------------------------------------------
alter table account_optimizations drop constraint if exists account_optimizations_optimization_type_check;
alter table account_optimizations add constraint account_optimizations_optimization_type_check check (optimization_type in (
  'CREATIVE', 'AUDIENCE', 'BID', 'BUDGET', 'CAMPAIGN', 'AD_SET', 'PLACEMENT',
  'ACCOUNT_STRUCTURE', 'TRACKING', 'OTHER', 'REMARKETING'
));

alter table account_optimizations drop constraint if exists account_optimizations_optimization_type_optimization_action_check;
alter table account_optimizations add constraint account_optimizations_optimization_type_optimization_action_check check (
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
  or (optimization_type = 'REMARKETING' and optimization_action = 'OTHER')
);

-- ---------------------------------------------------------------------------
-- recurring_tasks: estrutura permanente e livre de enum de tipo — uma
-- recorrência nova (ex.: "Conferir Pixel") nasce só de uma linha aqui, sem
-- alterar código. `uses_account_review` é a única exceção: sinaliza que essa
-- recorrência tem uma integração de BACKEND real com account_reviews/
-- account_optimizations (hoje, só "Otimização"), não uma preferência de UI —
-- por isso não é algo que o admin liga/desliga livremente em /settings, é
-- provisionado junto com a recorrência que de fato tem essa integração
-- programada (a validação de que os itens do checklist batem com
-- OptimizationType só é aplicada quando esta flag é true).
-- ---------------------------------------------------------------------------
create table if not exists recurring_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  icon text not null default '🔁',
  color text not null default '#4169E1',
  default_assignee_id uuid references profiles (id) on delete set null,
  applies_to_all boolean not null default true,
  is_active boolean not null default true,
  has_checklist boolean not null default false,
  uses_account_review boolean not null default false,
  created_at timestamptz not null default now(),

  -- Defesa em profundidade: só faz sentido ter itens de checklist vinculados
  -- a account_reviews se o checklist em si existir.
  check (not uses_account_review or has_checklist)
);

create table if not exists recurring_task_clients (
  recurring_task_id uuid not null references recurring_tasks (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  primary key (recurring_task_id, client_id)
);

create index if not exists recurring_task_clients_client_id_idx on recurring_task_clients (client_id);

alter table recurring_tasks enable row level security;
create policy recurring_tasks_select on recurring_tasks for select using (true);
create policy recurring_tasks_write on recurring_tasks for all using (is_admin()) with check (is_admin());

alter table recurring_task_clients enable row level security;
create policy recurring_task_clients_select on recurring_task_clients for select using (true);
create policy recurring_task_clients_write on recurring_task_clients for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- recurring_task_checklist_items: os itens do checklist são DADO, não
-- código — pra "Otimização" (uses_account_review=true), item_key precisa
-- bater com um OptimizationType válido (é isso que o backend grava em
-- account_optimizations); pra qualquer recorrência futura sem
-- uses_account_review, item_key é livre, só um rótulo interno.
-- ---------------------------------------------------------------------------
create table if not exists recurring_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  recurring_task_id uuid not null references recurring_tasks (id) on delete cascade,
  item_key text not null,
  label text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (recurring_task_id, item_key)
);

create index if not exists recurring_task_checklist_items_task_idx
  on recurring_task_checklist_items (recurring_task_id, sort_order);

alter table recurring_task_checklist_items enable row level security;
create policy recurring_task_checklist_items_select on recurring_task_checklist_items for select using (true);
create policy recurring_task_checklist_items_write on recurring_task_checklist_items for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- recurring_task_goal_history: log append-only da meta semanal — nunca
-- editado nem apagado, só cresce. "Meta vigente" pra uma sprint = a linha com
-- o maior effective_from que ainda seja <= sprint.start_date (resolvido em
-- src/lib/recurring-tasks.ts::resolveWeeklyGoalForSprint). É isso que garante
-- a decisão de congelar a meta por sprint: mudar a meta hoje nunca reabre o
-- cálculo de uma sprint que já começou antes da mudança.
-- ---------------------------------------------------------------------------
create table if not exists recurring_task_goal_history (
  id uuid primary key default gen_random_uuid(),
  recurring_task_id uuid not null references recurring_tasks (id) on delete cascade,
  weekly_goal smallint not null check (weekly_goal > 0),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists recurring_task_goal_history_task_idx
  on recurring_task_goal_history (recurring_task_id, effective_from desc);

alter table recurring_task_goal_history enable row level security;
create policy recurring_task_goal_history_select on recurring_task_goal_history for select using (true);
create policy recurring_task_goal_history_write on recurring_task_goal_history for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- recurring_task_executions: o histórico em si — uma linha por "registrar
-- execução", nunca por "concluir tarefa" (a tarefa recorrente nunca é
-- concluída, nunca é apagada). account_review_id só é preenchido quando
-- recurring_tasks.uses_account_review = true (a execução, nesse caso, É um
-- account_review criado por baixo — ver register_recurring_execution
-- abaixo); pra qualquer outra recorrência fica null e o registro vive só
-- aqui. checklist_selected_keys é genérico — vale pra qualquer recorrência
-- com has_checklist=true, tenha ou não integração com account_reviews.
-- ---------------------------------------------------------------------------
create table if not exists recurring_task_executions (
  id uuid primary key default gen_random_uuid(),
  recurring_task_id uuid not null references recurring_tasks (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid not null references sprints (id) on delete restrict,
  executed_at timestamptz not null default now(),
  team_member_id uuid references team_members (id) on delete set null,
  performed_by_auth_user_id uuid references auth.users (id) on delete set null,
  account_review_id uuid references account_reviews (id) on delete set null,
  checklist_selected_keys text[],
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists recurring_task_executions_task_sprint_idx
  on recurring_task_executions (recurring_task_id, sprint_id);
create index if not exists recurring_task_executions_client_idx
  on recurring_task_executions (client_id, executed_at desc);

alter table recurring_task_executions enable row level security;

create policy recurring_task_executions_select on recurring_task_executions
  for select using (is_admin() or is_client_manager(client_id));

create policy recurring_task_executions_insert on recurring_task_executions
  for insert with check (
    (is_admin() or is_client_manager(client_id))
    and team_member_id = current_team_member_id()
  );

-- Imutável — sem policy de update/delete (mesmo padrão de account_reviews).

-- ---------------------------------------------------------------------------
-- register_recurring_execution: única operação que registra uma execução —
-- nome de domínio (não "record_...task_execution", detalhe de persistência).
-- Quando recurring_tasks.uses_account_review = true, delega inteiramente
-- pra record_account_review (Etapa 57): a execução É a criação de um
-- account_review com reason='ROUTINE', outcome derivado de ter ou não itens
-- marcados no checklist, e cada item marcado vira uma linha em
-- account_optimizations (optimization_action sempre 'OTHER' — o checklist
-- simplificado não pergunta "qual ação", só "o que foi tocado"). Fora isso,
-- só grava a linha em recurring_task_executions, sem tocar em
-- account_reviews.
-- ---------------------------------------------------------------------------
create or replace function register_recurring_execution(
  p_recurring_task_id uuid,
  p_client_id uuid,
  p_team_member_id uuid,
  p_auth_user_id uuid,
  p_notes text,
  p_checklist_selected_keys text[] default null,
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
  v_item text;
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
    v_optimizations := '[]'::jsonb;
    if p_checklist_selected_keys is not null then
      foreach v_item in array p_checklist_selected_keys loop
        v_optimizations := v_optimizations || jsonb_build_object('type', v_item, 'action', 'OTHER');
      end loop;
    end if;

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
    account_review_id, checklist_selected_keys, notes
  ) values (
    p_recurring_task_id, p_client_id, v_sprint_id, p_team_member_id, p_auth_user_id,
    v_review_id, p_checklist_selected_keys, case when v_uses_account_review then null else p_notes end
  )
  returning id into v_execution_id;

  return jsonb_build_object('executionId', v_execution_id, 'sprintId', v_sprint_id, 'accountReviewId', v_review_id);
end;
$$ language plpgsql;

-- NADA neste arquivo desativa o modelo antigo (sprint_task_templates) —
-- isso é a "ativação" do novo modelo (Passo 3 de
-- supabase/cleanup-legacy-recurring-tasks.sql), deliberadamente adiada pro
-- fim de todas as fases de interface (decisão do usuário, 28/07: "não quero
-- um período em que os gestores fiquem sem visualizar as recorrências
-- principais"). Rodar SÓ este arquivo é seguro a qualquer momento: cria
-- tabelas/função novas (aditivo, `recurring_tasks` começa vazia), sem tocar
-- em nenhum dado ou comportamento já existente — é o que permite a
-- interface nova já ler essas tabelas (sempre vazias, por ora) sem quebrar
-- nada em produção enquanto as fases de UI ainda estão sendo construídas.
