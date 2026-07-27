-- Etapa "Objetivo Seguidores": terceiro valor de `performance_goal`
-- ("followers", ao lado de "leads"/"sales" já existentes) — contas cujo KPI
-- principal é crescimento de audiência. Nenhuma tabela/coluna nova: só as 2
-- constraints de check que hoje travam os valores em ('leads', 'sales')
-- precisam abrir espaço pro terceiro.
--
-- NÃO EXECUTAR sem aprovação — rodar manualmente no SQL Editor do Supabase
-- (mesmo padrão de toda migration deste projeto que altera schema já em
-- produção).

alter table clients drop constraint if exists clients_performance_goal_check;
alter table clients
  add constraint clients_performance_goal_check
  check (performance_goal in ('leads', 'sales', 'followers'));

alter table performance_records drop constraint if exists performance_records_result_type_check;
alter table performance_records
  add constraint performance_records_result_type_check
  check (result_type in ('leads', 'sales', 'followers'));

comment on column clients.performance_goal is
  'Objetivo estruturado de performance do cliente ("leads"|"sales"|"followers"), distinto de main_objective (campo textual de contexto estratégico). Null = objetivo ainda não configurado (nunca inventado retroativamente); exigido na criação de clientes novos pela camada de aplicação.';
comment on column performance_records.result_type is
  'Tipo do resultado REALMENTE registrado no momento do lançamento — preservado historicamente mesmo que o performance_goal atual do cliente mude depois (nunca convertido/reescrito). "followers" adicionado na Etapa "Objetivo Seguidores".';
