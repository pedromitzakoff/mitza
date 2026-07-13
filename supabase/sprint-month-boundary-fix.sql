-- Etapa 50 (correção): depois de conversar com o usuário, a regra final é
-- diferente da primeira versão desta etapa. A primeira versão permitia uma
-- sprint atravessar a fronteira do mês (ex.: 27/jul-02/ago numa sprint só),
-- com o financeiro dividido por trás. A regra CORRIGIDA e definitiva é:
--
--   Sprint sempre começa na segunda e termina no domingo — EXCETO quando
--   isso cruzaria a virada do mês. Nesse caso, ela é cortada no último dia
--   do mês (fica com menos de 7 dias) e uma nova sprint começa no dia 1 do
--   mês seguinte (que na maioria das vezes não cai numa segunda-feira) até
--   o domingo original da semana. NENHUMA sprint atravessa o mês.
--
-- Como nenhuma sprint mais atravessa o mês, a divisão financeira por mês
-- (`sprint_manual_spend_by_month`, criada na primeira versão desta etapa)
-- deixa de fazer sentido — toda sprint pertence a exatamente um mês, então
-- o gasto manual de sempre (`manual_actual_spend`, um valor único por
-- sprint) já é suficiente de novo, sem precisar de tabela nova nenhuma.
-- Rode depois de supabase/weekly-sprints.sql.

-- ---------------------------------------------------------------------------
-- Corrige sprints que já foram geradas atravessando o mês (só pode ter
-- acontecido se supabase/weekly-sprints.sql já rodou nesta base, via
-- `ensure_weekly_sprints`/`backfill_weekly_sprints`) — corta cada uma no
-- último dia do mês e cria uma sprint nova pro restante, movendo tarefas e
-- alocações de planejado que pertencem à parte nova pro sprint_id novo.
-- Não apaga nenhum dado: tarefas, comentários e histórico continuam
-- vinculados (só o sprint_id de tarefas/alocações da parte que virou "mês
-- seguinte" é que muda).
-- ---------------------------------------------------------------------------
create or replace function split_cross_month_sprints() returns void as $$
declare
  s record;
  v_month_end date;
  v_new_start date;
  v_new_sprint_id uuid;
begin
  for s in
    select id, client_id, start_date, end_date
    from sprints
    where date_trunc('month', start_date) <> date_trunc('month', end_date)
  loop
    v_month_end := (date_trunc('month', s.start_date) + interval '1 month - 1 day')::date;
    v_new_start := v_month_end + 1;

    insert into sprints (client_id, start_date, end_date, planned_spend, spend_source)
    values (s.client_id, v_new_start, s.end_date, 0, 'meta_api')
    on conflict (client_id, start_date) do nothing
    returning id into v_new_sprint_id;

    if v_new_sprint_id is null then
      -- já existe uma sprint começando em v_new_start (corrida rara com
      -- ensure_weekly_sprints já corrigida) — reaproveita ela.
      select id into v_new_sprint_id from sprints where client_id = s.client_id and start_date = v_new_start;
    end if;

    update sprints set end_date = v_month_end where id = s.id;

    update tasks set sprint_id = v_new_sprint_id
      where sprint_id = s.id and due_date >= v_new_start;

    update sprint_planned_allocations set sprint_id = v_new_sprint_id
      where sprint_id = s.id and date >= v_new_start;

    update sprints set planned_spend = coalesce(
      (select sum(planned_amount) from sprint_planned_allocations where sprint_id = sprints.id), 0
    ) where id in (s.id, v_new_sprint_id);
  end loop;
end;
$$ language plpgsql;

select split_cross_month_sprints();

-- ---------------------------------------------------------------------------
-- ensure_weekly_sprints (redefinida): agora corta a semana no fim do mês
-- quando ela cruzaria a virada, gerando duas sprints em vez de uma —
-- nenhuma sprint nova atravessa o mês daqui pra frente.
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
  v_week_end date;
  v_month_end date;
  v_sprint_id uuid;
begin
  while v_cursor <= v_through loop
    v_week_end := v_cursor + 6;

    if date_trunc('month', v_cursor) <> date_trunc('month', v_week_end) then
      v_month_end := (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date;

      v_sprint_id := null;
      insert into sprints (client_id, start_date, end_date, planned_spend)
      values (p_client_id, v_cursor, v_month_end, 0)
      on conflict (client_id, start_date) do nothing
      returning id into v_sprint_id;
      if v_sprint_id is not null then
        perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, v_cursor, v_month_end);
      end if;

      v_sprint_id := null;
      insert into sprints (client_id, start_date, end_date, planned_spend)
      values (p_client_id, v_month_end + 1, v_week_end, 0)
      on conflict (client_id, start_date) do nothing
      returning id into v_sprint_id;
      if v_sprint_id is not null then
        perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, v_month_end + 1, v_week_end);
      end if;
    else
      v_sprint_id := null;
      insert into sprints (client_id, start_date, end_date, planned_spend)
      values (p_client_id, v_cursor, v_week_end, 0)
      on conflict (client_id, start_date) do nothing
      returning id into v_sprint_id;
      if v_sprint_id is not null then
        perform generate_sprint_tasks_from_templates(p_client_id, v_sprint_id, v_cursor, v_week_end);
      end if;
    end if;

    v_cursor := v_cursor + 7;
  end loop;
end;
$$ language plpgsql;

-- Garante que todo cliente já tenha as sprints corrigidas (sem cruzar mês)
-- pro horizonte de sempre.
select backfill_weekly_sprints();

-- ---------------------------------------------------------------------------
-- sprint_manual_spend_by_month deixou de fazer sentido: como nenhuma sprint
-- mais atravessa o mês, toda sprint pertence a exatamente um mês, então o
-- gasto manual único de sempre (`sprints.manual_actual_spend`) já é
-- suficiente. Não havia nenhum caminho de escrita implementado pra essa
-- tabela ainda (ficou documentado como pendente na primeira versão desta
-- etapa), então não há dado real pra perder.
-- ---------------------------------------------------------------------------
drop table if exists sprint_manual_spend_by_month;
