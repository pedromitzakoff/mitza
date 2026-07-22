-- Corrige uma lacuna real encontrada em produção: "Gestor principal"
-- (clients.primary_manager_id — o campo exibido em toda a plataforma,
-- "Gestor: Fulano" no cabeçalho do cliente) e "Gestores de apoio"
-- (client_managers — checklist separado no formulário de edição) eram
-- fontes de autorização DIFERENTES. `is_client_manager()` só olhava
-- client_managers, então um gestor que é o principal de um cliente mas
-- nunca foi manualmente adicionado também aos "Gestores de apoio" não
-- conseguia escrever nada que dependesse desta função — não só
-- "Atualizar performance", mas tarefas, comentários, revisões de conta,
-- atualizações pro cliente e relatórios mensais (toda policy que já usava
-- is_client_manager, ver grep no repositório).
--
-- Dali pra frente: ser Gestor principal de um cliente PASSA a valer como
-- "sou responsável por este cliente" em qualquer lugar que já confiava em
-- is_client_manager() — nenhuma dessas policies precisa ser reescrita,
-- porque todas chamam esta mesma função central.
--
-- Rode depois de supabase/manager-write-sprint-performance.sql.

create or replace function is_client_manager(p_client_id uuid) returns boolean as $$
  select exists (
    select 1 from client_managers cm
    join team_members tm on tm.id = cm.user_id
    where cm.client_id = p_client_id and tm.auth_user_id = auth.uid() and tm.status = 'ativo'
  ) or exists (
    select 1 from clients c
    join team_members tm on tm.id = c.primary_manager_id
    where c.id = p_client_id and tm.auth_user_id = auth.uid() and tm.status = 'ativo'
  );
$$ language sql stable security definer set search_path = public;
