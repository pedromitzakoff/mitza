-- Módulo de Criativos — ajuste do usuário: preparar a arquitetura pra
-- exibição futura de uma representação visual do criativo, sem implementar
-- scraping/download/cache de mídia nesta etapa. Só reserva a coluna; hoje
-- ela chega sempre NULL (nenhum mecanismo de preenchimento existe ainda) e
-- a UI já trata os dois estados (com/sem preview) — popular este campo no
-- futuro não deve exigir nenhuma mudança estrutural na interface.
--
-- Nome deliberadamente desacoplado de origem: nunca "creative_thumbnail_url"
-- (nome descartado — sugeriria Instagram/permalink como fonte). Amanhã essa
-- imagem pode vir do Instagram, da CDN do Meta, de upload manual, de cache
-- próprio (Cloudflare R2/S3/Supabase Storage) ou até ser gerada
-- internamente — a coluna só representa "a imagem de capa deste criativo",
-- nunca de onde ela veio.
--
-- `do $$ ... $$` cobre os dois casos possíveis nesta migration ainda não
-- ter sido rodada em produção: se a versão anterior (coluna
-- `creative_thumbnail_url`) já rodou, renomeia; senão, cria a coluna direto
-- com o nome certo. Idempotente nos dois cenários.
--
-- Rode depois de supabase/creative-analytics.sql.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'ad_creative_daily_metrics' and column_name = 'creative_thumbnail_url'
  ) then
    alter table ad_creative_daily_metrics rename column creative_thumbnail_url to preview_image_url;
  else
    alter table ad_creative_daily_metrics add column if not exists preview_image_url text;
  end if;
end $$;

comment on column ad_creative_daily_metrics.preview_image_url is
  'Representação visual (imagem de capa) do criativo — hoje sempre NULL (sem scraping, sem download, sem cache de mídia). Deliberadamente desacoplado de origem: pode vir do Instagram, CDN do Meta, upload manual, cache próprio ou geração interna — o nome do campo nunca deve sugerir uma fonte específica. A UI já trata null/preenchido; popular este campo futuramente não exige mudança estrutural na interface, só o dado passa a existir.';
