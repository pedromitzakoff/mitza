-- Métrica secundária "Carrinhos" (add-to-cart) — pedido explícito do
-- usuário: adicionou uma coluna de carrinhos no Stract (Leonardo Darcadia,
-- fonte "Nonnina") e quer usá-la SÓ pra calcular "Taxa de conversão"
-- (carrinho → venda), nunca como um objetivo (`performance_goal`) próprio —
-- o objetivo do cliente continua sendo 'sales', carrinho nunca vira meta
-- nem aparece em `client_goals`.
--
-- Novo goal/result_type 'carts', aditivo (mesmo padrão de
-- stract-no-data-signal.sql pra ampliar um check existente): a camada de
-- importação (`lib/stract-sync.ts`) já escreve UMA linha de
-- `daily_performance` por `goal` presente em `metric_mappings`, sem
-- restrição de valor no nível de conta — o mapeamento pra 'carts' passa a
-- fluir sem nenhuma mudança de código lá. Os agregados por campanha/público/
-- criativo (`campaign_daily_metrics`/`ad_set_daily_metrics`/
-- `ad_creative_daily_metrics`) já têm guarda explícita "leads/sales apenas"
-- e continuam ignorando 'carts' automaticamente nesses níveis — carrinho só
-- existe no nível de conta.
--
-- Rode depois de supabase/stract-no-data-signal.sql.

alter table metric_mappings drop constraint if exists metric_mappings_goal_check;
alter table metric_mappings add constraint metric_mappings_goal_check
  check (goal in ('leads', 'sales', 'followers', 'carts'));

alter table daily_performance drop constraint if exists daily_performance_result_type_check;
alter table daily_performance add constraint daily_performance_result_type_check
  check (result_type in ('leads', 'sales', 'followers', 'carts'));

comment on column metric_mappings.goal is
  'Objetivo que esta coluna representa (leads/sales/followers) OU carts — carrinho é sempre uma métrica SECUNDÁRIA (nunca um performance_goal de cliente), usada só pra calcular Taxa de conversão (vendas ÷ carrinhos).';

comment on column daily_performance.result_type is
  'Tipo de resultado da linha (leads/sales/followers) OU carts — carrinho nunca é um objetivo (client.performance_goal), só alimenta o cálculo de Taxa de conversão.';
