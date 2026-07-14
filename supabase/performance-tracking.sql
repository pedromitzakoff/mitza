-- Etapa 71: primeira versão da camada de PERFORMANCE (leads/vendas), uma
-- dimensão nova e complementar ao acompanhamento FINANCEIRO já existente.
--
-- Não altera nenhuma tabela/coluna/policy financeira já existente (clients
-- ganha 2 colunas novas, sprints não muda nada). Performance nunca cria uma
-- fonte de verdade nova pra investimento — os cálculos de custo por
-- resultado sempre consomem o "realizado" já computado pela camada
-- financeira (sprint_effective_spend / sumActualSpendForMonth), nunca
-- recalculado aqui.
--
-- ---------------------------------------------------------------------------
-- clients.performance_goal / clients.target_cost_per_result
-- ---------------------------------------------------------------------------
-- `performance_goal` é DELIBERADAMENTE distinto de `main_objective` (já
-- existente — campo textual/descritivo de contexto estratégico, sem
-- estrutura de meta ou cálculo). `performance_goal` só tem 2 valores
-- ("leads"|"sales"), em inglês, e alimenta o cálculo central de custo por
-- resultado (src/lib/performance.ts). Nasce `null` pra todo cliente já
-- existente — nunca inventamos um objetivo retroativamente; a interface deve
-- exigir o preenchimento apenas na CRIAÇÃO de um cliente novo (validação em
-- src/app/clients/actions.ts, não em constraint de banco, pra clientes
-- antigos continuarem válidos sem objetivo configurado).
--
-- `target_cost_per_result` é um único campo monetário genérico (nunca
-- target_cpl/target_cpa separados) — interpretado como "meta de CPL" ou
-- "meta de custo por venda" conforme o performance_goal vigente do cliente.
-- Sempre opcional.

alter table clients
  add column if not exists performance_goal text check (performance_goal in ('leads', 'sales')),
  add column if not exists target_cost_per_result numeric(12, 2) check (target_cost_per_result is null or target_cost_per_result > 0);

comment on column clients.performance_goal is
  'Objetivo estruturado de performance do cliente ("leads"|"sales"), distinto de main_objective (campo textual de contexto estratégico). Null = objetivo ainda não configurado (nunca inventado retroativamente); exigido na criação de clientes novos pela camada de aplicação.';
comment on column clients.target_cost_per_result is
  'Meta de custo por resultado (CPL ou custo por venda, conforme performance_goal) — campo monetário genérico único, nunca dois campos separados. Opcional mesmo com performance_goal configurado.';

-- ---------------------------------------------------------------------------
-- performance_records: um registro de resultado por cliente + canal + tipo +
-- período (sempre por sprint nesta etapa — consolidado mensal é sempre a
-- SOMA das sprints do mês, nunca um lançamento manual independente, pra
-- nunca duplicar contagem).
-- ---------------------------------------------------------------------------
create table if not exists performance_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  sprint_id uuid references sprints (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  result_type text not null check (result_type in ('leads', 'sales')),
  result_count integer not null default 0 check (result_count >= 0),
  period_start date not null,
  period_end date not null,
  source text not null default 'manual' check (source in ('manual', 'meta', 'google')),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null,
  check (period_end >= period_start)
);

-- Estratégia de entrada manual é SEMPRE por sprint nesta etapa (seção 22 do
-- pedido) — esta constraint garante que editar um resultado já lançado faça
-- upsert (update in place, via ON CONFLICT) em vez de criar um registro
-- duplicado pro mesmo cliente/sprint/canal/tipo. Unique constraint "normal"
-- (não parcial) de propósito: Postgres já trata cada NULL como distinto,
-- então nunca vai colidir por causa de sprint_id nulo — e um índice não
-- parcial é o que permite o `ON CONFLICT (client_id, sprint_id, channel,
-- result_type)` do upsert do Supabase (que não expressa uma cláusula WHERE)
-- funcionar como alvo de inferência.
alter table performance_records drop constraint if exists performance_records_sprint_scope_key;
alter table performance_records
  add constraint performance_records_sprint_scope_key unique (client_id, sprint_id, channel, result_type);

create index if not exists performance_records_client_id_idx on performance_records (client_id);
create index if not exists performance_records_period_idx on performance_records (period_start, period_end);
create index if not exists performance_records_sprint_id_idx on performance_records (sprint_id);
create index if not exists performance_records_channel_idx on performance_records (channel);
create index if not exists performance_records_result_type_idx on performance_records (result_type);

create or replace function set_performance_records_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists performance_records_set_updated_at on performance_records;
create trigger performance_records_set_updated_at
  before update on performance_records
  for each row execute function set_performance_records_updated_at();

comment on table performance_records is
  'Resultados de performance (leads/vendas) por cliente, canal e período — sempre por sprint nesta etapa. Nunca guarda CPL/CPA (sempre derivado de result_count + investimento já calculado pela camada financeira, nunca inserido manualmente).';
comment on column performance_records.channel is
  'Dimensão de canal (meta/google selecionáveis nesta etapa; tiktok/linkedin/other preparados pra integração futura, sem exigir nova migration).';
comment on column performance_records.result_type is
  'Tipo do resultado REALMENTE registrado no momento do lançamento — preservado historicamente mesmo que o performance_goal atual do cliente mude depois (nunca convertido/reescrito).';
comment on column performance_records.source is
  'Origem do dado: manual (lançado pelo gestor) | meta | google (integração futura) — dimensão independente do canal (ex.: channel=meta + source=manual = "dado do Meta digitado à mão").';
comment on column performance_records.source_updated_at is
  'Timestamp real da última edição/sincronização — nunca created_at como fallback, nunca a data de hoje como valor fictício.';

-- ---------------------------------------------------------------------------
-- RLS: mesmo padrão de sprints (admin edita tudo; gestor do cliente só lê).
-- Quem pode editar gasto real pode editar resultados (mesma autorização
-- admin-only usada em updateSprintActualSpendAction) — nenhuma permissão
-- nova é criada aqui.
-- ---------------------------------------------------------------------------
alter table performance_records enable row level security;

create policy performance_records_select on performance_records
  for select using (is_admin() or is_client_manager(client_id));

create policy performance_records_write on performance_records
  for all using (is_admin()) with check (is_admin());
