-- Integração Google Ads (Fase de arquitetura) — camada normalizada de
-- CAMPANHA, independente de Criativos.
--
-- Achado da auditoria: a seção "Campanhas" hoje não é independente — ela lê
-- literalmente `ad_creative_daily_metrics` (a tabela de Criativos, Meta-only,
-- exige `ad_name_column` configurado), só agrupando por `campaign_name` em
-- vez de `creative_name`. Como Criativos Google está fora de escopo mas
-- Campanhas Google não está, essas duas exigências juntas só fecham com uma
-- tabela nova no nível de CAMPANHA (não de criativo) — channel-aware, igual
-- pra Meta e Google, nunca uma tabela "do Google".
--
-- Escrita disparada sempre que `campaign_name_column` estiver configurado —
-- INDEPENDENTE de `ad_name_column` (que só existe pra alimentar Criativos).
-- Nunca fabrica `creative_name`/usa esta tabela como atalho pra criativo.
--
-- Rode depois de supabase/stract-integration.sql e
-- supabase/creative-analytics.sql.

create table if not exists campaign_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  import_source_id uuid not null references import_sources (id) on delete cascade,
  -- Mesma lista de `daily_spend`/`daily_performance`/`import_sources` — sem
  -- 'instagram': Instagram nunca é canal de investimento/campanha paga (é
  -- fonte de resultado orgânico, ver lib/traffic-channels.ts).
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  date date not null,
  campaign_name text not null,

  spend numeric not null default 0,
  impressions integer,
  reach integer,
  clicks integer,

  result_type text check (result_type in ('leads', 'sales')),
  result_count integer,
  revenue numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identidade analítica de campanha = import_source (⇒ client + channel) +
  -- data + nome — nunca só campaign_name: Meta e Google podem ter campanhas
  -- com o mesmo nome, e nunca devem ser somadas juntas.
  unique (import_source_id, date, channel, campaign_name)
);

create index if not exists campaign_daily_metrics_client_date_idx on campaign_daily_metrics (client_id, date);
create index if not exists campaign_daily_metrics_client_channel_campaign_idx on campaign_daily_metrics (client_id, channel, campaign_name);
create index if not exists campaign_daily_metrics_source_date_idx on campaign_daily_metrics (import_source_id, date);

create or replace function set_campaign_daily_metrics_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaign_daily_metrics_set_updated_at on campaign_daily_metrics;
create trigger campaign_daily_metrics_set_updated_at
  before update on campaign_daily_metrics
  for each row execute function set_campaign_daily_metrics_updated_at();

comment on table campaign_daily_metrics is
  'Uma linha por fonte+dia+canal+campanha — camada normalizada de campanha da MITZA (Meta, Google e canais futuros), independente de ad_creative_daily_metrics (essa continua exclusiva de Criativos/Meta). GROUP BY client_id, channel, campaign_name em tempo de consulta faz a consolidação, sempre por totais. Nunca populada com creative_name fabricado — é sempre agregada direto da tabela de origem por (date, campaign_name), sem passar pela granularidade de criativo.';
comment on column campaign_daily_metrics.channel is
  'Mesmo domínio de daily_spend/daily_performance/import_sources.channel — nunca inferido, sempre copiado de import_sources.channel no momento da escrita.';
comment on column campaign_daily_metrics.result_type is
  'leads|sales, resolvido pela mesma metric_mappings ativa da fonte — nulo quando a fonte não tem mapeamento de resultado. Nunca uma segunda lógica de mapeamento além da já usada por daily_performance/ad_creative_daily_metrics.';

-- Observabilidade: mesmo padrão de creative_rows_written já existente em
-- data_sync_runs — nullable pra não quebrar linhas antigas.
alter table data_sync_runs add column if not exists campaign_rows_written integer;

alter table campaign_daily_metrics enable row level security;

create policy campaign_daily_metrics_select on campaign_daily_metrics
  for select using (is_admin() or is_client_manager(client_id));

create policy campaign_daily_metrics_write on campaign_daily_metrics
  for all using (is_admin()) with check (is_admin());
