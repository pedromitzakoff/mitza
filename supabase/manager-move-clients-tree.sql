-- Habilita qualquer gestor ativo a arrastar clientes entre pastas na árvore
-- "Contas da Agência" — reordenar dentro da mesma pasta e mover pra outro
-- gestor, exatamente como o admin já fazia (Etapa "Habilitar Gestores
-- 2.0", moveClientAction/getOpenTaskCountForManagerAction em
-- src/app/agency-accounts-tree-actions.ts). Sem restrição por carteira —
-- é literalmente o que a árvore serve pra fazer: mover um cliente PRA uma
-- pasta que ainda não é a do gestor.
--
-- Escrita em `clients` continua estreita: só `primary_manager_id` e
-- `wallet_position` (as 2 colunas que o drag-and-drop de fato grava) ficam
-- liberadas pra qualquer gestor ativo — todo o resto (nome, conta Meta,
-- dados contratuais/financeiros/estruturais, soft delete etc., ver
-- client-structural-fields.sql) continua exclusivo de admin, via o
-- trigger abaixo, que compara o registro inteiro exceto essas 2 colunas
-- (usando to_jsonb — imune a colunas novas adicionadas no futuro, ao
-- contrário de uma lista explícita das colunas proibidas). Criar/excluir
-- cliente também continua exclusivo de admin.
--
-- Rode depois de supabase/is-client-manager-include-primary.sql.

drop policy if exists clients_write on clients;

create policy clients_insert on clients
  for insert with check (is_admin());

create policy clients_delete on clients
  for delete using (is_admin());

create policy clients_update on clients
  for update using (is_admin() or current_team_member_id() is not null)
  with check (is_admin() or current_team_member_id() is not null);

create or replace function guard_client_manager_update() returns trigger as $$
begin
  if is_admin() then
    return new;
  end if;

  if (to_jsonb(new) - 'primary_manager_id' - 'wallet_position')
    is distinct from
    (to_jsonb(old) - 'primary_manager_id' - 'wallet_position')
  then
    raise exception 'Somente admin pode alterar dados cadastrais do cliente — gestor só pode mover entre pastas.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists clients_guard_manager_update on clients;
create trigger clients_guard_manager_update
  before update on clients
  for each row execute function guard_client_manager_update();
