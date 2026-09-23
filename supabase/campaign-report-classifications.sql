-- Etapa "Separar o Relatório por finalidade das campanhas" — auditoria
-- completa em `AGENTS.md`/histórico da sessão. Objetivo: o Relatório de
-- Performance passa a ter duas visões (Resultados principais / Objetivos
-- secundários) sem misturar indicadores de naturezas diferentes.
--
-- Por que uma tabela NOVA, e não reaproveitar `client_campaign_goal_assignments`
-- (que já existe, da Etapa "Múltiplos Objetivos", e já faz quase a mesma
-- coisa — vincular campanha a um objetivo, manual, por `campaign_id`):
-- aquela tabela tem FK pra `client_goals` (só vincula a um objetivo que o
-- cliente já configurou, com meta mensal, avaliado por Saúde/Sprint/
-- Conquistas) e alimenta `computeGoalSpend`/`computeAssignmentCoverage`
-- (`lib/goal-spend.ts`) — soltar campanhas "awareness"/"alcance"/etc nela
-- contaminaria esse cálculo (que hoje só espera leads/sales/followers) e
-- exigiria toda uma cadeia de metas mensais que ninguém pediu pra essas
-- categorias. Esta tabela aqui é deliberadamente menor e sem nenhuma dessas
-- consequências: só "qual a finalidade real desta campanha", pro Relatório
-- decidir em qual visão ela aparece. `PerformanceGoal` (leads/sales/followers)
-- também não é estendido — é usado em 65+ arquivos (Sprint/Saúde/Conquistas/
-- Operação), todos com semântica de "meta com custo por resultado", que não
-- se aplica a métricas não-aditivas como alcance. Mesmo precedente já usado
-- neste projeto pra "carrinho" (`supabase/secondary-cart-metric.sql`):
-- categoria nova fica de fora do tipo compartilhado, vive só onde precisa.
--
-- Mesma disciplina de `client_campaign_goal_assignments`: chave de
-- identidade é SEMPRE `campaign_id` (nunca `campaign_name` — nome pode
-- mudar, id não), classificação é SEMPRE manual (nunca inferida do nome/
-- objective técnico da campanha/IA), ausência de linha = não classificada
-- (nunca um valor "sem finalidade" gravado) — uma campanha sem classificação
-- nunca é escondida, só fica fora da visão "Objetivos secundários" e
-- continua em "Resultados principais" com um aviso, nunca desaparece.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção. Rode este arquivo inteiro no SQL Editor
-- do Supabase.
create table if not exists campaign_report_classifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  channel text not null check (channel in ('meta', 'google', 'tiktok', 'linkedin', 'other')),
  campaign_id text not null,
  -- 'leads'/'sales' = Resultados principais; as outras 5 = Objetivos
  -- secundários. A visão em si é sempre DERIVADA desta coluna em código
  -- (`lib/report-view-classification.ts`, `resolveReportView`) — nunca
  -- gravada separadamente, pra nunca poder ficar inconsistente com a
  -- finalidade.
  purpose text not null check (
    purpose in ('leads', 'sales', 'awareness', 'reach', 'followers', 'profile_visits', 'traffic')
  ),
  assigned_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, channel, campaign_id)
);

create index if not exists campaign_report_classifications_client_purpose_idx
  on campaign_report_classifications (client_id, purpose);

create or replace function set_campaign_report_classifications_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists campaign_report_classifications_set_updated_at on campaign_report_classifications;
create trigger campaign_report_classifications_set_updated_at
  before update on campaign_report_classifications
  for each row execute function set_campaign_report_classifications_updated_at();

comment on table campaign_report_classifications is
  'Classificação manual do gestor: qual a finalidade REAL de cada campanha, pra separar o Relatório em Resultados principais (leads/sales) e Objetivos secundários (awareness/reach/followers/profile_visits/traffic). Independente de client_goals/client_campaign_goal_assignments — nunca alimenta meta mensal/Saúde/Sprint/Conquistas. Deletar (não um enum "sem finalidade") representa uma campanha não classificada — ela nunca desaparece do Relatório por isso, só não entra em Objetivos secundários.';
comment on column campaign_report_classifications.purpose is
  'Fonte de verdade é SEMPRE a escolha explícita do gestor — nunca inferência por nome/objective técnico da campanha/IA (a Meta não expõe, na integração via Stract, nenhuma coluna confiável com a finalidade real).';

alter table campaign_report_classifications enable row level security;

create policy campaign_report_classifications_select on campaign_report_classifications
  for select using (is_admin() or is_client_manager(client_id));

create policy campaign_report_classifications_write on campaign_report_classifications
  for all using (is_admin()) with check (is_admin());
