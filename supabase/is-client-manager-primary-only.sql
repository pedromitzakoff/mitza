-- Etapa "Simplificação do Cadastro do Cliente" — a KOFF não usa mais
-- "gestor de apoio" (`client_managers`) como modelo operacional: só ADMIN ou
-- o GESTOR PRINCIPAL do cliente (`clients.primary_manager_id`) devem ter
-- acesso de gestão a partir de agora.
--
-- `is_client_manager(p_client_id)` é o ÚNICO ponto de decisão dessa regra em
-- toda a plataforma — toda policy de escrita relevante (`client_managers`,
-- `account_review_cadences`, `client-photos` no Storage, `client_reports`,
-- `monthly_reports` e seus filhos, `account_reviews`, `client_goals`,
-- `monthly_budget_changes`, `sprint_channel_spend`, `recurring_tasks`,
-- várias outras) já chama `is_admin() or is_client_manager(client_id)` — ver
-- auditoria completa desta etapa (grep de `is_client_manager(` em
-- `supabase/*.sql`, nenhuma outra policy consulta `client_managers`
-- diretamente). Por isso a MENOR alteração segura pra remover "gestor de
-- apoio" da autorização é redefinir só esta função: nenhuma outra policy
-- precisa ser reescrita.
--
-- A versão anterior (`is-client-manager-include-primary.sql`) unia dois
-- sinais: linha em `client_managers` OU `clients.primary_manager_id`. Esta
-- versão remove o primeiro sinal — um registro legado em `client_managers`
-- sozinho deixa de conceder qualquer acesso. A tabela `client_managers` em
-- si NÃO é apagada (nenhuma migration destrutiva nesta etapa): fica como
-- estrutura física legada, sem nenhum consumidor de autorização.
create or replace function is_client_manager(p_client_id uuid) returns boolean as $$
  select exists (
    select 1 from clients c
    join team_members tm on tm.id = c.primary_manager_id
    where c.id = p_client_id and tm.auth_user_id = auth.uid() and tm.status = 'ativo'
  );
$$ language sql stable security definer set search_path = public;

-- `guard_client_manager_update()` (trigger em `clients`, `manager-edit-clients.sql`)
-- chama `is_client_manager(old.id)` — já herda a regra nova automaticamente,
-- nenhuma alteração própria necessária.
