-- Google Ads manual multicanal (Stage 2) — receita manual opcional em
-- performance_records, mesmo padrão de daily_performance.revenue
-- (supabase/stract-revenue.sql): coluna nullable na MESMA linha do
-- resultado (nunca uma tabela irmã), só populada quando o gestor
-- efetivamente informar — NUNCA fabricada/estimada. NULL para
-- leads/seguidores sempre; para vendas, NULL até o gestor lançar o valor.
alter table performance_records
  add column if not exists revenue numeric(12, 2);

comment on column performance_records.revenue is
  'Receita informada manualmente pelo gestor (opcional) — nunca fabricada/estimada. NULL = gestor não informou receita para este lançamento.';
