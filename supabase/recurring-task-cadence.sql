-- Revisão da arquitetura das tarefas recorrentes (decisão do usuário): a
-- "próxima execução" continua sendo SEMPRE calculada (nunca uma data
-- gravada), mas o cálculo deixa de assumir que toda recorrência distribui
-- livremente pelos 5 dias úteis. Cada PROCESSO da agência tem uma cadência
-- operacional própria — o sistema já nasce sabendo o ritmo recomendado,
-- o gestor não configura isso.
--
-- Explicitamente NÃO é uma configuração exposta ao admin em
-- /settings/recurring-tasks (mesmo espírito de `uses_account_review`, ver
-- supabase/recurring-tasks.sql): cadência é método operacional da agência,
-- provisionada aqui, via SQL direto, não um campo de formulário. Uma
-- recorrência nova criada pela interface nasce sempre `automatic` (default),
-- e só vira `fixed_days` se alguém rodar um UPDATE manual — pensado pra
-- permitir, no futuro, um override por cliente/recorrência específica sem
-- mudar o modelo de novo.
--
-- Rode depois de supabase/recurring-tasks.sql e ANTES de
-- supabase/seed-official-recurring-tasks.sql (que já assume estas colunas
-- pra semear as 3 recorrências oficiais com a cadência certa).

alter table recurring_tasks
  add column if not exists cadence_mode text not null default 'automatic',
  add column if not exists fixed_weekdays smallint[] not null default '{}'::smallint[];

alter table recurring_tasks drop constraint if exists recurring_tasks_cadence_mode_check;
alter table recurring_tasks add constraint recurring_tasks_cadence_mode_check check (cadence_mode in ('automatic', 'fixed_days'));

-- `fixed_days` sem nenhum dia marcado não faz sentido (não sobra o que
-- calcular); `automatic` com dias marcados também não (o campo seria
-- ignorado silenciosamente) — mesmo princípio de defesa em profundidade de
-- `uses_account_review`/`has_checklist` em supabase/recurring-tasks.sql.
alter table recurring_tasks drop constraint if exists recurring_tasks_fixed_weekdays_check;
alter table recurring_tasks add constraint recurring_tasks_fixed_weekdays_check check (
  (cadence_mode = 'automatic' and fixed_weekdays = '{}'::smallint[])
  or (cadence_mode = 'fixed_days' and array_length(fixed_weekdays, 1) > 0)
);

-- ---------------------------------------------------------------------------
-- Cadências oficiais (decisão do usuário): Checar saldo — segunda e quinta
-- (garantir que a conta começou bem a semana e evitar problema perto do fim
-- de semana); Reportar cliente — terça (segunda é dia operacional, terça já
-- dá tempo de analisar a conta antes de reportar e ainda sobra semana pra
-- agir sobre o feedback do cliente); Otimização segue `automatic` (depende
-- do comportamento da conta, não de calendário — nenhum UPDATE necessário,
-- é o default). Sem efeito se as recorrências ainda não existirem (rode
-- depois de supabase/seed-official-recurring-tasks.sql nesse caso, ou rode
-- este UPDATE de novo depois).
-- ---------------------------------------------------------------------------
update recurring_tasks set cadence_mode = 'fixed_days', fixed_weekdays = array[1, 4]::smallint[] where title = 'Checar saldo';
update recurring_tasks set cadence_mode = 'fixed_days', fixed_weekdays = array[2]::smallint[] where title = 'Reportar cliente';
