-- Corrige apply_monthly_budget_change em DOIS pontos:
--
-- 1) o saldo distribuível pro futuro (remaining_budget) precisa ser
--    calculado com base no GASTO REAL já realizado antes da effective_date,
--    nunca com base no que estava PLANEJADO pra esses mesmos dias;
-- 2) a própria effective_date pertence ao período FUTURO/novo, nunca ao
--    histórico — a versão original (e a primeira versão desta correção,
--    antes de testes automatizados capturarem o erro) tratava
--    `date <= effective_date` como histórico e `date > effective_date`
--    como futuro; o pedido que motivou esta etapa é explícito no sentido
--    contrário ("o próprio dia 15/07 pertence ao novo período de
--    planejamento", effective_date = 15/07) — corrigido pra
--    `date < effective_date` (histórico) / `date >= effective_date` (futuro).
--
-- NÃO EXECUTAR sem aprovação — ver relatório de entrega desta etapa.
--
-- ---------------------------------------------------------------------------
-- O BUG
-- ---------------------------------------------------------------------------
-- A versão original desta função (supabase/monthly-budget.sql) calculava:
--
--   v_consolidated := sum(sprint_planned_allocations.planned_amount)
--                     onde date <= effective_date
--
-- Ou seja: "quanto já estava planejado pros dias passados", não "quanto foi
-- de fato gasto". Isso é exatamente o mesmo valor na maioria dos casos
-- simples, mas quebra sempre que o planejado histórico diverge do gasto
-- real — o caso mais comum sendo a PRIMEIRA configuração de orçamento no
-- meio do mês: antes de qualquer configuração, sprint_planned_allocations
-- tem só o backfill (planejado = 0 ou um valor arbitrário, nunca o gasto
-- real do cliente no Meta ou manual). Resultado: o orçamento novo inteiro
-- era distribuído de novo sobre os dias futuros, ignorando o que já tinha
-- sido gasto — o mês terminava com "gasto passado real" + "orçamento novo
-- inteiro pro futuro", maior que o orçamento configurado.
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO
-- ---------------------------------------------------------------------------
-- v_consolidated passa a ser: pra cada sprint do mês com alguma parcela
-- antes/igual à effective_date, o GASTO REAL dessa parcela — respeitando
-- spend_source de cada sprint individualmente (nunca soma Meta + manual):
--   - spend_source = 'meta_api': soma de daily_spend no intervalo
--     [max(sprint.start_date, p_first_day), min(sprint.end_date, effective_date)]
--   - spend_source = 'manual': manual_actual_spend inteiro da sprint (não há
--     granularidade diária pra gasto manual — ver observação abaixo sobre a
--     sprint que atravessa a effective_date).
--
-- Sprints cujo start_date é POSTERIOR à effective_date não entram (ainda não
-- começaram, gasto real = 0 por definição).
--
-- ---------------------------------------------------------------------------
-- LIMITAÇÃO CONHECIDA: sprint manual que atravessa a effective_date
-- ---------------------------------------------------------------------------
-- Quando spend_source = 'manual', o valor é ÚNICO por sprint (não há uma
-- linha por dia, diferente de daily_spend). Se essa sprint atravessa a
-- effective_date (ex.: sprint 13–19/07, effective_date 15/07), não há como
-- saber qual fração do valor manual pertence a 13–14/07 (passado) e qual
-- pertence a 15–19/07 (futuro) — o dado não existe nessa granularidade.
--
-- Esta correção trata o valor manual inteiro como "já gasto" sempre que a
-- sprint já começou até a effective_date (start_date <= effective_date),
-- mesmo que ela ainda não tenha terminado. É a opção mais segura disponível
-- hoje: nunca subestima o gasto real (o que poderia fazer o sistema
-- distribuir dinheiro pro futuro que já foi gasto), ao custo de, no caso
-- raro de sprint manual atravessando a effective_date, tratar como "já
-- gasto" um valor que na prática inclui uns poucos dias ainda futuros
-- daquela mesma sprint. Resolver isso de verdade exigiria granularidade
-- diária também pro gasto manual (uma tabela irmã de daily_spend) — fora do
-- escopo desta correção; registrado como recomendação futura no relatório.
--
create or replace function apply_monthly_budget_change(
  p_client_id uuid,
  p_first_day date,
  p_last_day date,
  p_effective_date date,
  p_new_budget numeric,
  p_today date,
  p_changed_by uuid
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

  -- CORREÇÃO: gasto REAL (não planejado) de cada sprint do mês que já tem
  -- alguma parcela até a effective_date — nunca soma Meta + manual, cada
  -- sprint usa exclusivamente sua própria spend_source.
  -- A própria effective_date pertence ao NOVO período de planejamento,
  -- nunca ao histórico — "gasto real ANTES da data efetiva" é estritamente
  -- anterior a ela (seção "Regra central do orçamento", item 2 do pedido, e
  -- o exemplo da sprint que atravessa a effective_date: "13/07 e 14/07
  -- pertencem ao período histórico [...] 15/07 até 19/07 pertencem ao novo
  -- planejamento", com effective_date = 15/07). Por isso o corte usado
  -- abaixo é sempre `p_effective_date - 1` (histórico) / `p_effective_date`
  -- em diante (futuro), nunca a própria effective_date como limite do
  -- histórico.
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

  -- Planejamento histórico (dias < effective_date) — nunca reescrito por
  -- esta função (só os dias futuros recebem insert/update abaixo). Usado só
  -- pra reportar `resulting_total` de forma consistente com o que
  -- efetivamente fica gravado em sprint_planned_allocations — nunca soma
  -- v_consolidated (gasto real) com v_future_available aqui: são conceitos
  -- diferentes (gasto real histórico decide o saldo futuro; planejado
  -- histórico + novo planejado futuro é o total exibido).
  select coalesce(sum(planned_amount), 0) into v_historical_planned
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_effective_date - 1;

  v_future_available := p_new_budget - v_consolidated;
  v_is_below := v_future_available < 0;
  if v_is_below then
    v_future_available := 0;
  end if;

  -- Futuro começa NA effective_date (inclusive), nunca no dia seguinte.
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

  -- planned_spend de cada sprint do mês vira, de novo, a soma das alocações
  -- (a fonte de verdade nunca deixa de ser sprint_planned_allocations).
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

  -- consolidated_amount agora registra o GASTO REAL já ocorrido antes da
  -- effective_date (não mais o planejado histórico) — mesma coluna,
  -- significado corrigido; linhas de histórico anteriores a esta correção
  -- continuam representando o cálculo antigo, nunca reescritas.
  -- resulting_total continua sendo o total PLANEJADO do mês após a mudança
  -- (histórico inalterado + novo futuro) — nunca o gasto real somado ao
  -- futuro, que seria uma mistura de dois conceitos diferentes.
  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_historical_planned + v_future_available, v_is_below
  );

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_historical_planned + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;
