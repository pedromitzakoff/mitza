-- Módulo de Criativos — ajuste do usuário: preparar a arquitetura pra
-- exibição futura de thumbnails, sem implementar scraping/download/cache de
-- mídia nesta etapa. Só reserva a coluna; hoje ela chega sempre NULL (nenhum
-- mecanismo de preenchimento existe ainda) e a UI já trata os dois estados
-- (com/sem thumbnail) — popular este campo no futuro não deve exigir
-- nenhuma mudança estrutural na interface.
--
-- Rode depois de supabase/creative-analytics.sql.
alter table ad_creative_daily_metrics add column if not exists creative_thumbnail_url text;

comment on column ad_creative_daily_metrics.creative_thumbnail_url is
  'Reservado para exibição futura de miniatura do criativo — hoje sempre NULL (sem scraping, sem download, sem cache de mídia). A UI já trata null/preenchido; popular este campo futuramente não exige mudança estrutural na interface, só o dado passa a existir.';
