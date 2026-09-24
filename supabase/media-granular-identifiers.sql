-- Etapa "Gestão de Funis Estratégicos por Cliente" — auditoria seção 5
-- ("Prepare a estrutura para preservar os IDs oficiais de conta, campanha,
-- conjunto e anúncio nas granularidades necessárias").
--
-- Hoje só campaign_daily_metrics tem campaign_id (opcional, raramente
-- configurado — nenhum cliente em produção até esta migration).
-- ad_set_daily_metrics/ad_creative_daily_metrics/campaign_placement_daily_metrics
-- só têm nome (campaign_name/ad_set_name/creative_name) — decisão
-- deliberada da época (Stract não expõe id estável pra essas
-- granularidades hoje), mas isso significa que o vínculo campanha→funil
-- não consegue alcançar Públicos/Criativos/Posicionamentos com a mesma
-- segurança que já tem em Campanhas.
--
-- Esta migration só PREPARA a estrutura (colunas nullable, nunca
-- obrigatórias) pro futuro pipeline (n8n + API oficial da Meta, que
-- fornece IDs estáveis em toda granularidade) — não muda nenhum
-- comportamento hoje. Enquanto a fonte de um cliente não tiver essas
-- colunas configuradas em import_sources, tudo continua funcionando
-- exatamente como antes (nome como identidade de exibição, campaign_id
-- como única identidade confiável de classificação).
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste
-- projeto que altera schema já em produção.

-- ---------------------------------------------------------------------------
-- import_sources: colunas de configuração novas, mesmo padrão de
-- campaign_id_column (nome da coluna na tabela de origem, nunca
-- hardcoded). Todas nullable — fonte sem essas colunas configuradas
-- continua com zero mudança de comportamento.
-- ---------------------------------------------------------------------------
alter table import_sources
  add column if not exists ad_set_id_column text,
  add column if not exists ad_id_column text;

comment on column import_sources.ad_set_id_column is
  'Nome da coluna, na tabela de origem, com o ID ESTÁVEL do conjunto de anúncios (ad set) na plataforma de mídia — nunca o nome. Opcional; hoje nenhuma extração Stract conhecida fornece isso. Preparação pro pipeline futuro (n8n + API oficial da Meta).';
comment on column import_sources.ad_id_column is
  'Nome da coluna, na tabela de origem, com o ID ESTÁVEL do anúncio (ad) na plataforma de mídia — nunca o nome (identidade de exibição do criativo continua sendo sempre creative_name/ad_name, decisão intocada). Opcional; preparação pro pipeline futuro.';

-- ---------------------------------------------------------------------------
-- ad_set_daily_metrics: campaign_id (mesmo padrão de campaign_daily_metrics)
-- + ad_set_id — os dois nullable, populados só quando a fonte tiver as
-- colunas correspondentes configuradas.
-- ---------------------------------------------------------------------------
alter table ad_set_daily_metrics
  add column if not exists campaign_id text,
  add column if not exists ad_set_id text;

comment on column ad_set_daily_metrics.campaign_id is
  'ID estável da campanha — mesmo padrão de campaign_daily_metrics.campaign_id. Null quando a fonte não tem campaign_id_column configurado.';
comment on column ad_set_daily_metrics.ad_set_id is
  'ID estável do conjunto de anúncios — null quando a fonte não tem ad_set_id_column configurado (caso comum hoje). Nunca substitui ad_set_name como identidade de exibição.';

create index if not exists ad_set_daily_metrics_campaign_id_idx
  on ad_set_daily_metrics (client_id, channel, campaign_id) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- ad_creative_daily_metrics: campaign_id + ad_id. Identidade do criativo
-- continua SEMPRE creative_name (= ad_name do Meta) — decisão intocada,
-- documentada em creative-analytics.sql; ad_id aqui é só preparação
-- auxiliar pro futuro pipeline, nunca vira identidade.
-- ---------------------------------------------------------------------------
alter table ad_creative_daily_metrics
  add column if not exists campaign_id text,
  add column if not exists ad_id text;

comment on column ad_creative_daily_metrics.campaign_id is
  'ID estável da campanha — mesmo padrão de campaign_daily_metrics.campaign_id. Null quando a fonte não tem campaign_id_column configurado.';
comment on column ad_creative_daily_metrics.ad_id is
  'ID estável do anúncio — null quando a fonte não tem ad_id_column configurado (caso comum hoje). NUNCA substitui creative_name como identidade do criativo (ids do Meta não são estáveis entre edições/reuploads, ver creative-analytics.sql) — só preparação pro pipeline futuro.';

create index if not exists ad_creative_daily_metrics_campaign_id_idx
  on ad_creative_daily_metrics (client_id, campaign_id) where campaign_id is not null;

-- ---------------------------------------------------------------------------
-- campaign_placement_daily_metrics: campaign_id (não tinha nenhum id
-- ainda, só campaign_name).
-- ---------------------------------------------------------------------------
alter table campaign_placement_daily_metrics
  add column if not exists campaign_id text;

comment on column campaign_placement_daily_metrics.campaign_id is
  'ID estável da campanha — mesmo padrão de campaign_daily_metrics.campaign_id. Null quando a fonte não tem campaign_id_column configurado.';

create index if not exists campaign_placement_daily_metrics_campaign_id_idx
  on campaign_placement_daily_metrics (client_id, channel, campaign_id) where campaign_id is not null;
