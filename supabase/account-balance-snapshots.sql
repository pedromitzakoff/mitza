-- KOFF Analytics — Histórico diário de saldo das contas Meta pré-pagas
-- (pedido do usuário: "toda segunda e sexta quero saber quanto tem de saldo
-- na conta"). Até aqui o saldo nunca era persistido: o avaliador do alerta
-- "Saldo esgotando" (`src/lib/alerts/evaluate-balance-depletion.ts`)
-- consultava a Graph API e só gravava algo quando o alerta disparava, então
-- não havia como listar o saldo de TODAS as contas. Esta tabela guarda uma
-- foto por cliente por dia (a última leitura do dia sobrescreve a anterior).
--
-- Só contas PRÉ-PAGAS com gasto ontem entram (mesmo filtro do avaliador):
-- conta pós-paga não tem saldo disponível pra mostrar.

create table if not exists account_balance_snapshots (
  client_id uuid not null references clients(id),
  snapshot_date date not null,
  ad_account_id text not null,
  balance numeric not null,
  currency text not null,
  daily_spend_yesterday numeric,
  fetched_at timestamptz not null default now(),
  primary key (client_id, snapshot_date)
);

comment on table account_balance_snapshots is
  'Uma linha por cliente+dia — saldo pré-pago disponível na conta Meta, lido pelo avaliador do alerta "Saldo esgotando". A última leitura do dia sobrescreve a anterior. Só contas pré-pagas com gasto no dia anterior.';

alter table account_balance_snapshots enable row level security;

create policy account_balance_snapshots_select on account_balance_snapshots
  for select using (is_admin() or is_client_manager(client_id));

create policy account_balance_snapshots_write on account_balance_snapshots
  for all using (is_admin()) with check (is_admin());
