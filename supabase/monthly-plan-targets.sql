-- Etapa "Planejamento Mensal 1.0": `monthly_budget_changes` deixa de
-- representar só orçamento e passa a representar VERSÕES do planejamento
-- mensal do cliente (investimento + metas de performance) — cada linha é
-- um snapshot completo do plano vigente a partir daquele momento, nunca só
-- o campo que mudou. Nome da tabela mantido por continuidade (renomear
-- agora aumentaria risco sem benefício real) — o escopo ampliado fica
-- documentado no comentário da tabela abaixo.
--
-- NÃO EXECUTAR sem aprovação — rodar manualmente no SQL Editor do Supabase
-- quando o admin decidir aplicar (mesmo padrão de toda migration deste
-- projeto que altera função/schema já em produção).
--
-- Aditivo: 2 colunas nullable, nenhuma linha histórica existente é
-- reescrita ou perde sentido. `clients.target_cost_per_result` NÃO é
-- removido — continua servindo de fallback (ver `lib/monthly-budget.ts`,
-- `resolveMonthlyPerformanceTargets`) até uma etapa futura avaliar sua
-- descontinuação, depois que a meta mensal estiver consolidada em uso.

alter table monthly_budget_changes
  add column if not exists target_result_count numeric(14, 2),
  add column if not exists target_cost_per_result numeric(12, 2);

comment on table monthly_budget_changes is
  'Histórico de versões do planejamento mensal do cliente — investimento (resulting_total) e metas de performance (target_result_count, target_cost_per_result), juntos. Cada linha é um snapshot COMPLETO do plano vigente a partir de effective_date/changed_at, nunca só o campo alterado (apply_monthly_budget_change sempre carrega adiante os valores não informados na chamada). A linha mais recente por client_id+month (ou, na ausência de uma para o mês, a mais recente com month anterior) é o plano vigente daquele mês — ver resolveMonthlyBudget/resolveMonthlyPerformanceTargets em lib/monthly-budget.ts. Nome mantido por continuidade; o escopo deixou de ser só "orçamento" nesta etapa.';

comment on column monthly_budget_changes.target_result_count is
  'Meta de quantidade de resultado vigente a partir desta versão do planejamento (leads/vendas, conforme clients.performance_goal) — null quando nenhuma meta de quantidade foi definida ainda. Sem fallback permanente: cliente sem nenhuma linha com este campo preenchido simplesmente não tem meta de quantidade.';

comment on column monthly_budget_changes.target_cost_per_result is
  'Meta de custo por resultado vigente a partir desta versão do planejamento (CPL/CPA, conforme performance_goal) — null quando esta versão não define uma meta de custo própria, caso em que o fallback é clients.target_cost_per_result (ver resolveMonthlyPerformanceTargets).';

-- ---------------------------------------------------------------------------
-- apply_monthly_budget_change ganha p_target_result_count/p_target_cost_per_result
-- (novos parâmetros, default null). Mesma razão de sempre pra derrubar a
-- assinatura antiga antes de recriar (ver monthly-budget-change-reason.sql):
-- adicionar parâmetro com default cria uma segunda função (overload) em vez
-- de substituir, e uma chamada com os 8 argumentos antigos ficaria ambígua.
-- ---------------------------------------------------------------------------
drop function if exists apply_monthly_budget_change(uuid, date, date, date, numeric, date, uuid, text);

create or replace function apply_monthly_budget_change(
  p_client_id uuid,
  p_first_day date,
  p_last_day date,
  p_effective_date date,
  p_new_budget numeric,
  p_today date,
  p_changed_by uuid,
  p_reason text default null,
  p_target_result_count numeric default null,
  p_target_cost_per_result numeric default null
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
  -- Snapshot completo (seção "Um cuidado importante" do pedido): valores
  -- não informados nesta chamada carregam adiante o que já estava vigente
  -- (última linha do cliente, qualquer mês) — nunca gravados como null só
  -- porque o formulário não tocou naquele campo.
  v_last_target_result_count numeric(14, 2);
  v_last_target_cost_per_result numeric(12, 2);
  v_client_permanent_cost numeric(12, 2);
begin
  if p_new_budget < 0 then
    raise exception 'Orçamento não pode ser negativo';
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

  -- Trava as sprints do cliente no mês pra serializar edições concorrentes.
  perform 1 from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    for update;

  select coalesce(sum(
    case
      when s.spend_source = 'manual' then coalesce(s.manual_actual_spend, 0)
      else (
        select coalesce(sum(ds.spend), 0)
        from daily_spend ds
        where ds.client_id = p_client_id
          and ds.date >= greatest(s.start_date, p_first_day)
          and ds.date <= least(s.end_date, p_effective_date - 1)
      )
    end
  ), 0) into v_consolidated
  from sprints s
  where s.client_id = p_client_id
    and s.start_date >= p_first_day and s.start_date <= p_last_day
    and s.start_date <= p_effective_date - 1;

  select coalesce(sum(planned_amount), 0) into v_previous_total
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_last_day;

  select coalesce(sum(planned_amount), 0) into v_historical_planned
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_effective_date - 1;

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
    insert into sprint_planned_allocations (sprint_id, client_id, date, planned_amount, updated_at)
    select
      ts.sprint_id,
      p_client_id,
      fd.date,
      (v_base_cents + case when fd.rn = v_future_days then v_remainder_cents else 0 end) / 100.0,
      now()
    from future_dates fd
    join target_sprints ts on fd.date >= ts.start_date and fd.date <= ts.end_date
    on conflict (sprint_id, date) do update
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

  -- Resolve o snapshot completo de metas: o que veio na chamada, senão o
  -- que já estava vigente (última linha deste cliente, qualquer mês) —
  -- nunca grava null só porque o formulário não tocou naquele campo.
  select target_result_count, target_cost_per_result
    into v_last_target_result_count, v_last_target_cost_per_result
    from monthly_budget_changes
    where client_id = p_client_id
    order by month desc, changed_at desc
    limit 1;

  select target_cost_per_result into v_client_permanent_cost
    from clients where id = p_client_id;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count, target_cost_per_result
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_historical_planned + v_future_available, v_is_below,
    nullif(trim(p_reason), ''),
    coalesce(p_target_result_count, v_last_target_result_count),
    coalesce(p_target_cost_per_result, v_last_target_cost_per_result, v_client_permanent_cost)
  );

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_historical_planned + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;
