-- Etapa "Catálogo de métricas do Dashboard" — uma coluna aditiva, nada de
-- tabela nova. Decide só QUAIS cards/colunas aparecem na apresentação;
-- nunca decide qual evento da Meta conta pra cada objetivo (isso continua
-- sendo só `metric_mappings`, nunca unificado aqui) nem participa do
-- Planejamento de Metas (`client_goals`/`is_primary`, intocados).
--
-- Array vazio (`'{}'`, o default) é um estado real e esperado — "este
-- cliente ainda não configurou a seleção nova" — NUNCA interpretado como
-- "nenhuma métrica". `resolveEffectiveDashboardMetrics`
-- (`src/lib/dashboard-metrics.ts`) é quem decide o que mostrar nesse caso
-- (deriva de `clients.performance_goal`, preservando a experiência atual
-- de cada cliente até alguém abrir "Métricas exibidas" e escolher de
-- propósito) — nunca um backfill escrito linha a linha aqui.
--
-- JÁ EXECUTADA em produção (rodada manualmente antes deste arquivo existir
-- — mantido aqui só para registro/histórico, mesmo padrão de toda
-- migration deste projeto). Idempotente (`if not exists`) — rodar de novo
-- não tem efeito.

alter table clients add column if not exists dashboard_metrics text[] not null default '{}';

comment on column clients.dashboard_metrics is
  'Quais cards/colunas de métrica aparecem pra este cliente (catálogo fixo em src/lib/dashboard-metrics.ts) — nunca decide qual evento da Meta conta (metric_mappings) nem participa do Planejamento (client_goals/is_primary). Vazio = cliente ainda não configurou; a apresentação deriva de performance_goal nesse caso (ver resolveEffectiveDashboardMetrics), nunca mostra "nada".';
