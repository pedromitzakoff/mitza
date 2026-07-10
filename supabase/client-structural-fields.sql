-- Etapa 27: dados estruturais do cliente (cadastro/manutenção, além do
-- operacional). Tudo opcional e aditivo — nenhuma coluna existente muda,
-- nenhuma linha é apagada. RLS de `clients` não muda: `clients_write` já é
-- admin-only e `clients_select` já cobre admin/gestor-do-cliente, então as
-- colunas novas herdam a mesma proteção sem policy nova.
-- Rode depois de supabase/soft-delete-clients.sql.

-- ---------------------------------------------------------------------------
-- Identificação
-- ---------------------------------------------------------------------------
alter table clients add column if not exists legal_name text;
alter table clients add column if not exists status text not null default 'ativo'
  check (status in ('ativo', 'pausado', 'encerrado'));
alter table clients add column if not exists contract_start_date date;
alter table clients add column if not exists contract_end_date date;
alter table clients add column if not exists renewal_date date;
alter table clients add column if not exists primary_manager_id uuid references profiles (id) on delete set null;

create index if not exists clients_status_idx on clients (status);
create index if not exists clients_primary_manager_id_idx on clients (primary_manager_id);

-- ---------------------------------------------------------------------------
-- Contato principal e financeiro
-- ---------------------------------------------------------------------------
alter table clients add column if not exists main_contact_name text;
alter table clients add column if not exists main_contact_role text;
alter table clients add column if not exists main_contact_email text;
alter table clients add column if not exists main_contact_phone text;
alter table clients add column if not exists financial_contact_name text;
alter table clients add column if not exists financial_contact_email text;
alter table clients add column if not exists financial_contact_phone text;

-- ---------------------------------------------------------------------------
-- Presença digital
-- ---------------------------------------------------------------------------
alter table clients add column if not exists instagram_url text;
alter table clients add column if not exists website_url text;
alter table clients add column if not exists facebook_url text;
alter table clients add column if not exists commercial_whatsapp text;

-- ---------------------------------------------------------------------------
-- Operação de mídia — monthly_planned_spend é só um valor de referência do
-- cliente; a sprint continua sendo a única fonte operacional semanal
-- (planned_spend de `sprints` não é tocado por nada aqui).
-- ---------------------------------------------------------------------------
alter table clients add column if not exists meta_ad_account_name text;
alter table clients add column if not exists main_objective text
  check (main_objective is null or main_objective in ('leads', 'vendas', 'reservas', 'reconhecimento', 'trafego', 'outro'));
alter table clients add column if not exists monthly_planned_spend numeric(12, 2);
alter table clients add column if not exists primary_kpi text;
alter table clients add column if not exists primary_kpi_target text;
alter table clients add column if not exists operational_summary text;
alter table clients add column if not exists important_notes text;

-- ---------------------------------------------------------------------------
-- Comercial — contracted_services como array simples (sem tabela própria
-- nesta etapa); validação da lista de valores permitidos fica na aplicação.
-- ---------------------------------------------------------------------------
alter table clients add column if not exists agency_monthly_fee numeric(12, 2);
alter table clients add column if not exists billing_due_day smallint
  check (billing_due_day is null or (billing_due_day between 1 and 31));
alter table clients add column if not exists contracted_services text[];
alter table clients add column if not exists notice_period_days integer;

-- ---------------------------------------------------------------------------
-- Contexto estratégico
-- ---------------------------------------------------------------------------
alter table clients add column if not exists main_product_or_service text;
alter table clients add column if not exists operation_region text;
alter table clients add column if not exists primary_audience text;
alter table clients add column if not exists client_differentials text;
alter table clients add column if not exists client_restrictions text;
alter table clients add column if not exists important_seasonal_dates text;
