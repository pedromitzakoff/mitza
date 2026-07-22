-- MITZA 2.0 — Refinamento da Identidade do Cliente: foto (avatar_url) +
-- atalhos externos configuráveis (dashboard_url pro Looker Studio,
-- balance_url pra página de saldo). Nenhuma lógica operacional muda — são
-- só 3 colunas novas em `clients`, todas opcionais.
--
-- `client-avatar.tsx` já existe e já é usado pela Operação (`imageUrl`
-- sempre `null` até agora) — esta migration é a "infraestrutura de avatar
-- (upload, Storage, coluna)" que o comentário daquele componente já
-- previa.

alter table clients
  add column if not exists avatar_url text,
  add column if not exists dashboard_url text,
  add column if not exists balance_url text;

-- ---------------------------------------------------------------------------
-- Storage: bucket público pra fotos de cliente — nenhum dado sensível,
-- só a logo/foto exibida na identidade visual. Público pra a URL servir
-- direto no <img>, sem token/assinatura.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-photos', 'client-photos', true)
on conflict (id) do nothing;

drop policy if exists client_photos_select on storage.objects;
create policy client_photos_select on storage.objects
  for select using (bucket_id = 'client-photos');

drop policy if exists client_photos_insert_admin on storage.objects;
create policy client_photos_insert_admin on storage.objects
  for insert with check (bucket_id = 'client-photos' and is_admin());

drop policy if exists client_photos_update_admin on storage.objects;
create policy client_photos_update_admin on storage.objects
  for update using (bucket_id = 'client-photos' and is_admin())
  with check (bucket_id = 'client-photos' and is_admin());

drop policy if exists client_photos_delete_admin on storage.objects;
create policy client_photos_delete_admin on storage.objects
  for delete using (bucket_id = 'client-photos' and is_admin());
