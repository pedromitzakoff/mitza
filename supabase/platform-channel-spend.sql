-- MVP Etapa 2: plataformas como dimensão do sistema.
--
-- Auditoria (feita antes deste arquivo): performance (performance_records)
-- já tem a coluna `channel` desde performance-tracking.sql — resultados já
-- são "fonte de verdade por plataforma". Investimento NÃO tem: daily_spend
-- (sync do Meta) não distingue canal nenhum (implicitamente só Meta), e o
-- override manual por sprint (sprints.manual_actual_spend/spend_source,
-- ver sprint-actual-spend-source.sql) é um único valor "cego" pra plataforma.
-- Este arquivo fecha essa lacuna do lado do investimento, sem tocar em
-- nenhum consumidor de interface (isso é trabalho da etapa seguinte, o
-- filtro de plataforma na Visão Geral) e sem alterar o comportamento atual
-- pra clientes só-Meta.
--
-- ---------------------------------------------------------------------------
-- daily_spend ganha `channel`. Default 'meta' porque toda a sync existente
-- (src/lib/meta-sync.ts) sempre foi implicitamente Meta — nenhuma linha
-- histórica muda de sentido. A unique constraint passa a incluir channel
-- (preparando pra uma sync do Google escrever na mesma tabela no futuro,
-- sem precisar de outra migration); pra dado já existente isso é equivalente
-- à constraint antiga, já que toda linha vira (client_id, date, 'meta').
-- ---------------------------------------------------------------------------
alter table daily_spend
  add column if not exists channel text not null default 'meta' check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other'));

alter table daily_spend drop constraint if exists daily_spend_client_id_date_key;
alter table daily_spend
  add constraint daily_spend_client_id_date_channel_key unique (client_id, date, channel);

comment on column daily_spend.channel is
  'Plataforma de origem do gasto sincronizado. Default/histórico "meta" (única fonte de sync até esta etapa) — nunca reinterpretado retroativamente.';

-- ---------------------------------------------------------------------------
-- sprint_channel_spend: override manual de gasto real POR PLATAFORMA,
-- estrutura paralela a performance_records (mesmo padrão de RLS e de
-- unique-por-escopo). NÃO substitui sprints.manual_actual_spend/spend_source
-- — essas colunas continuam exatamente como estão, ainda são a fonte
-- consultada por lib/sprint-financials.ts pro gasto CONSOLIDADO da sprint.
-- Esta tabela nova é a base pra granularidade por canal que as etapas
-- seguintes (filtro de plataforma) vão consumir, sem duplicar nem
-- reinterpretar o valor consolidado já existente.
-- ---------------------------------------------------------------------------
create table if not exists sprint_channel_spend (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid not null references sprints (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  spend_source text not null default 'meta_api' check (spend_source in ('manual', 'meta_api')),
  manual_actual_spend numeric(12, 2),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table sprint_channel_spend drop constraint if exists sprint_channel_spend_sprint_channel_key;
alter table sprint_channel_spend
  add constraint sprint_channel_spend_sprint_channel_key unique (sprint_id, channel);

create index if not exists sprint_channel_spend_client_id_idx on sprint_channel_spend (client_id);
create index if not exists sprint_channel_spend_sprint_id_idx on sprint_channel_spend (sprint_id);

create or replace function set_sprint_channel_spend_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sprint_channel_spend_set_updated_at on sprint_channel_spend;
create trigger sprint_channel_spend_set_updated_at
  before update on sprint_channel_spend
  for each row execute function set_sprint_channel_spend_updated_at();

comment on table sprint_channel_spend is
  'Override manual de gasto real por sprint + plataforma. Paralela a sprints.manual_actual_spend/spend_source (que permanecem como fonte do valor CONSOLIDADO da sprint — não removidos, não reescritos). Uma linha por (sprint_id, channel).';
comment on column sprint_channel_spend.spend_source is
  'manual = manual_actual_spend vale; meta_api = ignora manual_actual_spend e usa a soma de daily_spend deste canal no período da sprint (mesma semântica de sprints.spend_source).';

alter table sprint_channel_spend enable row level security;

create policy sprint_channel_spend_select on sprint_channel_spend
  for select using (is_admin() or is_client_manager(client_id));

create policy sprint_channel_spend_write on sprint_channel_spend
  for all using (is_admin()) with check (is_admin());

-- Backfill: sprints com override manual já lançado (spend_source='manual')
-- viram uma linha channel='meta' aqui — é a única plataforma que o sistema
-- já suportava até esta etapa, então isso preserva o dado existente sem
-- inventar nada. sprints.manual_actual_spend/spend_source NÃO são apagados
-- nem alterados por este backfill.
insert into sprint_channel_spend (client_id, sprint_id, channel, spend_source, manual_actual_spend)
select s.client_id, s.id, 'meta', 'manual', s.manual_actual_spend
from sprints s
where s.spend_source = 'manual' and s.manual_actual_spend is not null
on conflict (sprint_id, channel) do nothing;
