-- Habilitar Gestores 3.0: o gestor responsável por um cliente (principal
-- ou de apoio — is_client_manager()) passa a poder editar o Cadastro do
-- Cliente inteiro, não só arrastar entre pastas (Habilitar Gestores 2.0).
-- Criar/excluir cliente continuam exclusivos de admin — fora do pedido,
-- ações mais estruturais/destrutivas.
--
-- Rode depois de supabase/manager-move-clients-tree.sql.

-- ---------------------------------------------------------------------------
-- clients: o trigger de guarda agora libera qualquer coluna pro gestor
-- responsável (antes só primary_manager_id/wallet_position, do
-- drag-and-drop). Um gestor SEM relação com o cliente continua restrito
-- às mesmas 2 colunas (mover entre pastas continua sem exigir vínculo).
-- ---------------------------------------------------------------------------
create or replace function guard_client_manager_update() returns trigger as $$
begin
  if is_admin() then
    return new;
  end if;

  if is_client_manager(old.id) then
    return new;
  end if;

  if (to_jsonb(new) - 'primary_manager_id' - 'wallet_position')
    is distinct from
    (to_jsonb(old) - 'primary_manager_id' - 'wallet_position')
  then
    raise exception 'Somente admin ou o gestor responsável pode alterar dados cadastrais do cliente — outros gestores só podem mover entre pastas.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- client_managers ("Gestores de apoio"): editável pelo gestor responsável
-- também, já que o Cadastro salva essa lista junto com o resto.
-- ---------------------------------------------------------------------------
drop policy if exists client_managers_write on client_managers;
create policy client_managers_write on client_managers
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- account_review_cadences: configuração de cadência de revisões faz parte
-- do Cadastro (bloco Configurações Operacionais).
-- ---------------------------------------------------------------------------
drop policy if exists account_review_cadences_write on account_review_cadences;
create policy account_review_cadences_write on account_review_cadences
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- Storage (client-photos): upload/troca de foto do cliente, mesmo critério
-- — o id do cliente é sempre o primeiro segmento do caminho do arquivo
-- (`{clientId}/photo.{ext}`, ver uploadClientPhotoIfProvided).
-- ---------------------------------------------------------------------------
drop policy if exists client_photos_insert_admin on storage.objects;
create policy client_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'client-photos'
    and (is_admin() or is_client_manager((storage.foldername(name))[1]::uuid))
  );

drop policy if exists client_photos_update_admin on storage.objects;
create policy client_photos_update on storage.objects
  for update using (
    bucket_id = 'client-photos'
    and (is_admin() or is_client_manager((storage.foldername(name))[1]::uuid))
  )
  with check (
    bucket_id = 'client-photos'
    and (is_admin() or is_client_manager((storage.foldername(name))[1]::uuid))
  );
