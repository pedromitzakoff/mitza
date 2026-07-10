-- Etapa 38: orçamento mensal do cliente com redistribuição financeira das
-- sprints. Rode depois de supabase/sprint-actual-spend-source.sql.
--
-- Problema que esta migration resolve: até aqui, `sprints.planned_spend` era
-- um número único por sprint, editado direto e sem histórico. Isso não
-- consegue representar "parte da sprint atual já está consolidada (dias que
-- já passaram), parte ainda pode ser redistribuída (dias futuros)" — que é
-- exatamente o que uma alteração de orçamento no meio do mês precisa. Por
-- isso a granularidade passa a ser diária: `sprint_planned_allocations` guarda
-- o planejado de cada dia; `sprints.planned_spend` vira um valor DERIVADO,
-- sempre igual à soma das alocações daquela sprint, nunca mais escrito à mão
-- em outro lugar (a partir de agora, só a função apply_monthly_budget_change,
-- abaixo, escreve nessas duas tabelas).

-- ---------------------------------------------------------------------------
-- sprint_planned_allocations: planejado diário, granularidade que permite
-- travar o passado e redistribuir só o futuro.
-- ---------------------------------------------------------------------------
create table if not exists sprint_planned_allocations (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references sprints (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  date date not null,
  planned_amount numeric(12, 2) not null default 0 check (planned_amount >= 0),
  updated_at timestamptz not null default now(),
  unique (sprint_id, date)
);

create index if not exists sprint_planned_allocations_client_date_idx
  on sprint_planned_allocations (client_id, date);
create index if not exists sprint_planned_allocations_sprint_idx
  on sprint_planned_allocations (sprint_id);

alter table sprint_planned_allocations enable row level security;

create policy sprint_planned_allocations_select on sprint_planned_allocations
  for select using (is_admin() or is_client_manager(client_id));

-- Só a função apply_monthly_budget_change (chamada em nome de um admin
-- logado) escreve aqui — mesma regra de sprints_write.
create policy sprint_planned_allocations_write on sprint_planned_allocations
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- monthly_budget_changes: histórico auditável, nunca sobrescrito (sem
-- policy de update/delete — imutável, igual operational_activities).
-- ---------------------------------------------------------------------------
create table if not exists monthly_budget_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  month date not null, -- primeiro dia do mês afetado
  effective_date date not null,
  changed_by uuid references profiles (id) on delete set null,
  previous_amount numeric(12, 2) not null,
  new_amount numeric(12, 2) not null check (new_amount >= 0),
  consolidated_amount numeric(12, 2) not null,
  future_amount_distributed numeric(12, 2) not null,
  resulting_total numeric(12, 2) not null,
  is_below_consolidated boolean not null default false,
  changed_at timestamptz not null default now()
);

create index if not exists monthly_budget_changes_client_month_idx
  on monthly_budget_changes (client_id, month, changed_at desc);

alter table monthly_budget_changes enable row level security;

-- Select segue a mesma abertura financeira já usada em sprints/daily_spend
-- (admin ou gestor do cliente); a tela de histórico completo ("Ver
-- histórico") é restrita a admin na aplicação — mesmo padrão já usado em
-- SprintCard, onde a RLS de leitura é ampla mas a UI de edição/detalhe
-- sensível é gated por isAdmin no componente.
create policy monthly_budget_changes_select on monthly_budget_changes
  for select using (is_admin() or is_client_manager(client_id));

create policy monthly_budget_changes_insert on monthly_budget_changes
  for insert with check (is_admin());

-- ---------------------------------------------------------------------------
-- apply_monthly_budget_change: operação atômica única que aplica uma
-- alteração de orçamento mensal. Sempre roda dentro de UMA transação
-- implícita (função Postgres): trava as sprints do cliente/mês, calcula o
-- consolidado (alocações <= effective_date), calcula o saldo futuro,
-- redistribui em centavos exatos (sobra no último dia futuro), recalcula
-- planned_spend de cada sprint a partir da soma das alocações e grava o
-- histórico — tudo ou nada.
--
-- p_effective_date: hoje (fuso da agência) pra edição do mês corrente; um dia
-- antes do primeiro dia do mês pra edição de mês futuro (assim o consolidado
-- sai zero automaticamente, sem caso especial). Editar mês passado/encerrado
-- é bloqueado pela aplicação antes de chamar isto; o `p_today < p_last_day`
-- abaixo é uma segunda trava, direto no banco.
-- ---------------------------------------------------------------------------
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

  select coalesce(sum(planned_amount), 0) into v_consolidated
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_effective_date;

  select coalesce(sum(planned_amount), 0) into v_previous_total
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_last_day;

  v_future_available := p_new_budget - v_consolidated;
  v_is_below := v_future_available < 0;
  if v_is_below then
    v_future_available := 0;
  end if;

  v_future_start := greatest(p_effective_date + 1, p_first_day);
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

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_consolidated + v_future_available, v_is_below
  );

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_consolidated + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Backfill idempotente: reconstrução técnica só — distribui o planned_spend
-- atual de cada sprint existente igualmente pelos dias dela (mesma conta que
-- o gráfico já usava), sem criar registro de histórico e sem mudar nenhum
-- total. Sprints que já têm alocação são ignoradas (seguro rodar de novo).
-- ---------------------------------------------------------------------------
create or replace function backfill_sprint_planned_allocations() returns void as $$
declare
  s record;
  v_total_days int;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder_cents bigint;
  v_day date;
begin
  for s in
    select sp.id, sp.client_id, sp.start_date, sp.end_date, sp.planned_spend
    from sprints sp
    where not exists (select 1 from sprint_planned_allocations spa where spa.sprint_id = sp.id)
  loop
    v_total_days := (s.end_date - s.start_date) + 1;
    v_total_cents := round(s.planned_spend * 100)::bigint;
    v_base_cents := v_total_cents / v_total_days;
    v_remainder_cents := v_total_cents - v_base_cents * v_total_days;
    v_day := s.start_date;
    while v_day <= s.end_date loop
      insert into sprint_planned_allocations (sprint_id, client_id, date, planned_amount)
      values (
        s.id,
        s.client_id,
        v_day,
        (v_base_cents + case when v_day = s.end_date then v_remainder_cents else 0 end) / 100.0
      )
      on conflict (sprint_id, date) do nothing;
      v_day := v_day + 1;
    end loop;
  end loop;
end;
$$ language plpgsql;

select backfill_sprint_planned_allocations();
