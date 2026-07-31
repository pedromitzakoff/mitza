-- Módulo de Criativos — exceção pontual aprovada pelo usuário: mapear
-- `preview_image_url` a partir de um campo opcional que a própria fonte já
-- entrega (ex.: `creative_image_url` na tabela bruta da Nonnina), no MESMO
-- padrão já usado por `creative_permalink_column`. Nenhuma mudança de
-- arquitetura — identidade do criativo continua sendo `creative_name`,
-- nenhum scraping/download/cache de mídia é introduzido aqui: é só um
-- mapeamento de coluna, igual a todos os outros já existentes em
-- import_sources.
--
-- Fonte sem esse campo configurado continua mostrando o placeholder — nada
-- muda pra quem não tiver essa coluna preenchida.
--
-- Rode depois de supabase/creative-analytics.sql e
-- supabase/creative-analytics-thumbnail.sql.
alter table import_sources add column if not exists preview_image_column text;

comment on column import_sources.preview_image_column is
  'Nome da coluna, na tabela de origem, com um link direto pra imagem/capa do criativo (ex.: creative_image_url) — opcional, mesmo padrão de creative_permalink_column. Quando preenchido, alimenta ad_creative_daily_metrics.preview_image_url (a miniatura real do card); quando null, o módulo de Criativos continua mostrando o placeholder normalmente. Nunca confundir com creative_permalink_column: aquele é sempre uma ação secundária (link pra ver o criativo em outro lugar), este é a representação visual em si.';
