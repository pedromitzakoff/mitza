-- Atalho externo pra planilha de fechamento mensal do cliente — mesmo
-- padrão de `dashboard_url`/`balance_url` (client-identity.sql): 1 coluna
-- opcional em `clients`, sem lógica nenhuma além de "guardar um link".
-- Nenhuma coluna existente é alterada.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste
-- projeto que altera schema já em produção.

alter table clients
  add column if not exists monthly_closing_sheet_url text;
