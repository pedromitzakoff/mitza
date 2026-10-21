-- KOFF Analytics Fase 2, Etapa 2.4 — pedido explícito do usuário: "cliques
-- no link", "CTR do link" e "CPC do link" como métricas próprias, distintas
-- de "cliques totais"/CTR/CPC gerais (que já existem e continuam sobre
-- `clicks`, nunca trocados por esta coluna). `inline_link_clicks` é o campo
-- da Graph API especificamente sobre clique no link/CTA de destino
-- (`docs/META_ADS_DASHBOARD_METRICS_GAP_ANALYSIS.md`, Gap A).
--
-- Aditivo e não-destrutivo: só adiciona coluna, nunca remove/renomeia nada
-- existente. `clicks` continua vivo e com o mesmo significado de sempre.
--
-- Limitação de histórico (pedido do usuário: "apresente claramente
-- eventuais limitações de histórico"): linhas já gravadas ANTES desta
-- migração nunca terão `link_clicks` preenchido retroativamente — a coluna
-- nasce `null` pra todo dado existente, e só passa a ser preenchida a
-- partir da primeira sincronização (direta Meta API) que rodar depois
-- desta migração. A UI (`lib/meta-ads-dashboard/dashboard-data.ts`) trata
-- isso como ausência de dado, nunca como zero. Fontes Stract continuam sem
-- esse campo até que uma coluna equivalente seja configurada na extração
-- (fora do escopo desta etapa) — `link_clicks` nasce `null` pra elas também,
-- sempre.
--
-- `ad_creative_daily_metrics` tem a MESMA coluna pela mesma razão
-- (Campanhas/Públicos/Criativos mostram as mesmas 3 métricas de link no
-- novo painel de exploração, Etapa 2.4). `campaign_placement_daily_metrics`
-- NUNCA ganha esta coluna — essa tabela já não tem impressions/reach/clicks
-- hoje (limitação conhecida e documentada), fora do escopo desta extensão.

alter table campaign_daily_metrics add column if not exists link_clicks integer;
alter table ad_set_daily_metrics add column if not exists link_clicks integer;
alter table ad_creative_daily_metrics add column if not exists link_clicks integer;

comment on column campaign_daily_metrics.link_clicks is
  'Cliques especificamente no link/CTA de destino do anúncio (campo `inline_link_clicks` da Graph API) — DISTINTO de `clicks` (todos os cliques no anúncio, incluindo curtidas/compartilhamentos/visitas ao perfil em alguns contextos). `null` em linhas gravadas antes desta coluna existir, ou em fontes (Stract) sem esse campo configurado na extração — nunca 0 fabricado.';
comment on column ad_set_daily_metrics.link_clicks is
  'Mesmo significado de campaign_daily_metrics.link_clicks, na granularidade de conjunto de anúncios.';
comment on column ad_creative_daily_metrics.link_clicks is
  'Mesmo significado de campaign_daily_metrics.link_clicks, na granularidade de criativo/anúncio.';
