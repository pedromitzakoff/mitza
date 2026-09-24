-- Etapa "Gestão de Funis Estratégicos por Cliente" — auditoria completa
-- rodada antes desta migration (ver artifact da sessão). Decisão central:
-- NÃO criar uma quarta fonte de verdade pra "finalidade da campanha".
--
-- `campaign_report_classifications` (Etapa "Separar o Relatório por
-- finalidade das campanhas", sessão anterior) tinha exatamente o mesmo
-- grão e a mesma disciplina que um vínculo campanha→funil precisa
-- (campaign_id, manual, nunca inferido, ausência = pendente) — só o
-- "alvo" era um enum fixo de 7 valores em vez de um funil configurável
-- pelo painel. Essa tabela tem ZERO linhas em produção até o momento desta
-- migration (nenhum cliente tem `campaign_id_column` configurado ainda) —
-- por isso é seguro TRANSFORMÁ-LA em vez de criar uma tabela nova: ela
-- vira `campaign_funnel_assignments`, a coluna `purpose` (enum fixo) vira
-- `funnel_id` (FK pra `client_funnels`, configurável).
--
-- Responsabilidade de cada conceito (nunca confundidos):
--   - Funil estratégico (NOVO, `client_funnels`): agrupamento definido
--     pelo gestor — Captação/Vendas/Distribuição de Conteúdo/o que for —,
--     configurável pelo painel, nunca uma lista fixa em código.
--   - Classificação da campanha (`campaign_funnel_assignments`, esta
--     migration): qual funil cada campanha real pertence — fonte ÚNICA
--     desse vínculo, sempre por campaign_id, sempre manual.
--   - Meta de resultado (`client_goals`/`monthly_budget_changes`,
--     INTOCADAS): um funil PODE linkar opcionalmente a um
--     `client_goals.result_type` já configurado pra herdar contagem de
--     resultado/meta real — nunca duplicamos o armazenamento de meta
--     aqui. FK composta garante que só se linka a um objetivo que o
--     cliente realmente tem configurado (mesmo padrão de
--     client_campaign_goal_assignments).
--   - Objetivo técnico da Meta (`campaign_daily_metrics.result_type`/
--     `metric_mappings`, INTOCADOS): continua só um sinal técnico
--     auxiliar, nunca decide o funil sozinho.
--
-- `client_goals`/`client_campaign_goal_assignments` continuam servindo só
-- o card "Objetivos da conta"/"Objetivos secundários" da página do
-- cliente — fora do escopo desta entrega, nenhuma mudança de
-- comportamento pra quem já usa isso.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste
-- projeto que altera schema já em produção. Rode este arquivo inteiro no
-- SQL Editor do Supabase.

-- ---------------------------------------------------------------------------
-- client_funnels: identidade + configuração de cada funil estratégico de
-- um cliente. Chave de nomenclatura (`naming_key`) é o texto reconhecido
-- entre colchetes no nome da campanha (`[CAPTACAO]`) pra SUGERIR um funil
-- — nunca decide sozinha (auditoria seção 3: "a sugestão não é uma
-- classificação definitiva"). Editável a qualquer momento; mudar a chave
-- nunca reclassifica campanhas já confirmadas (isso é garantido pela
-- própria natureza do vínculo: `campaign_funnel_assignments.funnel_id`
-- aponta pro FUNIL, nunca é recalculado a partir da chave depois de
-- confirmado).
-- ---------------------------------------------------------------------------
create table if not exists client_funnels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  -- Sem colchetes armazenados (só o texto) — a UI/sugestão sempre
  -- procura por `[` || naming_key || `]` (case-insensitive) no nome da
  -- campanha; guardar com colchetes duplicaria a decisão de formato em
  -- todo lugar que lê esta coluna.
  naming_key text not null check (naming_key <> '' and naming_key = upper(naming_key)),
  is_active boolean not null default true,
  -- Vínculo OPCIONAL a um objetivo já configurado em client_goals, pra
  -- este funil herdar contagem de resultado/meta real (nunca duplicamos
  -- armazenamento de meta aqui). Null = funil sem meta de resultado
  -- vinculada (ex.: Distribuição de Conteúdo) — investimento continua
  -- sempre disponível independente disso.
  linked_result_type text check (linked_result_type is null or linked_result_type in ('leads', 'sales', 'followers')),
  -- Indicadores que a Visão por Funil do Relatório mostra pra este funil
  -- — subconjunto de {'results','impressions','reach','clicks'}, validado
  -- pela aplicação (nunca uma lista arbitrária). 'results' só tem efeito
  -- real quando linked_result_type está preenchido E a campanha tem
  -- resultado confiável (ver lib/client-funnels.ts) — sem isso, a
  -- aplicação já ignora 'results' mesmo se selecionado, nunca fabrica
  -- número. Investimento é sempre mostrado, não entra nesta lista.
  relevant_indicators text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Chave única case-insensitive por cliente — nunca duas chaves iguais
  -- (mesmo com capitalização diferente) apontando pra funis diferentes,
  -- o que tornaria a sugestão ambígua por construção.
  unique (client_id, naming_key),
  -- FK composta: só linka a um objetivo que o cliente já tem configurado
  -- em client_goals — mesmo padrão de client_campaign_goal_assignments
  -- (client-goals.sql:440).
  foreign key (client_id, linked_result_type) references client_goals (client_id, result_type)
);

create index if not exists client_funnels_client_id_idx on client_funnels (client_id);

create or replace function set_client_funnels_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_funnels_set_updated_at on client_funnels;
create trigger client_funnels_set_updated_at
  before update on client_funnels
  for each row execute function set_client_funnels_updated_at();

comment on table client_funnels is
  'Funil estratégico configurável por cliente (Captação/Vendas/Distribuição de Conteúdo/o que o gestor definir) — nunca uma lista fixa em código. Representa a ESTRATÉGIA do gestor, nunca o objetivo técnico da Meta (esse é campaign_daily_metrics.result_type, sempre auxiliar).';
comment on column client_funnels.naming_key is
  'Texto reconhecido entre colchetes no nome da campanha (ex.: "CAPTACAO" reconhece "[CAPTACAO] | WhatsApp | Público aberto") — só SUGERE um funil, nunca classifica sozinho. Editável a qualquer momento; mudar aqui nunca reclassifica campanhas já confirmadas.';
comment on column client_funnels.linked_result_type is
  'Vínculo opcional a client_goals.result_type — nunca um armazenamento de meta próprio. Null = funil sem meta de resultado vinculada (ex.: Distribuição de Conteúdo), continua funcionando só com investimento.';
comment on column client_funnels.relevant_indicators is
  'Subconjunto de {results,impressions,reach,clicks} — quais indicadores a Visão por Funil mostra além de investimento (sempre mostrado). "results" só produz número real quando linked_result_type está preenchido e a campanha tem resultado confiável.';

alter table client_funnels enable row level security;

create policy client_funnels_select on client_funnels
  for select using (is_admin() or is_client_manager(client_id));

create policy client_funnels_write on client_funnels
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- campaign_funnel_assignments: transforma campaign_report_classifications
-- (zero linhas em produção — seguro transformar em vez de criar do zero).
-- Mesma disciplina de sempre: campaign_id (nunca nome), manual (nunca
-- inferido), ausência de linha = pendente (nunca escondida do Relatório,
-- nunca um valor "sem funil" gravado).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'campaign_report_classifications')
     and not exists (select 1 from information_schema.tables where table_name = 'campaign_funnel_assignments') then
    alter table campaign_report_classifications rename to campaign_funnel_assignments;
  end if;
end $$;

-- Cobre também o caso de quem nunca chegou a rodar
-- campaign-report-classifications.sql (a tabela simplesmente não existe
-- ainda) — cria já no formato novo.
create table if not exists campaign_funnel_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  campaign_id text not null,
  assigned_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, channel, campaign_id)
);

-- Remove a coluna do modelo antigo (enum fixo de 7 finalidades) e
-- introduz o vínculo com o funil configurável. Seguro por causa do `do $$`
-- acima: só chega aqui uma tabela com zero linhas reais.
alter table campaign_funnel_assignments drop column if exists purpose;
alter table campaign_funnel_assignments add column if not exists funnel_id uuid references client_funnels (id) on delete cascade;
alter table campaign_funnel_assignments alter column funnel_id set not null;

-- Confirmação explícita — "o gestor deve poder confirmar ou corrigir a
-- classificação" (auditoria seção 3). Sugestão automática NUNCA grava
-- aqui sozinha; só existe linha depois de uma ação explícita do gestor
-- (individual ou em lote), por isso confirmed_at é sempre preenchido na
-- escrita, nunca um valor "pendente de confirmação" dentro da tabela —
-- pendente é sempre ausência de linha.
alter table campaign_funnel_assignments add column if not exists confirmed_at timestamptz not null default now();

create index if not exists campaign_funnel_assignments_client_funnel_idx on campaign_funnel_assignments (client_id, funnel_id);

create or replace function set_campaign_funnel_assignments_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaign_funnel_assignments_set_updated_at on campaign_funnel_assignments;
drop trigger if exists campaign_report_classifications_set_updated_at on campaign_funnel_assignments;
create trigger campaign_funnel_assignments_set_updated_at
  before update on campaign_funnel_assignments
  for each row execute function set_campaign_funnel_assignments_updated_at();

comment on table campaign_funnel_assignments is
  'Classificação manual do gestor: qual funil estratégico cada campanha real pertence — FONTE ÚNICA deste vínculo (nunca duplicada em outra tabela). Sempre por campaign_id (nunca campaign_name — nome é só exibição/sugestão). Deletar (não um "sem funil" gravado) representa campanha pendente — nunca desaparece do Relatório por isso, só fica fora da Visão por Funil e some do "pendentes" quando reclassificada. Renomear a campanha nunca altera o vínculo já confirmado (a chave de identidade é sempre campaign_id). Mudar client_funnels.naming_key nunca reclassifica linhas já confirmadas aqui — essas só mudam por ação explícita do gestor.';

alter table campaign_funnel_assignments enable row level security;

drop policy if exists campaign_report_classifications_select on campaign_funnel_assignments;
drop policy if exists campaign_report_classifications_write on campaign_funnel_assignments;

create policy campaign_funnel_assignments_select on campaign_funnel_assignments
  for select using (is_admin() or is_client_manager(client_id));

create policy campaign_funnel_assignments_write on campaign_funnel_assignments
  for all using (is_admin()) with check (is_admin());
