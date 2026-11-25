-- KOFF Analytics — Histórico de saldo passa a registrar também contas
-- PÓS-PAGAS (pedido do usuário: "pode mostrar as que são pós-pagas também e
-- fala que tá no pós-pago, porque se mudar eu preciso saber"). Conta
-- pós-paga não tem saldo disponível: grava `is_prepay = false` com
-- `balance`/`currency` nulos. Linhas antigas são todas pré-pagas (default
-- true), nada muda nelas.
alter table account_balance_snapshots add column if not exists is_prepay boolean not null default true;
alter table account_balance_snapshots alter column balance drop not null;
alter table account_balance_snapshots alter column currency drop not null;
alter table account_balance_snapshots drop constraint if exists account_balance_snapshots_prepay_balance_check;
alter table account_balance_snapshots add constraint account_balance_snapshots_prepay_balance_check
  check ((is_prepay and balance is not null and currency is not null) or (not is_prepay and balance is null));

comment on table account_balance_snapshots is
  'Uma linha por cliente+dia — saldo pré-pago disponível na conta Meta (is_prepay = true) ou registro de que a conta é pós-paga (is_prepay = false, sem saldo), lido pelo avaliador do alerta "Saldo esgotando". A última leitura do dia sobrescreve a anterior. Só contas com gasto no dia anterior.';
