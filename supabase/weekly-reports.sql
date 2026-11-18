-- Aba "Reports" (pedido do usuário) — dois reports por semana, prontos pra
-- cada cliente ativo com integração automática, pro gestor conferir, copiar
-- e enviar manualmente no WhatsApp.
--
-- NÃO reaproveita `client_reports`/`client_updates` (supabase/client-
-- reports.sql, supabase/client-updates.sql) — tabelas já existentes no
-- banco, mas nunca usadas por nenhuma tela até hoje (sem rota/action/UI,
-- confirmado em código). São um fluxo DIFERENTE: geração manual, disparada
-- pelo gestor a partir de uma recorrência/análise de conta, com métricas em
-- jsonb de preenchimento livre. Este aqui é automático (cron, duas janelas
-- fixas por semana), com estado (`status`) e destaques de anúncio
-- calculados a partir de dados já sincronizados — formato e ciclo de vida
-- bem diferentes pra forçar na mesma tabela. `client_reports`/
-- `client_updates` continuam como estão, sem nenhuma mudança aqui.
--
-- Dedup (pedido: "crie um único report por cliente e período, inclusive se
-- o job rodar novamente ou se houver reprocessamento"): `unique (client_id,
-- period_start, period_end)` — mesmo espírito de `alerts` (supabase/
-- alerts.sql), uma linha só, sempre reaproveitada (nunca um INSERT novo pro
-- mesmo período).
--
-- `sent_by`/`created_by`-style actors referenciam `team_members (id)`
-- (nunca `profiles`) — convenção correta pós supabase/team-members.sql
-- (ver client-updates.sql/reminders.sql), não a usada em alerts.sql
-- (`references profiles (id)`, que parece ter ficado defasada; fora do
-- escopo desta entrega corrigir isso lá).

create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,

  -- "segunda" = dados de sexta-feira anterior até domingo, inclusive;
  -- "sexta" = dados de segunda a quinta da mesma semana, inclusive (pedido,
  -- seção 1). Entra na chave de dedup via period_start/period_end (nunca
  -- precisa entrar sozinho — os dois batches nunca compartilham período).
  period_kind text not null check (period_kind in ('segunda', 'sexta')),
  period_start date not null,
  period_end date not null,

  status text not null check (status in ('aguardando_dados', 'pronto_para_enviar', 'enviado')) default 'aguardando_dados',

  -- Snapshot do objetivo do cliente no momento da geração — nunca
  -- reinterpretado se `clients.performance_goal` mudar depois (mesmo
  -- espírito de "meta congelada" já usado em client_reports.performance_goal/
  -- recurring_task_goal_history).
  performance_goal text check (performance_goal in ('leads', 'sales', 'followers', 'conversations', 'registrations')),

  -- Estrutura livre (investimento/resultado/custo/destaques de anúncio,
  -- thresholds usados) — nunca colunas tipadas por campo, pedido seção 6 do
  -- Alertas já estabeleceu esse padrão aqui também ("deixe as referências e
  -- os critérios visíveis"). Sempre recalculado a cada reprocessamento
  -- ENQUANTO status != 'enviado' (ver generate-weekly-reports.ts) — nunca
  -- congela sozinho; só o texto (`body_text`) congela com a edição manual.
  metrics jsonb not null default '{}'::jsonb,

  -- Campo estruturado opcional (pedido, seção 2: "próximo passo... quando
  -- preenchido pelo gestor, inclua no texto copiado") — guardado separado
  -- do texto final pra sobreviver a uma reedição que só toca o texto.
  next_step text,

  -- Texto final, copiável (pedido, seção 4 do exemplo) — gerado por
  -- template a cada reprocessamento ENQUANTO `text_edited_at` for nulo;
  -- qualquer edição manual grava aqui E marca `text_edited_at`, e dali pra
  -- frente nenhum reprocessamento automático volta a sobrescrever (pedido:
  -- "preserve edições manuais durante reprocessamentos").
  body_text text not null default '',
  text_edited_at timestamptz,

  -- "Marcar como enviado" (pedido, seção 4): registra quem, quando, e a
  -- versão final do texto NAQUELE momento — `sent_text` nunca muda depois,
  -- mesmo que a origem recalcule `metrics`/`body_text` num reprocessamento
  -- futuro (congelado só por `status = 'enviado'`, ver orquestrador: linha
  -- 'enviado' é inteiramente pulada, nunca tocada de novo). "Desfazer"
  -- (pedido: "permita desfazer uma marcação feita por engano") limpa os 3
  -- campos e volta status pra 'pronto_para_enviar' — `body_text` não
  -- regride (fica com o texto que tinha sido enviado), só os campos de
  -- envio em si.
  sent_by uuid references team_members (id) on delete set null,
  sent_at timestamptz,
  sent_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (period_end >= period_start),
  unique (client_id, period_start, period_end)
);

create index if not exists weekly_reports_status_idx on weekly_reports (status);
create index if not exists weekly_reports_client_idx on weekly_reports (client_id, period_start desc);

create or replace function set_weekly_reports_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists weekly_reports_set_updated_at on weekly_reports;
create trigger weekly_reports_set_updated_at
  before update on weekly_reports
  for each row execute function set_weekly_reports_updated_at();

alter table weekly_reports enable row level security;

-- Mesmo critério de amplo acesso interno de sempre (alerts/client_updates):
-- "conferir, editar, copiar e marcar como enviado" são ações de dia a dia,
-- nunca administrativas.
create policy weekly_reports_select on weekly_reports
  for select using (is_admin() or is_client_manager(client_id));

create policy weekly_reports_write on weekly_reports
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- weekly_report_events: histórico imutável (nunca UPDATE/DELETE) — mesmo
-- papel de alert_events (supabase/alerts.sql): a auditoria completa de
-- geração/edição/envio/desfazer, independente do estado atual da linha
-- principal (que pode ser sobrescrito por reprocessamento).
-- ---------------------------------------------------------------------------
create table if not exists weekly_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references weekly_reports (id) on delete cascade,
  event_type text not null check (event_type in (
    'gerado',             -- 1ª geração (ainda aguardando dados ou já pronto)
    'pronto_para_enviar',  -- sistema: dados completos, texto gerado
    'texto_editado',      -- ação manual: editar texto/próximo passo
    'marcado_enviado',    -- ação manual: marcar como enviado
    'envio_desfeito'      -- ação manual: desfazer envio
  )),
  -- Nulo nos 2 eventos automáticos (gerado/pronto_para_enviar) — só as 3
  -- ações manuais têm um responsável.
  actor_id uuid references team_members (id) on delete set null,
  note text,
  text_snapshot text,
  created_at timestamptz not null default now()
);

create index if not exists weekly_report_events_report_idx on weekly_report_events (report_id, created_at desc);

alter table weekly_report_events enable row level security;

create policy weekly_report_events_select on weekly_report_events
  for select using (
    is_admin() or is_client_manager((select client_id from weekly_reports where weekly_reports.id = weekly_report_events.report_id))
  );

create policy weekly_report_events_insert on weekly_report_events
  for insert with check (
    is_admin() or is_client_manager((select client_id from weekly_reports where weekly_reports.id = weekly_report_events.report_id))
  );

comment on table weekly_reports is
  'Um report por (client_id, period_start, period_end) — reprocessamento sempre reaproveita a mesma linha (nunca duplica). metrics/body_text recalculados a cada reprocessamento até o texto ser editado manualmente (text_edited_at) ou o report ser marcado como enviado (status = enviado, daí a linha inteira para de ser tocada pelo cron).';
comment on table weekly_report_events is
  'Histórico imutável (nunca UPDATE/DELETE) de cada geração automática e ação manual sobre um report — inclui o texto exato enviado/editado em cada ponto, mesmo que a linha principal seja sobrescrita depois.';
