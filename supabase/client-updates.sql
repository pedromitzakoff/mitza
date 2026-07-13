-- Etapa 59: Atualização para o Cliente — primeira evolução do sistema de
-- Análises da Conta (Etapa 57): gera, a partir de uma análise já registrada,
-- um texto pronto pra enviar ao cliente (só por template nesta versão,
-- nenhuma IA). Rode por último, depois de supabase/account-reviews.sql.
--
-- client_updates é a fonte de verdade do conteúdo/estado da atualização;
-- operational_events continua sendo só a camada histórica append-only
-- (mesma regra da Etapa 56/57) — nunca lida pra decidir estado atual.

-- ---------------------------------------------------------------------------
-- client_updates: no máximo uma atualização por análise nesta primeira
-- versão (account_review_id é unique, não só indexado) — evita duplicata a
-- cada clique em "Gerar atualização"; se já existir, o fluxo abre a
-- existente em vez de criar outra (aplicado na Server Action, não aqui).
-- ---------------------------------------------------------------------------
create table if not exists client_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  account_review_id uuid not null unique references account_reviews (id) on delete cascade,
  created_by uuid references team_members (id) on delete set null,

  content text not null,
  -- Preparado conceitualmente para 'ai' (seção 2 do pedido) — só 'template'
  -- é de fato gerado nesta etapa.
  generation_method text not null default 'template' check (generation_method in ('template', 'ai')),

  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  copied_at timestamptz,
  copied_by uuid references team_members (id) on delete set null,

  sent_at timestamptz,
  sent_by uuid references team_members (id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists client_updates_client_idx on client_updates (client_id, created_at desc);
create index if not exists client_updates_org_idx on client_updates (organization_id, created_at desc);

alter table client_updates enable row level security;

create policy client_updates_select on client_updates
  for select using (is_admin() or is_client_manager(client_id));

create policy client_updates_insert on client_updates
  for insert with check (
    (is_admin() or is_client_manager(client_id))
    and created_by = current_team_member_id()
  );

-- Diferente de account_reviews (imutável): aqui a edição do texto, copiar e
-- marcar enviada/não enviada fazem parte do próprio fluxo (seções 8-10 do
-- pedido) — sempre dentro do mesmo escopo de acesso do insert. Sem policy de
-- delete: uma atualização já gerada nunca é apagada.
create policy client_updates_update on client_updates
  for update using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- Taxonomia nova em operational_events — estende as constraints já
-- existentes em vez de criar uma tabela paralela de eventos (seção 13).
-- ---------------------------------------------------------------------------
alter table operational_events drop constraint if exists operational_events_event_type_check;
alter table operational_events add constraint operational_events_event_type_check check (event_type in (
  'team_member_created', 'team_member_updated', 'team_member_deactivated',
  'team_member_reactivated', 'team_member_invited', 'team_member_access_activated',
  'team_member_access_revoked',
  'client_created', 'client_manager_assigned', 'client_manager_changed', 'client_status_changed',
  'task_created', 'task_assigned', 'task_reassigned', 'task_due_date_changed',
  'task_completed', 'task_reopened',
  'optimization_completed',
  'meeting_scheduled', 'meeting_rescheduled', 'meeting_completed', 'meeting_cancelled',
  'creative_delivery_scheduled', 'creative_delivery_completed', 'creative_delivery_late',
  'monthly_budget_created', 'monthly_budget_changed',
  'monthly_report_started', 'monthly_report_ready_for_review', 'monthly_report_finalized',
  'monthly_report_reopened',
  'account_review_recorded', 'account_review_no_change', 'account_review_optimization_performed',
  'account_review_issue_identified', 'account_optimization_recorded',
  'client_update_generated', 'client_update_edited', 'client_update_copied',
  'client_update_marked_sent', 'client_update_marked_unsent'
));

alter table operational_events drop constraint if exists operational_events_entity_type_check;
alter table operational_events add constraint operational_events_entity_type_check check (entity_type in (
  'task', 'client', 'team_member', 'monthly_budget_change', 'monthly_report',
  'account_review', 'account_optimization', 'client_update'
));
