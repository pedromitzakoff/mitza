-- Integração Stract (ver docs/STRACT_INTEGRATION_ARCHITECTURE.md) — evolução
-- Receita/ROAS/Ticket Médio.
--
-- Decisão de arquitetura (revisada e aprovada): NÃO criar uma tabela irmã
-- `daily_revenue`. Receita é o MESMO evento do resultado de vendas (uma
-- compra), só medido em outra unidade — vem da mesma linha da fonte, mesmo
-- dia, mesmo canal, mesmo `result_type`. Criar uma tabela própria duplicaria
-- a granularidade de `daily_performance` e exigiria JOIN em toda leitura de
-- ROAS/Ticket Médio. Em vez disso, `revenue` é uma coluna nullable na MESMA
-- linha: nunca populada pra leads/seguidores (nenhum metric_mapping desses
-- objetivos tem value_column configurado), sem precisar de nenhum
-- `if (goal === 'sales')` espalhado pelo código.
alter table daily_performance
  add column if not exists revenue numeric(12, 2);

comment on column daily_performance.revenue is
  'Faturamento do dia (mesmo evento do result_count, medido em dinheiro) — só populado quando o metric_mapping do objetivo tiver value_column configurado (hoje, só faz sentido pra goal=''sales''). NULL pra leads/seguidores, sempre. Nunca ROAS/Ticket Médio armazenado — sempre derivado (receita ÷ investimento / receita ÷ vendas), calculado na camada de domínio (lib/performance.ts).';

-- Trava a própria regra do produto no banco, não só por convenção: um
-- value_column só faz sentido pra objetivo de vendas.
alter table metric_mappings drop constraint if exists metric_mappings_value_column_only_for_sales;
alter table metric_mappings
  add constraint metric_mappings_value_column_only_for_sales
  check (value_column is null or goal = 'sales');
