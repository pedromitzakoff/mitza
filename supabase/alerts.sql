-- KOFF Analytics — Aba "Alertas" (pedido do usuário: identificar clientes que
-- precisam de atenção, principalmente por investimento/desempenho fora do
-- padrão, sem depender de alguém abrir a tela pra notar).
--
-- Entrega incremental (decisão do usuário via AskUserQuestion): esta migração
-- já cria o schema genérico pros 6 tipos de alerta do pedido, mas só o tipo
-- "spend_pace" (gasto acima/abaixo do previsto, incl. "hoje em andamento") é
-- avaliado nesta fase — os demais (no_delivery, cost_per_result_increase,
-- spend_without_result, sync_issue, opportunity) ficam no enum pra não exigir
-- uma segunda migração quando forem implementados.
--
-- Dedup (seção 5 do pedido, "um único alerta ativo por cliente/conta/tipo"):
-- `unique (client_id, channel, alert_type, period_kind)` — UMA linha por essa
-- chave, SEMPRE reaproveitada (nunca um INSERT novo pro mesmo problema
-- persistente; reabertura depois de "resolvido" também reaproveita a mesma
-- linha, ver `alert-persistence.ts`). `period_kind` entra na chave (não um
-- novo alert_type) porque "gasto de ontem" (acompanhável, pode ir pra
-- acompanhamento/resolvido) e "gasto de hoje em andamento" (sempre
-- recalculado, nunca precisa de acompanhamento multi-dia) são ciclos de vida
-- INDEPENDENTES do mesmo tipo de problema — tratá-los como o mesmo registro
-- faria uma checagem sobrescrever o status da outra.

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'instagram', 'other')),
  alert_type text not null check (alert_type in (
    'spend_pace',
    'no_delivery',
    'cost_per_result_increase',
    'spend_without_result',
    'sync_issue',
    'opportunity'
  )),
  -- "full_day" = avaliação do dia completo (acompanhável, com histórico de
  -- status); "in_progress" = monitor do dia em andamento (seção 4 do
  -- pedido) — nunca acumula estado multi-dia, só reflete o instante atual.
  period_kind text not null check (period_kind in ('full_day', 'in_progress')) default 'full_day',

  severity text not null check (severity in ('critico', 'atencao', 'oportunidade')),
  status text not null check (status in ('precisa_atencao', 'acompanhamento', 'resolvido')) default 'precisa_atencao',

  period_start date not null,
  period_end date not null,

  observed_value numeric,
  reference_value numeric,
  diff_percent numeric,
  -- Seção 1 do pedido: a referência diária pode vir do orçamento mensal
  -- (dividido pelos dias do mês) ou do histórico recente — AMBAS são
  -- estimativas, nunca um valor cadastrado explicitamente como "orçamento
  -- diário" (essa granularidade não existe no sistema). `reference_source`
  -- deixa explícito qual das duas, pro detalhe do alerta nunca esconder isso.
  reference_is_estimate boolean not null default false,
  reference_source text check (reference_source in ('monthly_budget', 'historical_average', 'other')),

  explanation text not null,
  -- Estrutura livre por tipo de alerta (ex.: thresholds usados, direção
  -- acima/abaixo) — nunca uma 2ª tabela por tipo, ver pedido seção 6 ("deixe
  -- as referências e os critérios utilizados visíveis no detalhe do alerta").
  detail jsonb not null default '{}'::jsonb,

  first_detected_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- Preenchido pela ação manual "Acompanhar amanhã" — só informativo (a
  -- própria cadência de avaliação já é diária), nunca um gate que suspende
  -- a avaliação automática.
  follow_up_until date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_id, channel, alert_type, period_kind)
);

create index if not exists alerts_status_severity_idx on alerts (status, severity);
create index if not exists alerts_client_idx on alerts (client_id);

create or replace function set_alerts_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists alerts_set_updated_at on alerts;
create trigger alerts_set_updated_at
  before update on alerts
  for each row execute function set_alerts_updated_at();

alter table alerts enable row level security;

-- Mesma abertura de acesso interno já usada em sprints/daily_spend/
-- campaign_daily_metrics (is_client_manager hoje = qualquer membro interno
-- ativo, ver supabase/is-client-manager-internal-team.sql) — "marcar como
-- revisado/acompanhar amanhã/resolver manualmente" são ações de dia a dia,
-- não administrativas (decisão do usuário: `requireActiveProfile()`, nunca
-- `requireAdmin()`, ver `src/app/alerts/actions.ts`).
create policy alerts_select on alerts
  for select using (is_admin() or is_client_manager(client_id));

create policy alerts_write on alerts
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- alert_events: histórico imutável de avaliações automáticas + ações do
-- gestor (seção 3/5 do pedido: "Registrar início, duração, avaliações,
-- observações e alterações de situação" / "Registrar quem revisou,
-- acompanhou ou resolveu"). Nunca UPDATE/DELETE — um evento por linha, pra
-- sempre, mesmo depois do alerta reaberto várias vezes (histórico contínuo
-- na mesma linha de `alerts`, ver comentário acima).
-- ---------------------------------------------------------------------------
create table if not exists alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts (id) on delete cascade,
  event_type text not null check (event_type in (
    'criado',            -- 1ª detecção
    'avaliado',          -- reavaliação automática sem mudança de status
    'revisado',          -- ação manual: marcar como revisado
    'acompanhar',        -- ação manual: acompanhar amanhã (com observação)
    'resolvido_manual',  -- ação manual: resolver (com observação)
    'resolvido_auto',    -- sistema: condição normalizou
    'reaberto',          -- sistema: reapareceu depois de resolvido
    'retomado_atencao'   -- sistema: ainda fora do padrão depois de "acompanhamento" -> volta pra "precisa_atencao"
  )),
  from_status text,
  to_status text,
  note text,
  actor_id uuid references profiles (id) on delete set null,
  observed_value numeric,
  reference_value numeric,
  diff_percent numeric,
  follow_up_until date,
  created_at timestamptz not null default now()
);

create index if not exists alert_events_alert_idx on alert_events (alert_id, created_at desc);

alter table alert_events enable row level security;

create policy alert_events_select on alert_events
  for select using (
    is_admin() or is_client_manager((select client_id from alerts where alerts.id = alert_events.alert_id))
  );

create policy alert_events_insert on alert_events
  for insert with check (
    is_admin() or is_client_manager((select client_id from alerts where alerts.id = alert_events.alert_id))
  );

comment on table alerts is
  'Um alerta ativo por (client_id, channel, alert_type, period_kind) — reaproveitado enquanto a condição persistir ou reaparecer (nunca um INSERT novo pro mesmo problema contínuo). Histórico completo de avaliações/ações em alert_events.';
comment on table alert_events is
  'Histórico imutável (nunca UPDATE/DELETE) de cada avaliação automática e ação manual sobre um alerta — a auditoria completa de "quem revisou/acompanhou/resolveu" e de cada reabertura.';
