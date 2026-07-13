-- Etapa 60: Integração Meta — gasto diário (fase 1). NÃO EXECUTAR sem
-- aprovação — ver auditoria entregue junto com este arquivo.
--
-- daily_spend já tinha exatamente o schema necessário (client_id, date,
-- spend, synced_at, unique(client_id, date)) desde a Etapa 1 — nenhuma
-- mudança nessa tabela. A única lacuna real é `clients.meta_ad_account_id`:
-- hoje é `not null` com um check rígido exigindo literalmente o prefixo
-- "act_", o que obriga todo cliente a ter uma conta Meta configurada. Esta
-- migration só relaxa essa exigência — clientes sem conta configurada
-- passam a ser simplesmente ignorados pela sincronização (feito no código,
-- ver lib/meta-sync.ts), em vez de exigirem um valor placeholder pra
-- satisfazer o schema.
--
-- Não apaga nem migra nenhum dado: todo cliente já existente já tem um
-- valor que satisfaz o check antigo (mais restrito), então
-- automaticamente satisfaz o novo (mais permissivo). Nenhum backfill.

alter table clients alter column meta_ad_account_id drop not null;

alter table clients drop constraint if exists clients_meta_ad_account_id_check;
alter table clients add constraint clients_meta_ad_account_id_check
  check (meta_ad_account_id is null or meta_ad_account_id ~ '^act_[0-9]+$');
