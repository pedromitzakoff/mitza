-- Ad Set (Públicos) — arquitetura aprovada após inspeção somente leitura de
-- uma import_sources.table_name real (Meta Ads, cliente Ateliê): a extração
-- já traz `insights_adset_name` na MESMA linha que alimenta campanha/criativo
-- hoje, no grão dia×campanha×ad set×anúncio (confirmado via GROUP BY real —
-- sem ad set no agrupamento, o mesmo anúncio aparecia repetido 8-9x/dia; com
-- ad set, cada combinação vira exatamente 1 linha). Isso elimina o único
-- bloqueador de dado: nenhuma extração nova é necessária, só configuração +
-- agregação, mesmo padrão já usado por campaign_daily_metrics/
-- ad_creative_daily_metrics.
--
-- Mesma arquitetura de campaign_daily_metrics — channel-aware, grão de
-- ARMAZENAMENTO client×channel×campanha×ad set×dia (nunca por anúncio: o
-- processo de agregação já soma todas as linhas de anúncio pertencentes ao
-- mesmo campanha+ad set+dia antes de gravar, exatamente como
-- aggregateCampaignDailyRows soma por campanha+dia sem guardar
-- creative_name). Sem ad_set_id — hoje só existe o nome no Stract, e não é
-- fabricado nenhum id (ver auditoria: "Não criar ad_set_id fictício").
--
-- Rode depois de supabase/stract-integration.sql, supabase/creative-analytics.sql
-- e supabase/campaign-daily-metrics.sql.

alter table import_sources add column if not exists ad_set_name_column text;

comment on column import_sources.ad_set_name_column is
  'Nome da coluna, na tabela de origem, com o nome do conjunto de anúncios (ad set/adset no Meta) — vira ad_set_name em ad_set_daily_metrics. Nulo = fonte não alimenta Públicos. Mesmo padrão de ad_name_column/campaign_name_column: nome de coluna do Stract nunca hardcoded em código, sempre configurado por fonte.';

create table if not exists ad_set_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  import_source_id uuid not null references import_sources (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  date date not null,
  campaign_name text not null,
  ad_set_name text not null,

  spend numeric not null default 0,
  impressions integer,
  reach integer,
  clicks integer,

  result_type text check (result_type in ('leads', 'sales')),
  result_count integer,
  revenue numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identidade de armazenamento = import_source (⇒ client + channel) + data +
  -- campanha + ad set — cada linha já é a soma de TODOS os anúncios daquele
  -- ad set naquele dia (nunca uma linha por anúncio); consultar por ad set
  -- sozinho (Públicos, "uma linha por Ad Set") agrega em tempo de consulta
  -- via GROUP BY channel, ad_set_name, exatamente como Criativos agrega
  -- ad_creative_daily_metrics por creative_name.
  unique (import_source_id, date, channel, campaign_name, ad_set_name)
);

create index if not exists ad_set_daily_metrics_client_date_idx on ad_set_daily_metrics (client_id, date);
create index if not exists ad_set_daily_metrics_client_channel_ad_set_idx on ad_set_daily_metrics (client_id, channel, ad_set_name);
create index if not exists ad_set_daily_metrics_source_date_idx on ad_set_daily_metrics (import_source_id, date);

create or replace function set_ad_set_daily_metrics_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ad_set_daily_metrics_set_updated_at on ad_set_daily_metrics;
create trigger ad_set_daily_metrics_set_updated_at
  before update on ad_set_daily_metrics
  for each row execute function set_ad_set_daily_metrics_updated_at();

comment on table ad_set_daily_metrics is
  'Uma linha por fonte+dia+canal+campanha+ad set — SOMA de todos os anúncios daquele ad set naquele dia (grão de origem é dia×campanha×ad set×anúncio, ver auditoria). GROUP BY client_id, channel, ad_set_name em tempo de consulta consolida "Públicos" (um ad set pode rodar em mais de uma campanha, mesma lógica de creative_name em ad_creative_daily_metrics). SUM(spend) de todas as linhas desta tabela, pro mesmo client+channel+período, deve reconciliar com SUM(spend) de campaign_daily_metrics — são as MESMAS linhas de origem, só agrupadas de forma diferente, nunca uma segunda fonte de investimento.';
comment on column ad_set_daily_metrics.ad_set_name is
  'Nome do ad set no Meta — identidade textual (nunca ad_set_id, que não existe nesta extração hoje). Duplicidade de nome entre ad sets diferentes é responsabilidade operacional da agência, nunca resolvida por lógica de match na MITZA (mesma decisão já tomada pra creative_name).';

-- Observabilidade: mesmo padrão de campaign_rows_written/creative_rows_written
-- já existentes em data_sync_runs — nullable pra não quebrar linhas antigas.
alter table data_sync_runs add column if not exists ad_set_rows_written integer;

alter table ad_set_daily_metrics enable row level security;

create policy ad_set_daily_metrics_select on ad_set_daily_metrics
  for select using (is_admin() or is_client_manager(client_id));

create policy ad_set_daily_metrics_write on ad_set_daily_metrics
  for all using (is_admin()) with check (is_admin());
