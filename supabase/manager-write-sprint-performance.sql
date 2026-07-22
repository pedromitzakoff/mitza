-- Habilita o gestor responsável por um cliente a usar "Atualizar
-- performance" na sprint (investimento realizado em
-- sprints.manual_actual_spend/spend_source + resultados em
-- performance_records) — hoje restrito a admin
-- (updateSprintPerformanceAction, src/app/clients/performance-actions.ts).
-- Sem isso o gestor não consegue registrar o próprio trabalho no dia a dia.
--
-- Escopo deliberadamente estreito:
--   1. Só o gestor responsável pelo cliente (is_client_manager), nunca
--      qualquer gestor em qualquer cliente.
--   2. Em `sprints`, o gestor só pode alterar as 3 colunas de execução que
--      updateSprintPerformanceAction de fato escreve (manual_actual_spend/
--      spend_source/manual_spend_updated_at) — planejamento (planned_spend,
--      datas, snapshots de recomendação) continua admin-only, conforme já
--      documentado no schema ("planned_spend só é editável pelo admin —
--      spec do produto"). O trigger abaixo barra qualquer tentativa de
--      alterar essas colunas fora de uma sessão admin, mesmo que alguém
--      chame a tabela diretamente (não só pela Server Action).
--   3. Criar/excluir sprint continua exclusivamente admin — a geração real
--      é sempre automática, via /api/cron/ensure-sprints (client
--      administrativo, ignora RLS).
--   4. `performance_records` não tem uma coluna equivalente a
--      "planejamento" — o registro inteiro (investimento não faz parte
--      desta tabela) é dado de execução, então a mesma regra de linha
--      (is_admin() ou is_client_manager) já é suficiente, sem trigger.
--
-- Rode depois de supabase/performance-tracking.sql.

drop policy if exists sprints_write on sprints;

create policy sprints_insert on sprints
  for insert with check (is_admin());

create policy sprints_delete on sprints
  for delete using (is_admin());

create policy sprints_update on sprints
  for update using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

create or replace function guard_sprint_manager_update() returns trigger as $$
begin
  if is_admin() then
    return new;
  end if;

  if new.client_id is distinct from old.client_id
    or new.start_date is distinct from old.start_date
    or new.end_date is distinct from old.end_date
    or new.planned_spend is distinct from old.planned_spend
    or new.original_planned_amount is distinct from old.original_planned_amount
    or new.final_recommended_amount is distinct from old.final_recommended_amount
    or new.final_actual_amount is distinct from old.final_actual_amount
    or new.snapshot_frozen_at is distinct from old.snapshot_frozen_at
  then
    raise exception 'Somente admin pode alterar planejamento ou período da sprint.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists sprints_guard_manager_update on sprints;
create trigger sprints_guard_manager_update
  before update on sprints
  for each row execute function guard_sprint_manager_update();

drop policy if exists performance_records_write on performance_records;
create policy performance_records_write on performance_records
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));
