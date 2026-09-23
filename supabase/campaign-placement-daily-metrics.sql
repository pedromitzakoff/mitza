-- Posicionamentos (Meta "Platform Position" — feed, stories, reels, coluna
-- lateral etc.) — pedido do usuário: comparar investimento/resultado por
-- onde o anúncio apareceu. Validado com dado real da conta Aibou antes desta
-- migration (soma por posicionamento bateu, com pequena defasagem de
-- atualização em relação ao Gerenciador de Anúncios — esperado pro dia
-- corrente).
--
-- Princípio de desenho (pedido explícito do usuário): o nome bruto da
-- origem (`breakdowns_platform_position`) fica só na configuração de
-- `import_sources` — a tabela nova e as consultas do Relatório usam sempre
-- `platform_position`, um conceito da própria MITZA, nunca sabendo de onde
-- veio. Troca de fornecedor/pipeline no futuro exige só reconfigurar
-- `import_sources`, nunca tocar nesta tabela ou no Relatório.
--
-- Auditoria confirmou que os totais já existentes (`daily_spend`,
-- `daily_performance`, `campaign_daily_metrics` etc.) NÃO precisam de
-- nenhuma mudança: toda agregação já soma por `(data[, nome])`, nunca supõe
-- 1 linha = 1 dia — uma fonte com múltiplas linhas por posicionamento já é
-- consolidada corretamente hoje. Esta migration só adiciona a leitura NOVA
-- (granularidade extra), nunca altera o que já existe.
--
-- Fonte sem `platform_position_column` configurado (todo cliente hoje,
-- exceto Aibou) continua com zero mudança de comportamento — o Import
-- Service só grava aqui quando a coluna está configurada.
--
-- Rode depois de supabase/campaign-daily-metrics.sql.

alter table import_sources add column if not exists platform_position_column text;

comment on column import_sources.platform_position_column is
  'Nome da coluna, na tabela de origem, que identifica o posicionamento do anúncio (ex.: breakdowns_platform_position no Stract/Meta) — null = fonte sem esse detalhamento, Import Service nunca escreve em campaign_placement_daily_metrics pra ela. Mesmo princípio de campaign_name_column/spend_column: nome bruto da origem só existe aqui, nunca fora da camada de importação.';

create table if not exists campaign_placement_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  import_source_id uuid not null references import_sources (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  date date not null,
  campaign_name text not null,
  platform_position text not null,

  spend numeric not null default 0,

  result_type text check (result_type in ('leads', 'sales')),
  result_count integer,
  revenue numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (import_source_id, date, channel, campaign_name, platform_position)
);

create index if not exists campaign_placement_daily_metrics_client_date_idx on campaign_placement_daily_metrics (client_id, date);
create index if not exists campaign_placement_daily_metrics_source_date_idx on campaign_placement_daily_metrics (import_source_id, date);

create or replace function set_campaign_placement_daily_metrics_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaign_placement_daily_metrics_set_updated_at on campaign_placement_daily_metrics;
create trigger campaign_placement_daily_metrics_set_updated_at
  before update on campaign_placement_daily_metrics
  for each row execute function set_campaign_placement_daily_metrics_updated_at();

comment on table campaign_placement_daily_metrics is
  'Uma linha por fonte+dia+canal+campanha+posicionamento — granularidade EXTRA em relação a campaign_daily_metrics (que continua intocada, sempre o total real por campanha/dia). Populada só quando import_sources.platform_position_column está configurado. GROUP BY platform_position em tempo de consulta monta a comparação "Posicionamentos" do Relatório de Performance — nunca substitui/reescreve campaign_daily_metrics.';
comment on column campaign_placement_daily_metrics.result_type is
  'leads|sales, resolvido pela mesma metric_mappings ativa da fonte — nula quando a fonte não tem mapeamento de resultado. Nunca uma segunda lógica de mapeamento além da já usada por daily_performance/campaign_daily_metrics.';

alter table data_sync_runs add column if not exists placement_rows_written integer;

alter table campaign_placement_daily_metrics enable row level security;

create policy campaign_placement_daily_metrics_select on campaign_placement_daily_metrics
  for select using (is_admin() or is_client_manager(client_id));

create policy campaign_placement_daily_metrics_write on campaign_placement_daily_metrics
  for all using (is_admin()) with check (is_admin());
