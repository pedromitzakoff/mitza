-- Módulo de Criativos — extensão pontual da exceção já aprovada
-- (preview_image_column): algumas fontes trazem a imagem de capa em colunas
-- DIFERENTES conforme o tipo de criativo (ex.: `creative_image_url`
-- preenchido só pra anúncios de imagem, `creative_thumbnail_url` preenchido
-- só pra anúncios de vídeo, nunca os dois ao mesmo tempo na mesma linha).
--
-- `preview_image_fallback_column` é tentada SOMENTE quando
-- `preview_image_column` vier vazio/null naquela linha específica — nunca
-- sobrescreve um valor que a coluna primária já trouxe. Mesmo espírito de
-- todas as colunas opcionais já existentes em import_sources: nenhum
-- scraping/download/cache, só mapeamento de coluna.
--
-- Rode depois de supabase/creative-analytics-preview-image-source.sql.
alter table import_sources add column if not exists preview_image_fallback_column text;

comment on column import_sources.preview_image_fallback_column is
  'Coluna alternativa de imagem/thumbnail, tentada SÓ quando preview_image_column vier vazia naquela linha (ex.: creative_thumbnail_url pra vídeo, quando creative_image_url só cobre imagem estática). Nunca sobrescreve um valor que a coluna primária já trouxe. Opcional — fonte sem esse campo configurado simplesmente nunca usa o fallback.';
