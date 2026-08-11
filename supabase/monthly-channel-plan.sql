-- Etapa "Planejamento por Canal": o planejamento mensal deixa de ser um
-- valor único do cliente e passa a ser um conjunto de planejamentos por
-- canal (Meta, Google e futuros) — Investimento planejado e Resultado
-- planejado independentes por canal; CPA planejado nunca é armazenado (nem
-- por canal, nem consolidado), sempre derivado (investimento ÷ resultado)
-- em tempo de leitura. O consolidado nunca é editável diretamente: é sempre
-- a SOMA dos canais.
--
-- 100% aditivo — nenhuma tabela/função existente é alterada ou removida.
-- `apply_monthly_budget_change` (o editor único/consolidado antigo) continua
-- definida e intocada, só deixa de ser chamada pela aplicação a partir desta
-- etapa. `sprint_planned_allocations`/`monthly_budget_changes` ganham uma
-- coluna nova (default 'meta') — toda linha histórica existente já
-- representa Meta (única plataforma suportada até aqui), preservada sem
-- reinterpretação.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema/função já em produção.

-- ---------------------------------------------------------------------------
-- sprint_planned_allocations ganha `channel`. A granularidade diária por
-- canal é o que permite `sprints.planned_spend` (consolidado, lido em toda a
-- plataforma) continuar sendo simplesmente a SOMA de todas as linhas da
-- sprint — sem filtro de canal, a fórmula já existente vira "soma dos
-- canais" automaticamente, sem precisar mudar em nenhum outro lugar.
-- ---------------------------------------------------------------------------
alter table sprint_planned_allocations
  add column if not exists channel text not null default 'meta' check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other'));

alter table sprint_planned_allocations drop constraint if exists sprint_planned_allocations_sprint_id_date_key;
alter table sprint_planned_allocations
  add constraint sprint_planned_allocations_sprint_date_channel_key unique (sprint_id, date, channel);

comment on column sprint_planned_allocations.channel is
  'Canal deste planejamento diário. Default/histórico "meta" (única plataforma suportada até esta etapa) — nunca reinterpretado retroativamente. sprints.planned_spend continua sendo a soma de TODAS as linhas (todos os canais) de cada sprint.';

-- ---------------------------------------------------------------------------
-- monthly_budget_changes ganha `channel` — cada linha passa a ser o
-- snapshot do plano vigente de UM canal (não mais do cliente inteiro). Um
-- client_id+month agora tem uma linha mais recente POR CANAL, nunca uma só;
-- o "orçamento consolidado do mês" é sempre a soma da linha mais recente de
-- cada canal (nunca uma linha própria "consolidada").
-- ---------------------------------------------------------------------------
alter table monthly_budget_changes
  add column if not exists channel text not null default 'meta' check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other'));

create index if not exists monthly_budget_changes_client_month_channel_idx
  on monthly_budget_changes (client_id, month, channel, changed_at desc);

comment on column monthly_budget_changes.channel is
  'Canal a que este snapshot do plano se refere. Default/histórico "meta" (única plataforma suportada até esta etapa). O plano consolidado do cliente é sempre a soma da versão vigente de cada canal — nunca uma linha "consolidada" própria.';

comment on column monthly_budget_changes.target_cost_per_result is
  'Legado — só preenchido por apply_monthly_budget_change (editor antigo, consolidado, não mais chamado pela aplicação). apply_monthly_channel_plan_change NUNCA escreve aqui: custo por resultado planejado é sempre derivado (investimento ÷ target_result_count), nunca armazenado, em qualquer linha nova por canal.';

-- ---------------------------------------------------------------------------
-- apply_monthly_channel_plan_change: versão por canal da redistribuição
-- diária de orçamento — mesmo mecanismo de apply_monthly_budget_change
-- (trava as sprints do mês, calcula o realizado até a data efetiva,
-- redistribui o saldo futuro em centavos exatos, grava o histórico), mas:
--   1. o realizado até a data efetiva é o gasto efetivo DESTE CANAL (mesma
--      regra de sprint_channel_spend/daily_spend.channel já usada por
--      lib/effective-spend.ts + lib/channel-spend.ts no lado de leitura —
--      sprint_channel_spend.spend_source='manual' vale; senão soma
--      daily_spend filtrado por channel);
--   2. as alocações diárias gravadas em sprint_planned_allocations levam
--      channel = p_channel, nunca sobrescrevendo o planejamento de outro
--      canal na mesma sprint/dia;
--   3. sprints.planned_spend é recalculado como soma de TODAS as linhas da
--      sprint (todos os canais) — automaticamente vira o consolidado
--      correto assim que mais de um canal tem planejamento;
--   4. nunca recebe/grava target_cost_per_result — só target_result_count
--      (a quantidade). Custo por resultado planejado é sempre derivado na
--      leitura (ver resolveClientPlan, lib/client-plan.ts).
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
  p_target_result_count numeric default null
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

  if p_last_day < p_today then
    raise exception 'Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.';
  end if;

  select count(*) into v_sprint_count
    from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day;

  if v_sprint_count = 0 then
    raise exception 'Sprints deste mês ainda não foram geradas para este cliente.';
  end if;

  -- Trava as sprints do cliente no mês pra serializar edições concorrentes
  -- (inclusive entre canais diferentes do mesmo cliente/mês).
  perform 1 from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    for update;

  -- Realizado até a data efetiva, SÓ deste canal — mesma regra de
  -- resolveSprintChannelActualSpend (lib/channel-spend.ts): override manual
  -- explícito em sprint_channel_spend vale; sem override (ou override não
  -- manual), soma daily_spend filtrado por este canal.
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

  -- planned_spend de cada sprint volta a ser a soma de TODAS as linhas
  -- (todos os canais) — nunca filtrado por p_channel aqui, é isso que faz o
  -- consolidado virar automaticamente "soma dos canais" sem tocar em nenhum
  -- outro lugar da plataforma que já lê sprints.planned_spend.
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

  -- Snapshot completo (mesma regra de apply_monthly_budget_change): meta de
  -- quantidade não informada nesta chamada carrega adiante o que já estava
  -- vigente PRA ESTE CANAL (última linha deste cliente+canal, qualquer mês)
  -- — nunca gravada como null só porque o formulário não tocou nela.
  select target_result_count into v_last_target_result_count
    from monthly_budget_changes
    where client_id = p_client_id and channel = p_channel
    order by month desc, changed_at desc
    limit 1;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by, channel,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by, p_channel,
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
