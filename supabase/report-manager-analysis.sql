-- Etapa 51: reorganização Cliente x Relatório — dois blocos que faltavam no
-- Relatório e ainda estavam misturados: "Análise do Gestor" (retrospectiva
-- do mês: o que funcionou, o que não funcionou, problemas, oportunidades,
-- aprendizados) era inexistente — os campos existentes (next_month_*) são
-- só prospectivos (Bloco "Próximos Passos"), nunca uma leitura do que já
-- aconteceu. "Pendências" (item com responsável/prazo/status) já existia
-- como `report_action_items`, mas ficava dentro da seção "Próximo mês",
-- misturado com os campos narrativos — o pedido exige separar Pendências
-- (execução em aberto) de Próximos Passos (síntese estratégica).
-- Rode depois de supabase/sprint-calendar-reconciliation.sql.

-- ---------------------------------------------------------------------------
-- Bloco 6 — Análise do Gestor: 5 campos estruturados, todos opcionais,
-- editáveis igual aos next_month_* já existentes (mesma action genérica
-- updateReportFieldsAction). Aditivo — nenhuma coluna existente muda.
-- ---------------------------------------------------------------------------
alter table monthly_reports add column if not exists analysis_what_worked text;
alter table monthly_reports add column if not exists analysis_what_didnt_work text;
alter table monthly_reports add column if not exists analysis_problems text;
alter table monthly_reports add column if not exists analysis_opportunities text;
alter table monthly_reports add column if not exists analysis_learnings text;

-- ---------------------------------------------------------------------------
-- Bloco 7 — Pendências: `report_action_items` ganha `title` (curto, exibido
-- em destaque) e `dependency` (de quem depende resolver) — os únicos dois
-- campos do pedido que a tabela ainda não tinha. `description` continua
-- obrigatória (detalhe da pendência); `title` é opcional pra não quebrar
-- pendências já cadastradas sem título.
-- ---------------------------------------------------------------------------
alter table report_action_items add column if not exists title text;
alter table report_action_items add column if not exists dependency text
  check (dependency is null or dependency in ('agencia', 'cliente', 'terceiro'));
