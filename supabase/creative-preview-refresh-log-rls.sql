-- Correção de segurança: `creative_preview_refresh_log` (criada em
-- `supabase/creative-preview-refresh-log.sql`) nunca teve RLS habilitado —
-- achado do usuário ("existem tabelas sem proteção de RLS no sistema que eu
-- sei, precisamos corrigir isso"), confirmado comparando toda tabela já
-- criada nas migrações (`create table`) contra toda tabela com RLS
-- habilitado (`enable row level security`): das 59 tabelas do sistema, essa
-- foi a única sem proteção nenhuma — qualquer usuário autenticado na API
-- conseguia ler/escrever a linha de QUALQUER cliente, não só o seu.
--
-- Mesmo padrão já usado pras outras tabelas por `client_id`
-- (`ad_creative_daily_metrics`, ver `supabase/creative-analytics.sql`):
-- leitura liberada pra admin ou gestor daquele cliente (a tela de
-- Anúncios/Campanhas lê isso com o client normal da sessão, ver
-- `scheduleCreativePreviewRefreshIfStale` em
-- `src/lib/creative-preview-refresh.ts`); escrita restrita a admin (a
-- escrita de verdade usa o client ADMIN, que já ignora RLS via service
-- role — a política aqui é só a mesma camada de defesa que as outras
-- tabelas já têm, pro caso de algum dia ser acessada por um client comum).

alter table creative_preview_refresh_log enable row level security;

create policy creative_preview_refresh_log_select on creative_preview_refresh_log
  for select using (is_admin() or is_client_manager(client_id));

create policy creative_preview_refresh_log_write on creative_preview_refresh_log
  for all using (is_admin()) with check (is_admin());
