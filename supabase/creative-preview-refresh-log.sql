-- Etapa "Preview de criativos nos cards de Anúncios" — uma tabela mínima
-- (1 linha por cliente), nunca a imagem em si. Guarda só QUANDO foi a
-- última busca de thumbnail/imagem na Meta pra esse cliente — decide se
-- uma nova busca é necessária (mais de 24h) ou se ainda está "fresca".
--
-- A imagem/thumbnail de verdade nunca passa por aqui nem por armazenamento
-- nosso: o link que a Meta devolve (`thumbnail_url`/`image_url`) é escrito
-- direto em `ad_creative_daily_metrics.preview_image_url` (coluna que já
-- existe, sempre null até agora por falta de um mecanismo de
-- preenchimento — ver comentário em `lib/creative-analytics.ts`) — o
-- navegador do usuário busca a imagem direto do servidor da própria Meta,
-- nunca baixada/guardada por nós.

create table if not exists creative_preview_refresh_log (
  client_id uuid primary key references clients(id),
  refreshed_at timestamptz not null default now()
);

comment on table creative_preview_refresh_log is
  'Uma linha por cliente — quando foi a última busca de preview de criativo (thumbnail_url/image_url) na Meta. Decide se uma nova busca é necessária (mais de 24h) antes de mostrar a tela de Anúncios. Nunca guarda a imagem em si, só a data da busca.';
