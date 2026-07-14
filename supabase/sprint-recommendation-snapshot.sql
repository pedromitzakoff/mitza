-- Etapa 70: nova camada de planejamento original + recomendação dinâmica por
-- sprint, e congelamento (snapshot) financeiro no momento em que uma sprint
-- encerra.
--
-- Não substitui nada da lógica mensal (orçamento vigente, esperado até hoje,
-- saldo restante, investimento diário recomendado) — só adiciona, por
-- sprint, os 3 valores que precisam ficar imutáveis depois que ela encerra:
--
--   original_planned_amount  — quanto o orçamento mensal, distribuído
--                               proporcionalmente por todos os dias do mês,
--                               destinava a esta sprint.
--   final_recommended_amount — quanto era a recomendação atual total desta
--                               sprint no momento em que ela deixou de ser
--                               "atual" (null quando nunca existiu orçamento
--                               configurado enquanto a sprint ainda estava
--                               aberta — nunca inventado retroativamente).
--   final_actual_amount      — o realizado final da sprint (sempre
--                               conhecido; nunca null).
--   snapshot_frozen_at       — quando o congelamento aconteceu; controla a
--                               imutabilidade (enquanto for null, a
--                               aplicação pode recalcular e regravar; a
--                               partir do momento em que for preenchido,
--                               nenhuma leitura futura escreve nestas
--                               colunas de novo — ver `ensureClosedSprintSnapshots`
--                               em src/lib/sprint-snapshot.ts).
--
-- Sprint atual/futura NÃO usam estas colunas pra exibição — o "planejamento
-- original" delas continua sendo recalculado ao vivo (pode mudar se o
-- orçamento mensal mudar, ver seção 15 do pedido original), e a
-- "recomendação atual"/"restante recomendado" delas já vêm de
-- computeMonthlyBudgetPlan/computeSprintInvestmentAmounts (inalterados).
--
-- Idempotente: `add column if not exists` nunca falha se já tiver rodado.
-- Compatível com dados existentes: as 4 colunas nascem `null` pra toda
-- sprint já existente — nenhum backfill em massa é necessário nem
-- executado aqui; o congelamento acontece sozinho, de forma preguiçosa, na
-- primeira leitura de cada sprint já encerrada (`ensureClosedSprintSnapshots`),
-- sem exigir nenhuma migração de dados além de adicionar as colunas.

alter table sprints
  add column if not exists original_planned_amount numeric(12, 2),
  add column if not exists final_recommended_amount numeric(12, 2),
  add column if not exists final_actual_amount numeric(12, 2),
  add column if not exists snapshot_frozen_at timestamptz;

comment on column sprints.original_planned_amount is
  'Planejamento original desta sprint: orçamento mensal vigente distribuído proporcionalmente por todos os dias do mês. Congelado (imutável) só depois que snapshot_frozen_at é preenchido; até lá, pode ser recalculado ao vivo se o orçamento mensal mudar.';
comment on column sprints.final_recommended_amount is
  'Recomendação atual total desta sprint no momento exato em que ela deixou de ser "atual" (realizado da sprint + recomendação restante calculada com o orçamento vigente naquele momento). Null quando nenhum orçamento mensal existia enquanto a sprint ainda estava aberta — nunca inventado retroativamente.';
comment on column sprints.final_actual_amount is
  'Realizado final da sprint, congelado no momento do encerramento — mesmo valor que computeSprintEffectiveSpend já calculava, só persistido pra nunca mais depender de recálculo depois que a sprint fecha.';
comment on column sprints.snapshot_frozen_at is
  'Quando o congelamento financeiro desta sprint aconteceu (null = sprint ainda não foi observada como encerrada, ou ainda não tinha orçamento suficiente pra congelar). Gate de imutabilidade: uma vez preenchido, nenhuma leitura futura regrava original_planned_amount/final_recommended_amount/final_actual_amount desta sprint.';
