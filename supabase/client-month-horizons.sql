-- Etapa "Horizonte de Planejamento" — planejamento mensal continua sendo
-- mensal, mas cada cliente+mês pode ter um horizonte operacional MENOR que
-- o fim do mês (cliente de evento: campanha termina antes do dia 31).
-- `planning_end_date = null` (padrão, todo cliente existente) = comportamento
-- idêntico a hoje. Nunca por canal — Meta e Google do mesmo cliente/mês
-- SEMPRE compartilham o mesmo horizonte (por isso não vive em
-- `monthly_budget_changes`, que é por canal).
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção.

create table if not exists client_month_horizons (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  month date not null,
  -- Quando preenchida, precisa cair dentro do próprio mês do registro —
  -- este campo representa "quando a operação DESTE mês termina", nunca uma
  -- data de outro mês (isso seria erro de cadastro, não um horizonte válido).
  planning_end_date date check (planning_end_date is null or (planning_end_date >= month and planning_end_date < (month + interval '1 month'))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, month)
);

create index if not exists client_month_horizons_client_month_idx on client_month_horizons (client_id, month);

create or replace function set_client_month_horizons_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_month_horizons_set_updated_at on client_month_horizons;
create trigger client_month_horizons_set_updated_at
  before update on client_month_horizons
  for each row execute function set_client_month_horizons_updated_at();

comment on table client_month_horizons is
  'Horizonte operacional de um cliente NUM MÊS específico — uma linha por (client_id, month). planning_end_date null = comportamento padrão (até o fim do mês); preenchida = a operação termina antes (evento, lançamento, campanha sazonal etc.). Nunca por canal: Meta e Google do mesmo cliente/mês sempre leem a mesma linha. Consumido só via resolvePlanningHorizon (lib/monthly-budget.ts) — nenhum cálculo verifica esta tabela diretamente.';
comment on column client_month_horizons.month is 'Primeiro dia do mês (YYYY-MM-01) a que este horizonte se refere.';
comment on column client_month_horizons.planning_end_date is
  'Último dia operacional deste mês pra este cliente — null = até o fim do mês (padrão). effectivePlanningEnd = min(fim do mês, planning_end_date). Nunca uma data de início: a plataforma sempre assume que a operação já está em andamento desde o primeiro dia do mês.';

alter table client_month_horizons enable row level security;

-- Mesmo padrão de monthly_budget_changes: leitura ampla (admin ou gestor do
-- cliente), escrita restrita a admin (o editor de planejamento por canal é
-- admin-only na aplicação).
create policy client_month_horizons_select on client_month_horizons
  for select using (is_admin() or is_client_manager(client_id));

create policy client_month_horizons_write on client_month_horizons
  for all using (is_admin()) with check (is_admin());
