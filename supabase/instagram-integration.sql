-- Integração Instagram (Stract) — novos seguidores por dia, cruzados com
-- investimento Meta Ads por `client_id` + `date` (nunca por relacionamento
-- direto entre fontes — princípio explícito do usuário). Mesma arquitetura
-- de `import_sources`/`daily_performance` já usada pra Meta Ads —
-- reaproveitada, não duplicada (ver mapeamento de arquitetura na
-- conversa: `daily_performance` já cumpre o papel de "camada consolidada
-- por cliente+data", só faltava um canal novo).
--
-- Rode depois de supabase/stract-integration.sql.

-- ---------------------------------------------------------------------------
-- 'instagram' como um canal novo — mesmo papel que 'meta'/'google'/'tiktok'/
-- 'linkedin' já têm hoje (identidade da fonte), nunca um canal de tráfego
-- pago selecionável na entrada manual (AVAILABLE_TRAFFIC_CHANNELS continua
-- só meta/google, ver lib/traffic-channels.ts — Instagram é sempre
-- sincronizado, nunca lançado à mão).
-- ---------------------------------------------------------------------------
alter table import_sources drop constraint if exists import_sources_channel_check;
alter table import_sources add constraint import_sources_channel_check
  check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'instagram', 'other'));

alter table daily_performance drop constraint if exists daily_performance_channel_check;
alter table daily_performance add constraint daily_performance_channel_check
  check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'instagram', 'other'));

-- ---------------------------------------------------------------------------
-- instagram_daily_metrics: fonte de verdade RICA do Instagram — uma linha
-- por import_source + dia, preservada pra sempre (a API do Instagram só
-- devolve ~30 dias de janela; é este banco que garante o histórico
-- completo). `new_followers` é a métrica OFICIAL (líquida, pode ser
-- negativa em caso de perda de seguidores — preservada como está, nunca
-- zerada). `followers_total` é só um campo TÉCNICO, usado internamente
-- quando a Stract não entrega novos seguidores diretamente, só o acumulado
-- (nesse caso, calculamos a diferença entre dias consecutivos em código —
-- ver `lib/instagram-metrics.ts`) — NUNCA exibido na interface como métrica
-- de análise (decisão explícita do usuário: "seguidores totais" não é uma
-- métrica de destaque nesta etapa).
-- ---------------------------------------------------------------------------
create table if not exists instagram_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  import_source_id uuid not null references import_sources (id) on delete cascade,
  date date not null,

  new_followers integer not null,
  followers_total integer,
  reach integer,
  impressions integer,
  profile_views integer,
  accounts_engaged integer,
  raw_data jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (import_source_id, date)
);

create index if not exists instagram_daily_metrics_client_date_idx on instagram_daily_metrics (client_id, date);
create index if not exists instagram_daily_metrics_source_date_idx on instagram_daily_metrics (import_source_id, date);

create or replace function set_instagram_daily_metrics_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists instagram_daily_metrics_set_updated_at on instagram_daily_metrics;
create trigger instagram_daily_metrics_set_updated_at
  before update on instagram_daily_metrics
  for each row execute function set_instagram_daily_metrics_updated_at();

comment on table instagram_daily_metrics is
  'Fonte de verdade rica do Instagram (Stract) — new_followers é a métrica oficial (líquida por dia, pode ser negativa). followers_total é só um campo técnico interno (cálculo de diferença entre dias quando a fonte não entrega o líquido diretamente) — nunca exibido na interface como métrica de análise.';
comment on column instagram_daily_metrics.new_followers is
  'Seguidores líquidos ganhos NAQUELE dia — nunca o acumulado. Espelhado em daily_performance (channel=instagram, result_type=followers, result_count=new_followers) pra entrar automaticamente no mesmo pipeline de Analytics/Reports usado por qualquer outro objetivo, sem duplicar lógica de leitura.';
comment on column instagram_daily_metrics.followers_total is
  'Campo técnico — só usado quando a fonte não entrega new_followers diretamente. Nunca exibido na interface nem usado como resultado do período.';

alter table instagram_daily_metrics enable row level security;

create policy instagram_daily_metrics_select on instagram_daily_metrics
  for select using (is_admin() or is_client_manager(client_id));

create policy instagram_daily_metrics_write on instagram_daily_metrics
  for all using (is_admin()) with check (is_admin());
