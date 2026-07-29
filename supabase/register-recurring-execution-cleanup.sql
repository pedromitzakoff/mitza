-- Corrige o erro "Não foi possível escolher a melhor função candidata entre
-- public.register_recurring_execution(...) / public.register_recurring_execution(...)".
--
-- Causa raiz: `register_recurring_execution` foi redefinida 3 vezes ao longo
-- do projeto —
--   1. supabase/recurring-tasks.sql                       (7 parâmetros)
--   2. supabase/recurring-task-optimization-refactor.sql  (8 parâmetros — +p_optimization_selections)
--   3. supabase/client-reports.sql                        (9 parâmetros — +p_client_report_id, a versão vigente)
--
-- `create or replace function` só substitui uma função quando a lista de
-- parâmetros é IDÊNTICA (mesmos tipos, mesma ordem) — como cada versão
-- ACRESCENTOU um parâmetro novo, o Postgres nunca substituiu a anterior, só
-- foi empilhando overloads distintas com o mesmo nome. Qualquer chamada que
-- omita um parâmetro com default (ex.: `p_client_report_id`, sempre opcional)
-- passa a ter mais de uma função candidata válida — a antiga (que nem tem
-- esse parâmetro) e a atual (que tem, com default null) — e o Postgres não
-- consegue decidir sozinho, é aí que aparece o erro de ambiguidade.
--
-- Fix: remover explicitamente as duas assinaturas antigas por `drop function`
-- (identificadas pelos TIPOS dos parâmetros, não pelos nomes — é assim que o
-- Postgres diferencia overloads), deixando só a versão de 9 parâmetros
-- (supabase/client-reports.sql) como a única `register_recurring_execution`
-- no banco. Rode depois de supabase/client-reports.sql.

drop function if exists register_recurring_execution(
  uuid, uuid, uuid, uuid, text, text[], text
);

drop function if exists register_recurring_execution(
  uuid, uuid, uuid, uuid, text, text[], jsonb, text
);
