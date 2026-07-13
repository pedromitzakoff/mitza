-- Etapa 50: sprints deixam de ser blocos fixos de dias do mês (1-7, 8-14,
-- 15-21, 22-28, resto) e passam a representar semanas operacionais reais do
-- calendário (segunda a domingo), podendo atravessar mês (e ano). Rode
-- depois de supabase/monthly-budget.sql.
--
-- O QUE NÃO MUDA NO BANCO: `sprints.start_date`/`end_date` continuam sendo a
-- fonte de verdade da sprint (só a REGRA de como esses valores nascem é que
-- muda). `sprint_planned_allocations` (planejado por dia) e `daily_spend`
-- (gasto real sincronizado por dia) já eram granulares por dia desde as
-- Etapas 31/38 — por isso o "planejado" e o "gasto sincronizado" por mês já
-- funcionam corretamente para uma sprint que atravessa dois meses sem
-- precisar de nenhuma tabela nova: basta somar por INTERSEÇÃO DE DATA com o
-- mês, não mais por "a sprint pertence ao mês em que começou" (essa era
-- exatamente a lógica quebrada, repetida em vários arquivos — corrigida no
-- código em src/lib/sprint-financials.ts e src/lib/sprint-week.ts).
--
-- O ÚNICO caso que não tinha granularidade suficiente pra dividir por mês é
-- o GASTO MANUAL (spend_source = 'manual'): hoje é um número único
-- (`manual_actual_spend`) pra sprint inteira, sem referência de data. A
-- tabela nova abaixo resolve isso só para sprints que atravessam mês —
-- sprints inteiramente dentro de um mês continuam usando só
-- `manual_actual_spend`, sem precisar de linha nenhuma aqui (mantém a
-- experiência simples pedida). Não há dado histórico pra migrar aqui: sob a
-- regra antiga, nenhuma sprint jamais atravessou um mês, então esse cenário
-- é inteiramente novo a partir de agora — não existe "gasto manual antigo
-- dividido incorretamente" pra corrigir.

-- ---------------------------------------------------------------------------
-- sprint_manual_spend_by_month: gasto manual por mês, só usado quando uma
-- sprint atravessa a fronteira do mês E está com spend_source = 'manual'.
-- ---------------------------------------------------------------------------
create table if not exists sprint_manual_spend_by_month (
  id uuid primary key default gen_random_uuid(),
  sprint_id uuid not null references sprints (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  month_start date not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (sprint_id, month_start)
);

create index if not exists sprint_manual_spend_by_month_client_month_idx
  on sprint_manual_spend_by_month (client_id, month_start);

alter table sprint_manual_spend_by_month enable row level security;

-- Mesma abertura de leitura que sprints/daily_spend (Etapa 15: qualquer
-- autenticado pode ver, pra colaboração entre gestores).
create policy sprint_manual_spend_by_month_select on sprint_manual_spend_by_month
  for select using (auth.uid() is not null);

-- Mesma regra de escrita que sprints (admin-only) — a action que grava aqui
-- já usa requireAdmin(), igual updateSprintActualSpendAction hoje.
create policy sprint_manual_spend_by_month_write on sprint_manual_spend_by_month
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- ensure_weekly_sprints: substitui generate_sprints_for_month como forma de
-- criar sprints novas. Sempre gera semanas segunda-a-domingo a partir da
-- semana de "hoje" até um horizonte de N semanas à frente — nunca depende do
-- formato das sprints que já existem (evita criar uma sprint "de
-- transição" torta pra tapar buraco entre o antigo bloco de dias e a nova
-- semana). Idempotente (on conflict do nothing, mesma unique key de sempre)
-- — pode (e deve) ser chamada de novo a qualquer momento, inclusive
-- direto da aplicação, já que não existe hoje nenhum cron automatizado que
-- gerasse as sprints do mês seguinte (generate_next_month_sprints nunca foi
-- de fato agendado — grep no repo confirma zero chamadas fora do próprio
-- SQL). Chamar isso a cada carregamento das telas Sprints/Cliente resolve
-- esse gap de quebra, sem precisar de infraestrutura de agendamento nova.
-- ---------------------------------------------------------------------------
create or replace function ensure_weekly_sprints(
  p_client_id uuid,
  p_today date,
  p_horizon_weeks int default 8
) returns void as $$
declare
  v_week_start date := p_today - ((extract(isodow from p_today)::int - 1));
  v_cursor date := v_week_start;
  v_through date := v_week_start + (p_horizon_weeks * 7);
  v_sprint_id uuid;
begin
  while v_cursor <= v_through loop
    v_sprint_id := null;

    insert into sprints (client_id, start_date, end_date, planned_spend)
    values (p_client_id, v_cursor, v_cursor + 6, 0)
    on conflict (client_id, start_date) do nothing
    returning id into v_sprint_id;

    if v_sprint_id is not null then
      perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, v_cursor, v_cursor + 6);
    end if;

    v_cursor := v_cursor + 7;
  end loop;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- trg_create_initial_sprints (redefinida): cliente novo já nasce com as
-- semanas operacionais (atual + 8 à frente), em vez dos blocos de dia.
-- ---------------------------------------------------------------------------
create or replace function trg_create_initial_sprints() returns trigger as $$
begin
  perform ensure_weekly_sprints(new.id, current_date, 8);
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- generate_sprints_for_month / generate_next_month_sprints: NÃO removidas
-- (histórico de blocos de dia já gerados continua intacto e consultável —
-- "não apagar dados existentes"), mas não são mais chamadas por nenhum
-- trigger ou fluxo da aplicação a partir desta migration. Deprecadas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- apply_monthly_budget_change (redefinida): a versão anterior identificava
-- "as sprints deste mês" filtrando por `start_date between p_first_day and
-- p_last_day" — sob blocos de dia isso bastava, porque toda sprint morava
-- inteira dentro de um mês. Com semanas que atravessam mês, uma sprint como
-- 27/jul-02/ago tem `start_date` em julho: ao editar o orçamento de AGOSTO,
-- o filtro antigo nunca encontraria essa sprint, e os dias 01-02/08 dela
-- nunca receberiam alocação nenhuma. A correção é trocar toda a seleção de
-- "sprints deste mês" por SOBREPÕE este mês (`start_date <= p_last_day and
-- end_date >= p_first_day`), e recalcular `sprints.planned_spend` somando
-- TODAS as alocações da sprint (não só as do mês que acabou de ser editado)
-- — senão editar agosto apagaria a parcela de julho já calculada antes.
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
    where client_id = p_client_id and start_date <= p_last_day and end_date >= p_first_day;

  if v_sprint_count = 0 then
    raise exception 'Sprints deste mês ainda não foram geradas para este cliente.';
  end if;

  -- Trava as sprints que tocam este mês (mesmo as que atravessam pra outro
  -- mês) pra serializar edições concorrentes.
  perform 1 from sprints
    where client_id = p_client_id and start_date <= p_last_day and end_date >= p_first_day
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
      where client_id = p_client_id and start_date <= p_last_day and end_date >= p_first_day
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

  -- planned_spend de cada sprint volta a ser a soma das alocações — mas
  -- agora somando TODOS os dias da sprint (não só os deste mês), senão
  -- editar agosto zeraria a parcela de julho de uma sprint que atravessa os
  -- dois meses.
  update sprints s
  set planned_spend = coalesce(sub.total, 0)
  from (
    select spa.sprint_id, sum(spa.planned_amount) as total
    from sprint_planned_allocations spa
    join sprints sp2 on sp2.id = spa.sprint_id
    where sp2.client_id = p_client_id and sp2.start_date <= p_last_day and sp2.end_date >= p_first_day
    group by spa.sprint_id
  ) sub
  where s.id = sub.sprint_id;

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
-- Backfill: garante as semanas operacionais (atual + 8 à frente) pra todos
-- os clientes já cadastrados — sem isso, só clientes criados a partir desta
-- migration ganhariam sprints no novo formato. Idempotente, seguro rodar de
-- novo. Sprints antigas (blocos de dia) NÃO são apagadas nem convertidas —
-- ficam como estão, preservando o histórico.
-- ---------------------------------------------------------------------------
create or replace function backfill_weekly_sprints() returns void as $$
declare
  c record;
begin
  for c in select id from clients where deleted_at is null loop
    perform ensure_weekly_sprints(c.id, current_date, 8);
  end loop;
end;
$$ language plpgsql;

select backfill_weekly_sprints();
