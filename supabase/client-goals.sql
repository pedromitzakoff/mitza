-- Etapa "Múltiplos Objetivos de Performance por Cliente" — direção de
-- produto aprovada após auditoria completa do modelo atual. Um cliente
-- passa a poder ter mais de um objetivo simultâneo (ex.: Leads + Seguidores,
-- Vendas + Seguidores), cada um com sua própria meta, canais, campanhas
-- vinculadas e custo por resultado — nunca misturando resultado/investimento
-- entre objetivos, nunca inventando rateio.
--
-- 100% aditivo. Nenhuma tabela/coluna/função existente é removida ou tem
-- comportamento alterado pra quem não migrar: `clients.performance_goal`
-- continua existindo e sendo lido por todo consumidor ainda não migrado
-- (Operação, Saúde, Dashboard, Relatórios, Conquistas — ver relatório da
-- implementação). `daily_performance`/`performance_records` já suportavam
-- múltiplos `result_type` desde a Etapa "Objetivo Seguidores" (auditoria
-- confirmou isso) — não são redesenhadas aqui.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção. Rode este arquivo inteiro no SQL Editor
-- do Supabase.

-- ---------------------------------------------------------------------------
-- DIAGNÓSTICO — rode isto ANTES do restante do arquivo e leia o resultado.
-- Não é destrutivo (só SELECT). Lista clientes com histórico de
-- `monthly_budget_changes` mas SEM `performance_goal` configurado hoje — o
-- backfill abaixo não tem como saber qual objetivo essas linhas antigas
-- representavam (a plataforma nunca guardou isso quando o objetivo não
-- estava configurado), então elas ficam com `result_type = null` de
-- propósito, nunca um valor adivinhado. Isso é esperado e seguro (essas
-- linhas simplesmente não entram em nenhum objetivo migrado), mas é uma
-- decisão que você deve revisar antes de seguir, não uma suposição
-- silenciosa da migration.
-- ---------------------------------------------------------------------------
-- select c.id, c.name, count(mbc.id) as historical_rows_sem_objetivo
-- from clients c
-- join monthly_budget_changes mbc on mbc.client_id = c.id
-- where c.performance_goal is null
-- group by c.id, c.name
-- order by historical_rows_sem_objetivo desc;

-- ---------------------------------------------------------------------------
-- client_goals: identidade + configuração de CADA objetivo de um cliente.
-- Deliberadamente pequena (auditoria: "não crie uma grande entidade se
-- monthly_budget_changes + result_type resolver corretamente") — as METAS
-- mensais continuam em `monthly_budget_changes` (que ganha `result_type`
-- logo abaixo); esta tabela guarda só o que é FATO DE IDENTIDADE do
-- objetivo, não um valor mensal: qual tipo de resultado, quais canais,
-- se é o principal (exibição, nunca lógica de domínio — ver comentário da
-- coluna), e de onde o resultado vem (automático via import, ou manual).
--
-- Único por (client_id, result_type): um cliente não pode ter dois
-- objetivos "leads" simultâneos — múltiplos objetivos significa múltiplos
-- `result_type` DIFERENTES, nunca duplicar o mesmo tipo.
-- ---------------------------------------------------------------------------
create table if not exists client_goals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  result_type text not null check (result_type in ('leads', 'sales', 'followers')),
  -- Canais em que este objetivo é avaliado. Array VAZIO = sem restrição
  -- (todos os canais que o cliente usa) — convenção deliberada pra todo
  -- objetivo migrado da configuração antiga nascer sem quebrar nada (o
  -- modelo de hoje nunca restringiu o único objetivo a um subconjunto de
  -- canais). Only preenchido quando o gestor explicitamente restringir.
  channels text[] not null default '{}',
  -- Preferência de EXIBIÇÃO em espaço compacto (card da Operação,
  -- listagens) — nunca lógica de domínio: Saúde, Dashboard, Relatórios e
  -- Conquistas, quando migrados, avaliam TODOS os objetivos
  -- independentemente, nunca só o primary. Índice único parcial abaixo
  -- garante no máximo 1 por cliente.
  is_primary boolean not null default false,
  -- "automatic" = resultado vem de daily_performance/performance_records
  -- alimentado por integração (Stract) ou lançamento manual por sprint
  -- (fluxo já existente). "manual" = resultado só entra via lançamento
  -- manual por período (ex.: Seguidores nesta V1 — instagram_daily_metrics
  -- não é por campanha, não dá pra vincular a goalSpend automaticamente do
  -- lado do RESULTADO, só do lado do SPEND).
  result_source text not null default 'automatic' check (result_source in ('automatic', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, result_type)
);

create index if not exists client_goals_client_id_idx on client_goals (client_id);

-- No máximo 1 objetivo principal por cliente — mesmo padrão de
-- `metric_mappings_one_active_per_source_goal` (índice único parcial),
-- já usado neste projeto pra essa exata forma de regra.
create unique index if not exists client_goals_one_primary_per_client
  on client_goals (client_id) where is_primary;

create or replace function set_client_goals_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_goals_set_updated_at on client_goals;
create trigger client_goals_set_updated_at
  before update on client_goals
  for each row execute function set_client_goals_updated_at();

comment on table client_goals is
  'Identidade + configuração de cada objetivo de performance de um cliente (Etapa "Múltiplos Objetivos"). Metas mensais (quantidade/custo) continuam em monthly_budget_changes.result_type — esta tabela nunca guarda um valor que muda mês a mês.';
comment on column client_goals.channels is
  'Array vazio = sem restrição de canal (todos que o cliente usa). Nunca reinterpretar vazio como "nenhum canal habilitado".';
comment on column client_goals.is_primary is
  'Só preferência de exibição em espaço compacto — NUNCA decide cálculo de Saúde/Dashboard/Report/Conquistas quando esses forem migrados. Consumidores ainda não migrados nesta etapa (ver relatório) usam o primary como ÚNICO objetivo avaliado, temporariamente, de forma documentada — isso é limitação do consumidor, não significado da coluna.';

alter table client_goals enable row level security;

create policy client_goals_select on client_goals
  for select using (is_admin() or is_client_manager(client_id));

create policy client_goals_write on client_goals
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- monthly_budget_changes ganha `result_type` — cada linha passa a
-- significar cliente + mês + canal + OBJETIVO (antes: cliente + mês +
-- canal, com o objetivo sempre implícito = clients.performance_goal
-- vigente). Tabela continua sendo histórico append-only (sem unique
-- constraint, sem update/delete) — "vigente" continua resolvido em tempo de
-- leitura como a linha mais recente por (client_id, channel, result_type).
--
-- `result_type` nullable de propósito: linhas históricas de clientes sem
-- `performance_goal` configurado (ver diagnóstico acima) ficam null — um
-- estado real ("meta antiga sem objetivo sabido"), nunca inventado.
-- ---------------------------------------------------------------------------
alter table monthly_budget_changes
  add column if not exists result_type text check (result_type is null or result_type in ('leads', 'sales', 'followers'));

create index if not exists monthly_budget_changes_client_channel_goal_idx
  on monthly_budget_changes (client_id, channel, result_type, month desc, changed_at desc);

comment on column monthly_budget_changes.result_type is
  'Objetivo a que esta versão do plano se refere (Etapa "Múltiplos Objetivos"). Null em linhas históricas de clientes que nunca tiveram performance_goal configurado — nunca inferido. "Vigente" de um objetivo continua sendo a linha mais recente por (client_id, channel, result_type).';

-- Backfill: toda linha histórica de cliente COM performance_goal
-- configurado hoje recebe esse valor como result_type — única suposição
-- feita (documentada, não silenciosa): o objetivo do cliente sempre foi
-- singular até esta etapa, então não há ambiguidade real sobre qual
-- objetivo uma linha antiga representava — era sempre o único que existia.
update monthly_budget_changes mbc
set result_type = c.performance_goal
from clients c
where mbc.client_id = c.id
  and mbc.result_type is null
  and c.performance_goal is not null;

-- Backfill de client_goals: 1 objetivo por cliente com performance_goal
-- configurado, marcado como principal (é o único que existia). Canais sem
-- restrição (comportamento idêntico ao de hoje). Fonte do resultado
-- derivada do que já é verdade hoje: seguidores é sempre manual (só via
-- instagram_daily_metrics/lançamento — nunca metric_mappings/Stract na
-- prática, ver auditoria seção 6); leads/vendas são automáticos (Stract).
insert into client_goals (client_id, result_type, channels, is_primary, result_source)
select
  c.id,
  c.performance_goal,
  '{}',
  true,
  case when c.performance_goal = 'followers' then 'manual' else 'automatic' end
from clients c
where c.performance_goal is not null
on conflict (client_id, result_type) do nothing;

-- ---------------------------------------------------------------------------
-- apply_monthly_channel_plan_change ganha `p_result_type` — parâmetro NOVO
-- no FINAL da assinatura, com default `null`: toda chamada existente
-- (`monthly-budget-actions.ts`, ainda não migrada) continua funcionando
-- IDENTICAMENTE, gravando result_type=null (mesmo significado de sempre —
-- "o objetivo implícito do cliente"). Só quando um chamador novo passar
-- `p_result_type` explícito é que o "carregar adiante a última meta de
-- quantidade" passa a respeitar o objetivo (nunca herdar a meta de Leads
-- ao editar o plano de Seguidores).
-- ---------------------------------------------------------------------------
create or replace function apply_monthly_channel_plan_change(
  p_client_id uuid,
  p_channel text,
  p_first_day date,
  p_last_day date,
  p_effective_date date,
  p_new_budget numeric,
  p_today date,
  p_changed_by uuid,
  p_reason text default null,
  p_target_result_count numeric default null,
  p_result_type text default null
) returns jsonb as $$
declare
  v_consolidated numeric(12, 2) := 0;
  v_historical_planned numeric(12, 2) := 0;
  v_previous_total numeric(12, 2) := 0;
  v_future_available numeric(12, 2) := 0;
  v_is_below boolean := false;
  v_future_start date;
  v_future_days int := 0;
  v_total_cents bigint := 0;
  v_base_cents bigint := 0;
  v_remainder_cents bigint := 0;
  v_sprint_count int := 0;
  v_last_target_result_count numeric(14, 2);
begin
  if p_new_budget < 0 then
    raise exception 'Orçamento não pode ser negativo';
  end if;

  if p_channel not in ('meta', 'google', 'tiktok', 'linkedin', 'other') then
    raise exception 'Canal inválido: %', p_channel;
  end if;

  if p_result_type is not null and p_result_type not in ('leads', 'sales', 'followers') then
    raise exception 'Objetivo inválido: %', p_result_type;
  end if;

  if p_last_day < p_today then
    raise exception 'Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.';
  end if;

  select count(*) into v_sprint_count
    from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day;

  if v_sprint_count = 0 then
    raise exception 'Sprints deste mês ainda não foram geradas para este cliente.';
  end if;

  perform 1 from sprints
    where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    for update;

  select coalesce(sum(
    case
      when scs.spend_source = 'manual' then coalesce(scs.manual_actual_spend, 0)
      else (
        select coalesce(sum(ds.spend), 0)
        from daily_spend ds
        where ds.client_id = p_client_id and ds.channel = p_channel
          and ds.date >= greatest(s.start_date, p_first_day)
          and ds.date <= least(s.end_date, p_effective_date - 1)
      )
    end
  ), 0) into v_consolidated
  from sprints s
  left join sprint_channel_spend scs on scs.sprint_id = s.id and scs.channel = p_channel
  where s.client_id = p_client_id
    and s.start_date >= p_first_day and s.start_date <= p_last_day
    and s.start_date <= p_effective_date - 1;

  select coalesce(sum(planned_amount), 0) into v_previous_total
    from sprint_planned_allocations
    where client_id = p_client_id and channel = p_channel and date >= p_first_day and date <= p_last_day;

  select coalesce(sum(planned_amount), 0) into v_historical_planned
    from sprint_planned_allocations
    where client_id = p_client_id and channel = p_channel and date >= p_first_day and date <= p_effective_date - 1;

  v_future_available := p_new_budget - v_consolidated;
  v_is_below := v_future_available < 0;
  if v_is_below then
    v_future_available := 0;
  end if;

  v_future_start := greatest(p_effective_date, p_first_day);
  v_future_days := greatest((p_last_day - v_future_start) + 1, 0);

  if v_future_days > 0 then
    v_total_cents := round(v_future_available * 100)::bigint;
    v_base_cents := v_total_cents / v_future_days;
    v_remainder_cents := v_total_cents - v_base_cents * v_future_days;

    with future_dates as (
      select d::date as date, row_number() over (order by d) as rn
      from generate_series(v_future_start, p_last_day, interval '1 day') as d
    ),
    target_sprints as (
      select id as sprint_id, start_date, end_date from sprints
      where client_id = p_client_id and start_date >= p_first_day and start_date <= p_last_day
    )
    insert into sprint_planned_allocations (sprint_id, client_id, date, channel, planned_amount, updated_at)
    select
      ts.sprint_id,
      p_client_id,
      fd.date,
      p_channel,
      (v_base_cents + case when fd.rn = v_future_days then v_remainder_cents else 0 end) / 100.0,
      now()
    from future_dates fd
    join target_sprints ts on fd.date >= ts.start_date and fd.date <= ts.end_date
    on conflict (sprint_id, date, channel) do update
      set planned_amount = excluded.planned_amount, updated_at = now();
  end if;

  update sprints s
  set planned_spend = coalesce(sub.total, 0)
  from (
    select sprint_id, sum(planned_amount) as total
    from sprint_planned_allocations
    where client_id = p_client_id and date >= p_first_day and date <= p_last_day
    group by sprint_id
  ) sub
  where s.id = sub.sprint_id
    and s.client_id = p_client_id and s.start_date >= p_first_day and s.start_date <= p_last_day;

  -- Carrega adiante a última meta de quantidade JÁ FILTRADA pelo mesmo
  -- objetivo (`is not distinct from p_result_type` trata null=null como
  -- igual, preservando o comportamento de sempre pra chamadas legadas sem
  -- objetivo) — nunca herda a meta de outro objetivo.
  select target_result_count into v_last_target_result_count
    from monthly_budget_changes
    where client_id = p_client_id and channel = p_channel
      and result_type is not distinct from p_result_type
    order by month desc, changed_at desc
    limit 1;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by, channel, result_type,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count
  ) values (
    p_client_id, p_first_day, p_effective_date, p_changed_by, p_channel, p_result_type,
    v_previous_total, p_new_budget, v_consolidated, v_future_available, v_historical_planned + v_future_available, v_is_below,
    nullif(trim(p_reason), ''),
    coalesce(p_target_result_count, v_last_target_result_count)
  );

  return jsonb_build_object(
    'consolidatedAmount', v_consolidated,
    'futureBudgetAvailable', v_future_available,
    'resultingTotal', v_historical_planned + v_future_available,
    'isBelowConsolidated', v_is_below
  );
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- set_goal_monthly_target: meta mensal de um objetivo SECUNDÁRIO (nunca o
-- principal — esse continua pelo fluxo de sempre,
-- `apply_monthly_channel_plan_change`, único dono de `sprint_planned_allocations`).
--
-- Por quê uma função separada, mais simples: investimento de um objetivo
-- secundário nunca é planejado manualmente (auditoria seção 6/9 — é sempre
-- DERIVADO das campanhas classificadas, `goalSpend`). Reaproveitar
-- `apply_monthly_channel_plan_change` pra um objetivo secundário rodaria a
-- redistribuição diária de orçamento OUTRA VEZ no mesmo canal — como
-- `sprint_planned_allocations` é chaveada por `(sprint_id, date, channel)`,
-- SEM objetivo, a segunda chamada sobrescreveria silenciosamente a
-- distribuição diária que já pertence ao objetivo principal. Esta função
-- nunca toca `sprints`/`sprint_planned_allocations` — só registra a meta de
-- quantidade como uma linha de histórico com investimento zerado (nunca
-- interpretado como "orçamento real" por ninguém, incluindo consumidores
-- legados: `new_amount = 0` é um valor visivelmente vazio, nunca confundido
-- com investimento de verdade).
-- ---------------------------------------------------------------------------
create or replace function set_goal_monthly_target(
  p_client_id uuid,
  p_channel text,
  p_month date,
  p_result_type text,
  p_target_result_count numeric,
  p_changed_by uuid,
  p_reason text default null
) returns void as $$
begin
  if p_channel not in ('meta', 'google', 'tiktok', 'linkedin', 'other') then
    raise exception 'Canal inválido: %', p_channel;
  end if;

  if p_result_type not in ('leads', 'sales', 'followers') then
    raise exception 'Objetivo inválido: %', p_result_type;
  end if;

  if exists (select 1 from client_goals where client_id = p_client_id and result_type = p_result_type and is_primary) then
    raise exception 'Este objetivo é o principal do cliente — use o editor de plano por canal, nunca esta função.';
  end if;

  insert into monthly_budget_changes (
    client_id, month, effective_date, changed_by, channel, result_type,
    previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated,
    reason, target_result_count
  ) values (
    p_client_id, p_month, p_month, p_changed_by, p_channel, p_result_type,
    0, 0, 0, 0, 0, false,
    nullif(trim(p_reason), ''),
    p_target_result_count
  );
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- set_client_goal_primary: única operação atômica que troca qual objetivo é
-- principal — nunca dois UPDATEs soltos na aplicação (evitaria o índice
-- único parcial se a ordem fosse invertida). Sequência segura: desliga o
-- principal atual (se houver), liga o novo — nunca passa por um estado com
-- 2 simultâneos.
-- ---------------------------------------------------------------------------
create or replace function set_client_goal_primary(p_client_id uuid, p_goal_id uuid) returns void as $$
begin
  update client_goals set is_primary = false where client_id = p_client_id and is_primary;
  update client_goals set is_primary = true where id = p_goal_id and client_id = p_client_id;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Campanha → Objetivo. Chave de identidade é SEMPRE campaign_id (nunca
-- campaign_name — auditoria seção 5: nome pode ser exibido, nunca define
-- identidade). campaign_id só existe quando a fonte tiver
-- `import_sources.campaign_id_column` configurado (ver abaixo) — campanhas
-- de fontes sem essa coluna configurada não aparecem como classificáveis
-- (nunca usamos o nome como substituto).
-- ---------------------------------------------------------------------------
alter table import_sources add column if not exists campaign_id_column text;

comment on column import_sources.campaign_id_column is
  'Nome da coluna, na tabela de origem, com o ID ESTÁVEL da campanha na plataforma de mídia (nunca o nome). Opcional — sem ela configurada, as campanhas desta fonte não podem ser vinculadas a um objetivo (Etapa "Múltiplos Objetivos"): nunca usamos campaign_name como substituto de identidade.';

alter table campaign_daily_metrics add column if not exists campaign_id text;

comment on column campaign_daily_metrics.campaign_id is
  'ID estável da campanha na plataforma (Meta/Google), só preenchido quando import_sources.campaign_id_column está configurado pra esta fonte. Null em linhas de fontes ainda não configuradas ou sincronizadas antes desta etapa — nunca inferido do nome.';

create index if not exists campaign_daily_metrics_campaign_id_idx
  on campaign_daily_metrics (client_id, channel, campaign_id) where campaign_id is not null;

-- client_campaign_goal_assignments: 1 campanha pertence a 0 ou 1 objetivo —
-- garantido pela unique (client_id, channel, campaign_id): "sem objetivo" é
-- ausência de linha (delete), nunca um valor "none" gravado. A FK composta
-- pra client_goals garante que só é possível vincular a um objetivo que
-- realmente existe pra este cliente (nunca um result_type solto sem
-- configuração).
create table if not exists client_campaign_goal_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  campaign_id text not null,
  result_type text not null check (result_type in ('leads', 'sales', 'followers')),
  assigned_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, channel, campaign_id),
  foreign key (client_id, result_type) references client_goals (client_id, result_type) on delete cascade
);

create index if not exists client_campaign_goal_assignments_client_goal_idx
  on client_campaign_goal_assignments (client_id, result_type);

create or replace function set_client_campaign_goal_assignments_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_campaign_goal_assignments_set_updated_at on client_campaign_goal_assignments;
create trigger client_campaign_goal_assignments_set_updated_at
  before update on client_campaign_goal_assignments
  for each row execute function set_client_campaign_goal_assignments_updated_at();

comment on table client_campaign_goal_assignments is
  'Classificação manual do gestor: qual objetivo de negócio cada campanha real serve (Etapa "Múltiplos Objetivos"). Fonte de verdade é SEMPRE a escolha explícita do gestor — nunca inferência por nome/objective da campanha/IA. Deletar (não um enum "sem objetivo") representa uma campanha não classificada. campaign_id nunca muda mesmo se a campanha for renomeada/pausada/desaparecer da mídia — o vínculo histórico nunca é apagado automaticamente por sync.';

alter table client_campaign_goal_assignments enable row level security;

create policy client_campaign_goal_assignments_select on client_campaign_goal_assignments
  for select using (is_admin() or is_client_manager(client_id));

create policy client_campaign_goal_assignments_write on client_campaign_goal_assignments
  for all using (is_admin()) with check (is_admin());
