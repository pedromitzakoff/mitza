-- Etapa 50 (correção 2): as duas migrations anteriores (weekly-sprints.sql
-- e sprint-month-boundary-fix.sql) geraram sprints NOVAS (formato semanal)
-- por cima de sprints ANTIGAS (formato de blocos de dia 1-7/8-14/15-21/
-- 22-28/29-fim) que já existiam pra este mês, sem verificar sobreposição.
-- Resultado: 9 sprints pra julho/2026 em vez de 5, com datas se cruzando e
-- duas sprints classificadas como "atual".
--
-- POR QUE ACONTECEU (investigação, antes de qualquer código):
-- 1. `generate_sprints_for_month` (a REGRA ANTIGA, blocos de dia) já tinha
--    rodado pra este cliente/mês antes desta etapa inteira começar —
--    provavelmente no momento em que o cliente foi criado (o gatilho
--    `trg_create_initial_sprints` sempre chamou essa função pra gerar o mês
--    corrente). Essas sprints (01-07, 08-14, 15-21, 22-28, 29-31) já
--    existiam no banco.
-- 2. `ensure_weekly_sprints`/`backfill_weekly_sprints` (a REGRA NOVA desta
--    etapa) rodou por cima, sem NUNCA checar se já existiam sprints pra
--    essas mesmas datas — só protegia contra duplicar o mesmo start_date
--    exato (`unique(client_id, start_date)`), o que não impede duas sprints
--    com start_date DIFERENTE mas datas sobrepostas (ex.: bloco 08-14 e
--    semana 06-12/13-19 cobrem os mesmos dias 08-12, com start_date
--    diferentes — o unique nunca barra isso).
-- 3. Ou seja: duas regras de geração diferentes ficaram simultaneamente
--    "ativas" no banco (a antiga nunca foi desativada, só parou de ser
--    CHAMADA por trigger novo — mas as sprints que ela já tinha criado
--    continuavam lá), e a nova não foi construída pra reconciliar contra
--    o que já existia. Essa é a causa raiz de "a geração não foi
--    idempotente": idempotência aqui exigia checar o estado already-on-disk
--    de qualquer formato, não só o próprio formato novo.
--
-- ESTA MIGRATION: (a) define uma única função de calendário canônica
-- (`compute_month_sprint_periods`), verificada em
-- scratchpad/verify-calendar.mjs contra ~20 meses (início em qualquer dia
-- da semana, fevereiro bissexto/não bissexto, meses de 28/29/30/31 dias);
-- (b) reconcilia todo cliente/mês que hoje tem sprints sobrepostas,
-- preservando tarefas (por due_date), alocações de planejado (por date),
-- comentários e gasto manual (ver limitação abaixo), removendo os
-- registros antigos só depois de migrar os dados; (c) adiciona uma
-- CONSTRAINT de banco que impede sobreposição fisicamente, não só por
-- convenção de código; (d) substitui a geração contínua por uma versão
-- que só roda sob demanda (rota /api/cron/ensure-sprints), nunca durante
-- render de página.
--
-- IMPORTANTE: meses PASSADOS que só têm o formato antigo (sem nenhuma
-- sprint nova sobreposta) NÃO são tocados — não há sobreposição real
-- neles, e forçar a conversão destruiria a numeração histórica sem
-- necessidade. Só clientes/meses com sobreposição REAL são reconciliados.
--
-- Rode depois de supabase/sprint-month-boundary-fix.sql.
--
-- CORREÇÃO (2ª rodada, após rodar pela 1ª vez): a 1ª versão desta migration
-- travava com "duplicate key value violates unique constraint
-- sprints_client_id_start_date_key" — porque o passo 3a tentava INSERIR uma
-- sprint canônica pro 1º período do mês (ex.: 01-05) sem checar que o bloco
-- antigo (ex.: 01-07) já ocupava esse mesmo start_date (os dois sempre
-- começam no dia 1 do mês, só o end_date difere). A correção troca o INSERT
-- cego por uma checagem por start_date que CONVERTE a sprint antiga em
-- lugar (UPDATE do end_date, id preservado) quando ela já existe com esse
-- start_date mas end_date diferente — nunca mais um INSERT concorrente com
-- a mesma chave. A mesma regra foi aplicada em ensure_client_sprints (passo
-- 7), que tinha o mesmo risco latente.

-- ---------------------------------------------------------------------------
-- 1) REGRA ÚNICA DE CALENDÁRIO
-- ---------------------------------------------------------------------------
create or replace function compute_month_sprint_periods(p_year int, p_month int)
returns table(start_date date, end_date date) as $$
declare
  v_month_start date := make_date(p_year, p_month, 1);
  v_month_end date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_cursor date := v_month_start;
  v_period_end date;
begin
  while v_cursor <= v_month_end loop
    -- dias até o próximo domingo (isodow: 1=seg..7=dom); se v_cursor já é
    -- domingo, o período tem só esse dia.
    v_period_end := v_cursor + (7 - extract(isodow from v_cursor)::int);
    if v_period_end > v_month_end then
      v_period_end := v_month_end;
    end if;

    start_date := v_cursor;
    end_date := v_period_end;
    return next;

    v_cursor := v_period_end + 1;
  end loop;
end;
$$ language plpgsql immutable;

-- ---------------------------------------------------------------------------
-- 2) DETECÇÃO — só reconcilia cliente/mês que realmente tem sobreposição
--    (meses históricos só com o formato antigo, sem conflito, ficam intactos).
-- ---------------------------------------------------------------------------
create or replace function month_has_sprint_overlap(p_client_id uuid, p_year int, p_month int)
returns boolean as $$
declare
  v_month_start date := make_date(p_year, p_month, 1);
  v_month_end date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
begin
  return exists (
    select 1
    from sprints a
    join sprints b on a.client_id = b.client_id and a.id < b.id
    where a.client_id = p_client_id
      and a.start_date <= v_month_end and a.end_date >= v_month_start
      and b.start_date <= v_month_end and b.end_date >= v_month_start
      and a.start_date <= b.end_date and a.end_date >= b.start_date
  );
end;
$$ language plpgsql stable;

-- ---------------------------------------------------------------------------
-- 3) RECONCILIAÇÃO de um cliente/mês com sobreposição detectada.
--
-- Preservação de dados:
--   - Tarefas: reatribuídas pelo próprio due_date (nunca pela sprint antiga).
--   - sprint_planned_allocations: reatribuídas pela própria date (já é
--     granular por dia — nenhuma invenção de distribuição).
--   - Comentários e gasto manual (manual_actual_spend), que NÃO têm data
--     própria: vão para o período canônico que contém a DATA DE INÍCIO da
--     sprint antiga. É uma aproximação — documentada aqui e no relatório
--     (RAISE NOTICE) — porque blocos antigos (1-7, 8-14...) quase nunca
--     coincidem exatamente com as semanas novas, então não há uma resposta
--     "exata" possível sem inventar uma regra de rateio. Nenhum valor é
--     perdido: o gasto manual é somado ao período de destino, nunca
--     descartado.
--   - Nada é apagado antes de migrar: a sprint antiga só é removida depois
--     que tarefas e alocações dela já foram movidas.
-- ---------------------------------------------------------------------------
create or replace function reconcile_client_month_sprints(p_client_id uuid, p_year int, p_month int)
returns void as $$
declare
  period record;
  v_sprint_id uuid;
  v_existing_end_date date;
  old_sprint record;
  v_canonical_id uuid;
  v_month_start date := make_date(p_year, p_month, 1);
  v_month_end date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_tasks_moved int;
  v_allocations_moved int;
begin
  raise notice '--- Reconciliando cliente % — %-%  ---', p_client_id, p_year, p_month;

  -- 3a) garante que cada período canônico do mês tem uma sprint. Bloco
  -- antigo e período canônico QUASE SEMPRE compartilham o start_date do
  -- primeiro período do mês (ambos começam no dia 1) — por isso a busca é
  -- por start_date, não pelo intervalo exato. Se já existir uma sprint com
  -- esse start_date e o MESMO end_date, reaproveita sem tocar em nada. Se
  -- existir uma sprint com o MESMO start_date mas end_date DIFERENTE (ex.:
  -- bloco antigo 01-07 vs período canônico 01-05), ela é CONVERTIDA em
  -- lugar (UPDATE do end_date, id preservado) em vez de tentar inserir uma
  -- segunda linha — um INSERT à parte violaria
  -- unique(client_id, start_date), que foi exatamente o erro
  -- "duplicate key value violates unique constraint sprints_client_id_start_date_key"
  -- reportado ao rodar esta migration pela primeira vez. Converter em lugar
  -- também preserva de graça tudo que já estava ligado ao id (tarefas,
  -- alocações, comentários, gasto manual) sem precisar mover nada.
  for period in select * from compute_month_sprint_periods(p_year, p_month) loop
    v_sprint_id := null;
    v_existing_end_date := null;
    select id, end_date into v_sprint_id, v_existing_end_date from sprints
      where client_id = p_client_id and start_date = period.start_date;

    if v_sprint_id is null then
      insert into sprints (client_id, start_date, end_date, planned_spend)
      values (p_client_id, period.start_date, period.end_date, 0)
      returning id into v_sprint_id;
      perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, period.start_date, period.end_date);
      raise notice '  criada sprint canônica % (%-%)', v_sprint_id, period.start_date, period.end_date;
    elsif v_existing_end_date <> period.end_date then
      raise notice '  convertendo sprint % (%-%) na sprint canônica %-% (mesmo id, dados preservados)',
        v_sprint_id, period.start_date, v_existing_end_date, period.start_date, period.end_date;
      update sprints set end_date = period.end_date where id = v_sprint_id;
    end if;
  end loop;

  -- 3a-bis) agora que todo período canônico do mês já tem uma sprint (nova
  -- ou convertida em lugar no passo acima), realinha tarefas e alocações
  -- que ficaram "para trás" numa sprint convertida — dias que pertenciam ao
  -- intervalo antigo mais longo (ex.: dia 06 e 07 do bloco 01-07 antigo)
  -- mas caíram fora do intervalo canônico mais curto (01-05) depois do
  -- UPDATE acima. Só pode rodar DEPOIS do loop 3a inteiro, porque o destino
  -- certo (ex.: a sprint canônica 06-12) pode só existir a partir de uma
  -- iteração posterior do mesmo loop.
  with moved as (
    update tasks t set sprint_id = ns.id
    from sprints os, sprints ns
    where t.sprint_id = os.id
      and os.client_id = p_client_id
      and ns.client_id = p_client_id
      and ns.id <> os.id
      and os.start_date between v_month_start and v_month_end
      and ns.start_date between v_month_start and v_month_end
      and (t.due_date < os.start_date or t.due_date > os.end_date)
      and t.due_date between ns.start_date and ns.end_date
    returning t.id
  )
  select count(*) into v_tasks_moved from moved;
  if v_tasks_moved > 0 then
    raise notice '  tarefas realinhadas após conversão de sprint: %', v_tasks_moved;
  end if;

  v_allocations_moved := 0;
  declare
    alloc record;
    v_target_sprint_id uuid;
    v_existing_amount numeric;
  begin
    for alloc in
      select a.* from sprint_planned_allocations a
      join sprints os on os.id = a.sprint_id
      where os.client_id = p_client_id
        and os.start_date between v_month_start and v_month_end
        and (a.date < os.start_date or a.date > os.end_date)
    loop
      select id into v_target_sprint_id from sprints
        where client_id = p_client_id and alloc.date between start_date and end_date and id <> alloc.sprint_id
        limit 1;

      if v_target_sprint_id is not null then
        select planned_amount into v_existing_amount from sprint_planned_allocations
          where sprint_id = v_target_sprint_id and date = alloc.date;

        if v_existing_amount is null then
          update sprint_planned_allocations set sprint_id = v_target_sprint_id
            where id = alloc.id;
        else
          raise notice '  ATENÇÃO: já existia alocação em % para a sprint destino — valores somados (R$ % + R$ %)',
            alloc.date, v_existing_amount, alloc.planned_amount;
          update sprint_planned_allocations set planned_amount = planned_amount + alloc.planned_amount
            where sprint_id = v_target_sprint_id and date = alloc.date;
          delete from sprint_planned_allocations where id = alloc.id;
        end if;
        v_allocations_moved := v_allocations_moved + 1;
      end if;
    end loop;
  end;
  if v_allocations_moved > 0 then
    raise notice '  alocações realinhadas após conversão de sprint: %', v_allocations_moved;
  end if;

  -- 3b) para cada sprint do cliente que TOCA este mês mas não é um período
  -- canônico exato — blocos antigos que NÃO compartilham start_date com
  -- nenhum período canônico (ex.: bloco 08-14 vs períodos 06-12/13-19: não
  -- foram resolvidos pela conversão em lugar do passo 3a porque o start_date
  -- é diferente de qualquer período do mês), ou qualquer outra sobra de
  -- geração anterior — migra os dados e remove o registro.
  for old_sprint in
    select s.* from sprints s
    where s.client_id = p_client_id
      and s.start_date <= v_month_end and s.end_date >= v_month_start
      and not exists (
        select 1 from compute_month_sprint_periods(p_year, p_month) cp
        where cp.start_date = s.start_date and cp.end_date = s.end_date
      )
  loop
    raise notice '  removendo sprint inválida % (%-%)', old_sprint.id, old_sprint.start_date, old_sprint.end_date;

    -- sprint canônica que contém a data de início do bloco antigo (usada só
    -- pra comentários e gasto manual, que não têm data própria por dia).
    select id into v_canonical_id from sprints s2
      where s2.client_id = p_client_id
        and greatest(old_sprint.start_date, v_month_start) between s2.start_date and s2.end_date
        and s2.id <> old_sprint.id
      limit 1;

    -- tarefas: reatribuídas pelo próprio due_date.
    with moved as (
      update tasks t set sprint_id = ns.id
      from sprints ns
      where t.sprint_id = old_sprint.id
        and ns.client_id = p_client_id
        and ns.id <> old_sprint.id
        and t.due_date between ns.start_date and ns.end_date
      returning t.id
    )
    select count(*) into v_tasks_moved from moved;
    raise notice '    tarefas movidas: %', v_tasks_moved;

    -- alocações de planejado: reatribuídas pela própria date. Se o destino
    -- já tiver uma alocação nessa data (não deveria acontecer hoje, mas é
    -- tratado com segurança), os valores são SOMADOS, nunca sobrescritos —
    -- evita perda e evita dupla contagem silenciosa.
    v_allocations_moved := 0;
    declare
      alloc record;
      v_target_sprint_id uuid;
      v_existing_amount numeric;
    begin
      for alloc in select * from sprint_planned_allocations where sprint_id = old_sprint.id loop
        select id into v_target_sprint_id from sprints
          where client_id = p_client_id and alloc.date between start_date and end_date and id <> old_sprint.id
          limit 1;

        if v_target_sprint_id is not null then
          select planned_amount into v_existing_amount from sprint_planned_allocations
            where sprint_id = v_target_sprint_id and date = alloc.date;

          if v_existing_amount is null then
            update sprint_planned_allocations set sprint_id = v_target_sprint_id
              where id = alloc.id;
          else
            raise notice '    ATENÇÃO: já existia alocação em % para a sprint destino — valores somados (R$ % + R$ %)',
              alloc.date, v_existing_amount, alloc.planned_amount;
            update sprint_planned_allocations set planned_amount = planned_amount + alloc.planned_amount
              where sprint_id = v_target_sprint_id and date = alloc.date;
            delete from sprint_planned_allocations where id = alloc.id;
          end if;
          v_allocations_moved := v_allocations_moved + 1;
        end if;
      end loop;
    end;
    raise notice '    alocações de planejado movidas: %', v_allocations_moved;

    if v_canonical_id is not null then
      -- comentários: aproximação documentada (período que contém o início
      -- do bloco antigo).
      update comments set commentable_id = v_canonical_id
        where commentable_type = 'sprint' and commentable_id = old_sprint.id;

      -- gasto manual: soma no destino (nunca sobrescreve, nunca descarta);
      -- avisa quando o bloco antigo não cabia inteiro no período de destino
      -- (caso em que a atribuição é só uma aproximação e vale revisar à mão
      -- em "Editar gasto real" na página do cliente).
      if old_sprint.spend_source = 'manual' and old_sprint.manual_actual_spend is not null then
        if not exists (
          select 1 from sprints cs
          where cs.id = v_canonical_id
            and old_sprint.start_date >= cs.start_date and old_sprint.end_date <= cs.end_date
        ) then
          raise notice '    ATENÇÃO: gasto manual de R$ % (sprint antiga %-%) não cabia inteiro num único período novo — somado ao período que contém o início; revisar manualmente em "Editar gasto real".',
            old_sprint.manual_actual_spend, old_sprint.start_date, old_sprint.end_date;
        end if;

        update sprints
          set spend_source = 'manual',
              manual_actual_spend = coalesce(manual_actual_spend, 0) + old_sprint.manual_actual_spend,
              manual_spend_updated_at = greatest(manual_spend_updated_at, old_sprint.manual_spend_updated_at)
          where id = v_canonical_id;
      end if;
    end if;

    delete from sprints where id = old_sprint.id;
  end loop;

  -- 3c) recalcula planned_spend de cada sprint deste mês a partir da soma
  -- das alocações (fonte de verdade de sempre).
  update sprints s set planned_spend = coalesce(
    (select sum(planned_amount) from sprint_planned_allocations where sprint_id = s.id), 0
  )
  where s.client_id = p_client_id and s.start_date <= v_month_end and s.end_date >= v_month_start;

  raise notice '--- Fim da reconciliação de % — %-% ---', p_client_id, p_year, p_month;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 4) Roda a reconciliação pra todo cliente/mês com sobreposição detectada
--    hoje (não força conversão de meses históricos sem conflito).
-- ---------------------------------------------------------------------------
create or replace function reconcile_all_client_sprints() returns void as $$
declare
  r record;
begin
  for r in
    select distinct client_id, extract(year from d)::int as yr, extract(month from d)::int as mo
    from sprints, lateral (values (start_date), (end_date)) as t(d)
  loop
    if month_has_sprint_overlap(r.client_id, r.yr, r.mo) then
      perform reconcile_client_month_sprints(r.client_id, r.yr, r.mo);
    end if;
  end loop;
end;
$$ language plpgsql;

select reconcile_all_client_sprints();

-- ---------------------------------------------------------------------------
-- 5) VALIDAÇÃO — confirma que não sobrou sobreposição pra nenhum cliente
--    depois da reconciliação. Se falhar aqui, a migration inteira é
--    revertida (transação implícita do editor SQL) em vez de deixar o
--    banco num estado parcialmente corrigido.
-- ---------------------------------------------------------------------------
create or replace function validate_client_sprint_calendar(p_client_id uuid) returns boolean as $$
declare
  v_overlap_count int;
  v_crossing_count int;
begin
  select count(*) into v_overlap_count
  from sprints a join sprints b on a.client_id = b.client_id and a.id < b.id
  where a.client_id = p_client_id
    and a.start_date <= b.end_date and a.end_date >= b.start_date;

  if v_overlap_count > 0 then
    raise exception 'Cliente % ainda tem % par(es) de sprints sobrepostas depois da reconciliação', p_client_id, v_overlap_count;
  end if;

  select count(*) into v_crossing_count
  from sprints where client_id = p_client_id
    and date_trunc('month', start_date) <> date_trunc('month', end_date);

  if v_crossing_count > 0 then
    raise exception 'Cliente % ainda tem % sprint(s) atravessando a fronteira do mês', p_client_id, v_crossing_count;
  end if;

  return true;
end;
$$ language plpgsql stable;

do $$
declare
  c record;
begin
  for c in select id from clients where deleted_at is null loop
    perform validate_client_sprint_calendar(c.id);
  end loop;
  raise notice 'Validação ok: nenhum cliente tem sprints sobrepostas ou atravessando o mês.';
end $$;

-- ---------------------------------------------------------------------------
-- 6) CONSTRAINT de banco — impede sobreposição fisicamente a partir de
--    agora, pra este tipo de bug nunca mais ser possível mesmo se um código
--    futuro tentar inserir sprints sem passar pela função central. Uma
--    constraint de igualdade exata (unique(client_id, start_date), que já
--    existia) não impede dois intervalos DIFERENTES que se cruzam — por
--    isso a proteção real é uma EXCLUDE constraint sobre o intervalo de
--    datas.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table sprints add column if not exists date_range daterange
  generated always as (daterange(start_date, end_date, '[]')) stored;

alter table sprints drop constraint if exists sprints_no_overlap;
alter table sprints add constraint sprints_no_overlap
  exclude using gist (client_id with =, date_range with &&);

-- ---------------------------------------------------------------------------
-- 7) GERAÇÃO ÚNICA E CONTÍNUA — substitui ensure_weekly_sprints (a versão
--    "corte no fim do mês" já ficava correta em termos de regra, mas o nome
--    e a chamada por render de página são substituídos aqui) por
--    ensure_client_sprints, que usa a mesma compute_month_sprint_periods
--    acima (uma única fonte de verdade, nunca duas regras). generate_sprints_for_month
--    e generate_next_month_sprints (blocos de dia) são REMOVIDAS agora —
--    não só paradas de chamar: elas foram a causa raiz desta rodada, e
--    mantê-las como funções chamáveis é exatamente o risco de "duas regras
--    ativas" que motivou este pedido.
-- ---------------------------------------------------------------------------
create or replace function ensure_client_sprints(p_client_id uuid, p_horizon_months int default 2)
returns void as $$
declare
  v_today date := current_date;
  m int;
  v_target_year int;
  v_target_month int;
  period record;
  v_sprint_id uuid;
  v_existing_end_date date;
begin
  for m in 0..p_horizon_months loop
    v_target_year := extract(year from (date_trunc('month', v_today) + (m || ' months')::interval))::int;
    v_target_month := extract(month from (date_trunc('month', v_today) + (m || ' months')::interval))::int;

    -- Mesma regra de conversão-em-lugar usada em reconcile_client_month_sprints
    -- (passo 3a): busca por start_date, não pelo intervalo exato, e nunca faz
    -- um INSERT que colidiria com unique(client_id, start_date). Uma única
    -- regra de colisão, usada pelas duas únicas funções que criam sprints.
    for period in select * from compute_month_sprint_periods(v_target_year, v_target_month) loop
      v_sprint_id := null;
      v_existing_end_date := null;
      select id, end_date into v_sprint_id, v_existing_end_date from sprints
        where client_id = p_client_id and start_date = period.start_date;

      if v_sprint_id is null then
        insert into sprints (client_id, start_date, end_date, planned_spend)
        values (p_client_id, period.start_date, period.end_date, 0)
        returning id into v_sprint_id;
        perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, period.start_date, period.end_date);
      elsif v_existing_end_date <> period.end_date then
        update sprints set end_date = period.end_date where id = v_sprint_id;
      end if;
    end loop;
  end loop;
end;
$$ language plpgsql;

create or replace function trg_create_initial_sprints() returns trigger as $$
begin
  perform ensure_client_sprints(new.id, 2);
  return new;
end;
$$ language plpgsql;

drop function if exists ensure_weekly_sprints(uuid, date, int);
drop function if exists backfill_weekly_sprints();
drop function if exists generate_next_month_sprints();
drop function if exists generate_sprints_for_month(uuid, int, int);

-- Garante que todo cliente já tenha as sprints canônicas do horizonte de
-- sempre (idempotente, seguro rodar de novo).
do $$
declare
  c record;
begin
  for c in select id from clients where deleted_at is null loop
    perform ensure_client_sprints(c.id, 2);
  end loop;
end $$;
