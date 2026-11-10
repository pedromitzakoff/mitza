-- Etapa "Configuração inteligente de métricas por cliente" — adiciona dois
-- novos valores de `PerformanceGoal`: 'conversations' (WhatsApp/mensagens) e
-- 'registrations' (cadastros). 100% aditivo: amplia os CHECK constraints e
-- os 2 guards inline em PL/pgSQL que já existem, nenhuma tabela nova, nenhum
-- backfill (nenhuma linha histórica poderia ter esses valores — eles não
-- existiam ainda).
--
-- Três grupos, cada um com uma lista final DIFERENTE (auditoria confirmou
-- cada um lendo o arquivo de origem — ver relatório da etapa anterior):
--   1. Colunas "puras" de PerformanceGoal: ganham só os 2 valores novos.
--   2. `metric_mappings.goal` / `daily_performance.result_type`: já tinham
--      um 4º valor extra ('carts', métrica secundária de carrinho — nunca um
--      PerformanceGoal de cliente, ver `secondary-cart-metric.sql`) — ganham
--      os 2 novos E preservam 'carts'.
--   3. Tabelas granulares (campanha/conjunto/anúncio/posicionamento): hoje
--      restritas a ('leads','sales') de propósito — 'followers' nunca entrou
--      aqui porque não é atribuível a uma campanha individual na Meta.
--      'conversations'/'registrations' SÃO eventos de campanha (mensagem
--      iniciada, cadastro — reportados por anúncio, igual lead/venda), então
--      entram aqui também; 'followers' continua de fora.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção. Rode este arquivo inteiro no SQL Editor
-- do Supabase só depois de revisado.

-- ---------------------------------------------------------------------------
-- Grupo 1 — colunas puras de PerformanceGoal (7 constraints)
-- ---------------------------------------------------------------------------
alter table clients drop constraint if exists clients_performance_goal_check;
alter table clients add constraint clients_performance_goal_check
  check (performance_goal in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table client_goals drop constraint if exists client_goals_result_type_check;
alter table client_goals add constraint client_goals_result_type_check
  check (result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table monthly_budget_changes drop constraint if exists monthly_budget_changes_result_type_check;
alter table monthly_budget_changes add constraint monthly_budget_changes_result_type_check
  check (result_type is null or result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table client_campaign_goal_assignments drop constraint if exists client_campaign_goal_assignments_result_type_check;
alter table client_campaign_goal_assignments add constraint client_campaign_goal_assignments_result_type_check
  check (result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table client_funnels drop constraint if exists client_funnels_linked_result_type_check;
alter table client_funnels add constraint client_funnels_linked_result_type_check
  check (linked_result_type is null or linked_result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table client_reports drop constraint if exists client_reports_performance_goal_check;
alter table client_reports add constraint client_reports_performance_goal_check
  check (performance_goal in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

alter table performance_records drop constraint if exists performance_records_result_type_check;
alter table performance_records add constraint performance_records_result_type_check
  check (result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations'));

-- ---------------------------------------------------------------------------
-- Grupo 2 — colunas que já incluem 'carts' (preservado, nunca removido)
-- ---------------------------------------------------------------------------
alter table metric_mappings drop constraint if exists metric_mappings_goal_check;
alter table metric_mappings add constraint metric_mappings_goal_check
  check (goal in ('leads', 'sales', 'followers', 'conversations', 'registrations', 'carts'));

alter table daily_performance drop constraint if exists daily_performance_result_type_check;
alter table daily_performance add constraint daily_performance_result_type_check
  check (result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations', 'carts'));

-- ---------------------------------------------------------------------------
-- Grupo 3 — granular (campanha/conjunto/anúncio/posicionamento): só os
-- objetivos atribuíveis a uma campanha individual. 'followers' continua de
-- fora (comportamento já existente, fora do escopo desta etapa).
-- ---------------------------------------------------------------------------
alter table campaign_daily_metrics drop constraint if exists campaign_daily_metrics_result_type_check;
alter table campaign_daily_metrics add constraint campaign_daily_metrics_result_type_check
  check (result_type in ('leads', 'sales', 'conversations', 'registrations'));

alter table ad_set_daily_metrics drop constraint if exists ad_set_daily_metrics_result_type_check;
alter table ad_set_daily_metrics add constraint ad_set_daily_metrics_result_type_check
  check (result_type in ('leads', 'sales', 'conversations', 'registrations'));

alter table campaign_placement_daily_metrics drop constraint if exists campaign_placement_daily_metrics_result_type_check;
alter table campaign_placement_daily_metrics add constraint campaign_placement_daily_metrics_result_type_check
  check (result_type in ('leads', 'sales', 'conversations', 'registrations'));

alter table ad_creative_daily_metrics drop constraint if exists ad_creative_daily_metrics_result_type_check;
alter table ad_creative_daily_metrics add constraint ad_creative_daily_metrics_result_type_check
  check (result_type in ('leads', 'sales', 'conversations', 'registrations'));

-- ---------------------------------------------------------------------------
-- 2 guards inline em PL/pgSQL (não são CHECK constraints — mesma lista
-- hardcoded dentro do corpo da função, teriam passado despercebidos numa
-- migração só de constraints). Corpo idêntico ao de `client-goals.sql`,
-- só a lista de valores válidos muda.
-- ---------------------------------------------------------------------------
create or replace function apply_monthly_channel_plan_change(
  p_client_id uuid,
  p_channel text,
  p_first_day date,
  p_last_day date,
  p_effective_date date,
  p_new_budget numeric,
  p_today date,
  p_changed_by uuid,
  p_reason text default null,
  p_target_result_count numeric default null,
  p_result_type text default null
) returns jsonb as $$
declare
  v_consolidated numeric(12, 2) := 0;
  v_historical_planned numeric(12, 2) := 0;
  v_previous_total numeric(12, 2) := 0;
  v_future_available numeric(12, 2) := 0;
  v_is_below boolean := false;
  v_future_start date;
  v_future_days int := 0;
  v_total_cents bigint := 0;
  v_base_cents bigint := 0;
  v_remainder_cents bigint := 0;
  v_sprint_count int := 0;
  v_last_target_result_count numeric(14, 2);
begin
  if p_new_budget < 0 then
    raise exception 'Orçamento não pode ser negativo';
  end if;

  if p_channel not in ('meta', 'google', 'tiktok', 'linkedin', 'other') then
    raise exception 'Canal inválido: %', p_channel;
  end if;

  if p_result_type is not null and p_result_type not in ('leads', 'sales', 'followers', 'conversations', 'registrations') then
    raise exception 'Objetivo inválido: %', p_result_type;
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

  perform 1 from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    for update;

  select coalesce(sum(
    case
      when scs.spend_source = 'manual' then coalesce(scs.manual_actual_spend, 0)
      else (
        select coalesce(sum(ds.spend), 0)
        from daily_spend ds
        where ds.client_id = p_client_id and ds.channel = p_channel
          and ds.date >= greatest(s.start_date, p_first_day)
          and ds.date <= least(s.end_date, p_effective_date - 1)
      )
    end
  ), 0) into v_consolidated
  from sprints s
  left join sprint_channel_spend scs on scs.sprint_id = s.id and scs.channel = p_channel
  where s.client_id = p_client_id
    and s.start_date >= p_first_day and s.start_date <= p_last_day
    and s.start_date <= p_effective_date - 1;

  select coalesce(sum(planned_amount), 0) into v_previous_total
    from sprint_planned_allocations
    where client_id = p_client_id and channel = p_channel and date >= p_first_day and date <= p_last_day;

  select coalesce(sum(planned_amount), 0) into v_historical_planned
    from sprint_planned_allocations
    where client_id = p_client_id and channel = p_channel and date >= p_first_day and date <= p_effective_date - 1;

  v_future_available := p_new_budget - v_consolidated;
  v_is_below := v_future_available < 0;
  if v_is_below then
    v_future_available := 0;
  end if;

  v_future_start := greatest(p_effective_date, p_first_day);
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
    insert into sprint_planned_allocations (sprint_id, client_id, date, channel, planned_amount, updated_at)
    select
      ts.sprint_id,
      p_client_id,
      fd.date,
      p_channel,
      (v_base_cents + case when fd.rn = v_future_days then v_remainder_cents else 0 end) / 100.0,
      now()
    from future_dates fd
    join target_sprints ts on fd.date >= ts.start_date and fd.date <= ts.end_date
    on conflict (sprint_id, date, channel) do update
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

  select target_result_count into v_last_target_result_count
    from monthly_budget_changes
    where client_id = p_client_id and channel = p_channel
      and result_type is not distinct from p_result_type
    order by month desc, changed_at desc
    limit 1;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by, channel, result_type,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by, p_channel, p_result_type,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_historical_planned + v_future_available, v_is_below,
    nullif(trim(p_reason), ''),
    coalesce(p_target_result_count, v_last_target_result_count)
  );

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_historical_planned + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;

create or replace function set_goal_monthly_target(
  p_client_id uuid,
  p_channel text,
  p_month date,
  p_result_type text,
  p_target_result_count numeric,
  p_changed_by uuid,
  p_reason text default null
) returns void as $$
begin
  if p_channel not in ('meta', 'google', 'tiktok', 'linkedin', 'other') then
    raise exception 'Canal inválido: %', p_channel;
  end if;

  if p_result_type not in ('leads', 'sales', 'followers', 'conversations', 'registrations') then
    raise exception 'Objetivo inválido: %', p_result_type;
  end if;

  if exists (select 1 from client_goals where client_id = p_client_id and result_type = p_result_type and is_primary) then
    raise exception 'Este objetivo é o principal do cliente — use o editor de plano por canal, nunca esta função.';
  end if;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by, channel, result_type,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count
  ) values (
    p_client_id, p_month, p_month, p_changed_by, p_channel, p_result_type,
    0, 0, 0, 0, 0, false,
    nullif(trim(p_reason), ''),
    p_target_result_count
  );
end;
$$ language plpgsql;
