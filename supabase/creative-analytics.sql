-- Módulo de Criativos (Creative Analytics) — arquitetura aprovada pelo
-- usuário após análise de degradação gradual e independência do objetivo da
-- conta. Meta Ads é sempre a fonte de verdade: a identidade de um criativo
-- na MITZA é (client_id, creative_name), onde creative_name = ad_name do
-- Meta. Nunca ad_id/creative_id/video_id/image_hash — esses IDs mudam a
-- cada novo upload/edição no Meta e não servem de identidade estável; quem
-- garante consistência do nome é a disciplina operacional da própria
-- agência, nunca uma regra de match/fuzzy/IA na MITZA.
--
-- Mesma arquitetura de import_sources/daily_performance já usada pra
-- Meta Ads/Instagram — reaproveitada, não duplicada. Rode depois de
-- supabase/stract-integration.sql.

-- ---------------------------------------------------------------------------
-- Novas colunas opcionais em import_sources — mesmo padrão já usado por
-- account_id_column/date_column/spend_column/campaign_name_column: nomes de
-- coluna do Stract nunca são hardcoded em código, sempre configurados por
-- fonte. Todas nullable: uma fonte sem essas colunas configuradas
-- simplesmente não alimenta ad_creative_daily_metrics (degradação
-- graciosa — nunca um erro).
-- ---------------------------------------------------------------------------
alter table import_sources add column if not exists ad_name_column text;
alter table import_sources add column if not exists creative_permalink_column text;
alter table import_sources add column if not exists impressions_column text;
alter table import_sources add column if not exists reach_column text;
alter table import_sources add column if not exists clicks_column text;

comment on column import_sources.ad_name_column is
  'Nome da coluna, na tabela de origem, com o nome do anúncio (ad_name no Meta) — é este valor que vira creative_name na MITZA (identidade do criativo). Nulo = fonte não alimenta o módulo de Criativos.';
comment on column import_sources.creative_permalink_column is
  'Nome da coluna com o link do criativo (ex.: creative_instagram_permalink_url) — usado só pra exibir a miniatura/link, nunca como identidade. Opcional mesmo quando ad_name_column está configurado.';
comment on column import_sources.impressions_column is 'Nome da coluna de impressões na tabela de origem — opcional, exibida só quando configurada.';
comment on column import_sources.reach_column is 'Nome da coluna de alcance na tabela de origem — opcional, exibida só quando configurada.';
comment on column import_sources.clicks_column is 'Nome da coluna de cliques na tabela de origem — opcional, exibida só quando configurada.';

-- ---------------------------------------------------------------------------
-- ad_creative_daily_metrics: uma linha por fonte + dia + campanha + criativo.
-- Sem tabela intermediária de "Creative"/"Asset"/"Creative Group" — toda
-- consolidação por criativo acontece em tempo de consulta via
-- GROUP BY client_id, creative_name (nunca pré-computada aqui). Resultado
-- (leads/vendas) é opcional e reaproveita a mesma resolução de
-- metric_mappings já usada por daily_performance — nunca uma segunda
-- lógica de mapeamento de objetivo.
-- ---------------------------------------------------------------------------
create table if not exists ad_creative_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  import_source_id uuid not null references import_sources (id) on delete cascade,
  date date not null,
  campaign_name text not null,
  creative_name text not null,
  creative_permalink_url text,

  spend numeric not null default 0,
  impressions integer,
  reach integer,
  clicks integer,

  result_type text check (result_type in ('leads', 'sales')),
  result_count integer,
  revenue numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (import_source_id, date, campaign_name, creative_name)
);

create index if not exists ad_creative_daily_metrics_client_date_idx on ad_creative_daily_metrics (client_id, date);
create index if not exists ad_creative_daily_metrics_client_creative_idx on ad_creative_daily_metrics (client_id, creative_name);
create index if not exists ad_creative_daily_metrics_source_date_idx on ad_creative_daily_metrics (import_source_id, date);

create or replace function set_ad_creative_daily_metrics_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ad_creative_daily_metrics_set_updated_at on ad_creative_daily_metrics;
create trigger ad_creative_daily_metrics_set_updated_at
  before update on ad_creative_daily_metrics
  for each row execute function set_ad_creative_daily_metrics_updated_at();

comment on table ad_creative_daily_metrics is
  'Uma linha por fonte+dia+campanha+criativo (creative_name = ad_name do Meta, fonte de verdade). Sem tabela de Creative/Asset/Group — GROUP BY client_id, creative_name em tempo de consulta faz toda a consolidação, sempre por totais (nunca média simples de CPA/CPC/CTR/ROAS pré-computada aqui). Chave de upsert nunca depende de ad_id — só (import_source_id, date, campaign_name, creative_name), porque ids do Meta não são estáveis.';
comment on column ad_creative_daily_metrics.creative_name is
  'Identidade do criativo na MITZA — é sempre o ad_name do Meta, nunca renomeado/normalizado internamente. Duplicidade de nome entre criativos diferentes é responsabilidade operacional da agência, nunca resolvida por lógica de match na MITZA.';
comment on column ad_creative_daily_metrics.creative_permalink_url is
  'Só pra exibir miniatura/link do criativo — sem cache de imagem/vídeo. Quando null, a UI simplesmente não mostra miniatura pra essa linha (degradação graciosa).';
comment on column ad_creative_daily_metrics.impressions is 'Nula quando a fonte não tem impressions_column configurada — nunca fabricada como zero.';
comment on column ad_creative_daily_metrics.reach is 'Nula quando a fonte não tem reach_column configurada — nunca fabricada como zero.';
comment on column ad_creative_daily_metrics.clicks is 'Nula quando a fonte não tem clicks_column configurada — nunca fabricada como zero.';
comment on column ad_creative_daily_metrics.result_type is
  'leads|sales, resolvido pela mesma metric_mappings ativa da fonte — nulo quando a fonte não tem mapeamento de resultado (ex.: objetivo followers, que nunca vem do Meta Ads).';

-- Observabilidade: mesmo padrão de spend_rows_written/performance_rows_written
-- já existentes em data_sync_runs — nullable pra não quebrar linhas antigas.
alter table data_sync_runs add column if not exists creative_rows_written integer;

alter table ad_creative_daily_metrics enable row level security;

create policy ad_creative_daily_metrics_select on ad_creative_daily_metrics
  for select using (is_admin() or is_client_manager(client_id));

create policy ad_creative_daily_metrics_write on ad_creative_daily_metrics
  for all using (is_admin()) with check (is_admin());
