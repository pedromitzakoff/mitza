-- Integração Stract (ver docs/STRACT_INTEGRATION_ARCHITECTURE.md) — backfill
-- automático de Sprints históricas.
--
-- Achado na validação: dados importados de meses anteriores à existência do
-- cliente na MITZA não apareciam em nenhuma tela (Dashboard/Sprint/
-- Relatórios), porque um mês só é exibido se existir uma Sprint cadastrada
-- pra aquele período — Sprints nunca são geradas retroativamente por padrão
-- (`ensure_client_sprints` só olha pra frente, a partir de hoje).
--
-- Esta função reaproveita a MESMA regra de cálculo de período já usada por
-- `ensure_client_sprints` (`compute_month_sprint_periods`) e o MESMO padrão
-- de detecção de colisão (busca por start_date, nunca duplica), mas cobre
-- um intervalo arbitrário no passado — chamada automaticamente pelo Import
-- Service (`lib/stract-sync.ts`) a cada sincronização, cobrindo o intervalo
-- de datas que a própria extração trouxe. Assim, qualquer cliente novo
-- conectado ao Stract já ganha o histórico inteiro visível, sem precisar de
-- um script manual por cliente (como foi feito manualmente a primeira vez,
-- pro cliente de teste).
--
-- Deliberadamente NÃO gera tarefas-template (`generate_sprint_tasks_from_templates`)
-- nem planejamento (`planned_spend = 0`) — Sprint de backfill histórico
-- nunca representa um período realmente gerido pela agência, então não faz
-- sentido fabricar pendência nem meta pra ele.
create or replace function ensure_client_sprints_for_range(p_client_id uuid, p_start_date date, p_end_date date)
returns void as $$
declare
  v_month date := date_trunc('month', p_start_date)::date;
  period record;
  v_sprint_id uuid;
  v_existing_end_date date;
begin
  while v_month <= p_end_date loop
    for period in select * from compute_month_sprint_periods(extract(year from v_month)::int, extract(month from v_month)::int) loop
      v_sprint_id := null;
      v_existing_end_date := null;
      select id, end_date into v_sprint_id, v_existing_end_date from sprints
        where client_id = p_client_id and start_date = period.start_date;

      if v_sprint_id is null then
        insert into sprints (client_id, start_date, end_date, planned_spend)
        values (p_client_id, period.start_date, period.end_date, 0);
      elsif v_existing_end_date <> period.end_date then
        update sprints set end_date = period.end_date where id = v_sprint_id;
      end if;
    end loop;

    v_month := (v_month + interval '1 month')::date;
  end loop;
end;
$$ language plpgsql;

comment on function ensure_client_sprints_for_range is
  'Backfill de Sprints históricas de um cliente cobrindo p_start_date..p_end_date (por mês) — mesma regra de compute_month_sprint_periods já usada por ensure_client_sprints, sem gerar tarefas-template nem planejamento (planned_spend=0). Chamada automaticamente pelo Import Service do Stract antes de gravar dados diários, garantindo que qualquer intervalo importado sempre tenha onde aparecer no Dashboard/Sprint/Relatórios — nenhum script manual por cliente é mais necessário.';
