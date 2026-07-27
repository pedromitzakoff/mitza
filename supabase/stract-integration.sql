-- Integração Stract → Supabase → MITZA (arquitetura aprovada após 3 rodadas
-- de revisão — ver DECISIONS.md). Objetivo: sincronizar automaticamente
-- investimento e resultados (leads/vendas) de contas configuradas no Stract,
-- sem acoplar nenhuma parte operacional da MITZA ao formato interno do
-- Stract (nomes de tabela/coluna são tratados como implementação, nunca como
-- contrato).
--
-- Nenhuma tabela existente (clients, sprints, daily_spend, performance_records)
-- ganha coluna ou constraint alterada aqui — tudo é aditivo. `daily_spend` e
-- `performance_records` continuam servindo exatamente como hoje pro fluxo
-- manual; a integração introduz `daily_performance` como a fonte diária de
-- resultados (irmã de `daily_spend`, que já é a fonte diária de investimento),
-- consolidada em tempo de leitura pela Sprint/Dashboard/Relatórios — nunca
-- amarrada a uma sprint específica no armazenamento.

-- ---------------------------------------------------------------------------
-- import_sources: "como este cliente recebe dados de um provedor externo".
-- Representa só a integração (identidade + localização física atual) —
-- nunca métrica, nunca performance. O relacionamento com o cliente é sempre
-- por `external_account_id` (formato "act_..." pro Meta, já confirmado
-- idêntico a `clients.meta_ad_account_id`), nunca por nome de tabela/cliente.
-- ---------------------------------------------------------------------------
create table if not exists import_sources (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  provider text not null check (provider in ('stract')),
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  external_account_id text not null,
  table_name text not null,
  account_id_column text not null,
  date_column text not null,
  spend_column text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'disabled')),
  enabled boolean not null default false,
  last_imported_date date,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, channel, external_account_id)
);

create index if not exists import_sources_client_id_idx on import_sources (client_id);
create index if not exists import_sources_enabled_idx on import_sources (enabled) where enabled;

create or replace function set_import_sources_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists import_sources_set_updated_at on import_sources;
create trigger import_sources_set_updated_at
  before update on import_sources
  for each row execute function set_import_sources_updated_at();

comment on table import_sources is
  'Identidade de uma integração externa por cliente ("como este cliente recebe dados") — nunca métrica/performance, isso é metric_mappings. table_name é só a localização física atual, nunca uma chave de relacionamento (essa é sempre external_account_id).';
comment on column import_sources.status is
  'Saúde/configuração da FONTE, persiste entre execuções (pending = configurada mas nunca rodou, active = última execução ok, error = última execução falhou, disabled = desligada deliberadamente). Não confundir com data_sync_runs.status, que descreve UMA execução.';
comment on column import_sources.enabled is
  'Intenção declarada do admin — o único campo usado pelo gate de leitura (Sprint/Dashboard). status é só observabilidade, nunca decide de onde ler.';
comment on column import_sources.last_imported_date is
  'Só observabilidade ("até quando já sincronizamos") — NUNCA um cursor consultado pelo Import Service pra decidir o que reler. O Stract reprocessa o histórico inteiro diariamente; o Import Service sempre relê a janela completa configurada e resolve tudo via upsert, pra nunca bloquear uma correção retroativa.';
comment on column import_sources.account_id_column is 'Nome da coluna, na tabela de origem, que identifica a conta — comum a toda a fonte (não varia por objetivo).';
comment on column import_sources.date_column is 'Nome da coluna de data na tabela de origem — comum a toda a fonte.';
comment on column import_sources.spend_column is 'Nome da coluna de investimento na tabela de origem — comum a toda a fonte (investimento não varia por objetivo).';

-- ---------------------------------------------------------------------------
-- metric_mappings: qual coluna representa cada objetivo (leads/vendas/
-- seguidores), específico de cada fonte. Nomes de coluna do Stract EXISTEM
-- SÓ AQUI — nunca hardcoded em código. Histórico simples via
-- "nunca UPDATE destrutivo": quando um nome de coluna mudar, desativa a
-- linha antiga e insere uma nova, preservando quando cada mapeamento esteve
-- em vigor (created_at já basta, sem tabela de auditoria separada).
-- ---------------------------------------------------------------------------
create table if not exists metric_mappings (
  id uuid primary key default gen_random_uuid(),
  import_source_id uuid not null references import_sources (id) on delete cascade,
  goal text not null check (goal in ('leads', 'sales', 'followers')),
  result_column text not null,
  value_column text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists metric_mappings_one_active_per_source_goal
  on metric_mappings (import_source_id, goal) where active;

create index if not exists metric_mappings_import_source_id_idx on metric_mappings (import_source_id);

comment on table metric_mappings is
  'Mapeamento de qual coluna da fonte representa cada objetivo — específico por objetivo (diferente de import_sources, que guarda o que é comum a toda a fonte). Nunca UPDATE em result_column/value_column: pra mudar, desativa a linha (active=false) e insere uma nova — histórico fica gravado em created_at, sem tabela extra.';
comment on column metric_mappings.value_column is
  'Coluna de valor de conversão (ex.: action_values_onsite_conversion_purchase), guardada só pra uso futuro (ex.: ROAS) — nunca obrigatória, nunca usada no cálculo de custo por resultado hoje (esse é sempre investimento ÷ resultado, calculado pela MITZA).';

-- ---------------------------------------------------------------------------
-- daily_performance: fonte DIÁRIA de resultados, irmã de `daily_spend`
-- (fonte diária de investimento). Escrita SÓ pelo Import Service — o fluxo
-- manual continua 100% em `performance_records`, sem nenhuma mudança.
-- Consolidação (ontem/7 dias/30 dias/mês/trimestre/sprint) acontece em
-- tempo de leitura, nunca reprocessada/duplicada por janela.
-- ---------------------------------------------------------------------------
create table if not exists daily_performance (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  date date not null,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  result_type text not null check (result_type in ('leads', 'sales', 'followers')),
  result_count integer not null default 0 check (result_count >= 0),
  source text not null default 'import' check (source in ('manual', 'import')),
  provider text check (provider in ('stract')),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, date, channel, result_type)
);

create index if not exists daily_performance_client_date_idx on daily_performance (client_id, date);

create or replace function set_daily_performance_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists daily_performance_set_updated_at on daily_performance;
create trigger daily_performance_set_updated_at
  before update on daily_performance
  for each row execute function set_daily_performance_updated_at();

comment on table daily_performance is
  'Fonte DIÁRIA de resultados (leads/vendas/seguidores), espelhando daily_spend pro lado de performance. Escrita só pelo Import Service — performance_records continua servindo o lançamento manual, intocada. Cliente com import_sources.enabled=true lê daqui; sem integração ativa, lê performance_records — nunca os dois somados.';
comment on column daily_performance.source is
  'manual|import — "como o dado chegou". Nesta primeira versão sempre "import" (só o Import Service escreve aqui); guardado como manual|import (não um valor de canal) pra nunca confundir "como chegou" com "qual canal" (channel) ou "qual provedor" (provider).';
comment on column daily_performance.provider is
  'Só preenchido quando source=''import'' (ex.: ''stract''). Nulo pra qualquer linha manual futura.';

-- ---------------------------------------------------------------------------
-- data_sync_runs: log de UMA execução do Import Service — nunca confundido
-- com import_sources.status (que é a saúde persistente da fonte). Nenhuma
-- execução que só importou parte dos dados é marcada como sucesso.
-- ---------------------------------------------------------------------------
create table if not exists data_sync_runs (
  id uuid primary key default gen_random_uuid(),
  import_source_id uuid not null references import_sources (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  rows_read integer,
  spend_rows_written integer,
  performance_rows_written integer,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists data_sync_runs_import_source_id_idx on data_sync_runs (import_source_id, started_at desc);

comment on table data_sync_runs is
  'Log de execução do Import Service — status de UMA rodada (running/success/partial/failed), nunca a saúde persistente da fonte (isso é import_sources.status). partial = alguma parte falhou ou alguma linha foi ignorada por dado inválido; nunca reportado como success nesse caso.';

-- ---------------------------------------------------------------------------
-- RLS — mesmo padrão de daily_spend/performance_records: escrita restrita a
-- admin (o Import Service roda com o client admin/service role, que ignora
-- RLS; a policy de admin é o mesmo backstop defensivo que já existe pra
-- daily_spend). metric_mappings/data_sync_runs são detalhe interno de
-- configuração/observabilidade — leitura também restrita a admin.
-- ---------------------------------------------------------------------------
alter table import_sources enable row level security;

create policy import_sources_select on import_sources
  for select using (is_admin() or is_client_manager(client_id));

create policy import_sources_write on import_sources
  for all using (is_admin()) with check (is_admin());

alter table metric_mappings enable row level security;

create policy metric_mappings_select on metric_mappings
  for select using (is_admin());

create policy metric_mappings_write on metric_mappings
  for all using (is_admin()) with check (is_admin());

alter table daily_performance enable row level security;

create policy daily_performance_select on daily_performance
  for select using (is_admin() or is_client_manager(client_id));

create policy daily_performance_write on daily_performance
  for all using (is_admin()) with check (is_admin());

alter table data_sync_runs enable row level security;

create policy data_sync_runs_select on data_sync_runs
  for select using (is_admin());

create policy data_sync_runs_write on data_sync_runs
  for all using (is_admin()) with check (is_admin());
