-- MITZA 2.0 — Workspace Pessoal: quarta camada de informação (privada do
-- gestor), separada do Prontuário/Tarefas/Timeline (todos compartilhados).
-- Uma nota pertence só a quem criou — nem outro gestor, nem admin, veem
-- pela interface: RLS não abre exceção nenhuma pra is_admin(), diferente
-- de quase toda outra tabela do MITZA.

create table if not exists workspace_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references team_members(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  is_pinned boolean not null default false,
  -- Contexto é só informativo (de onde a nota nasceu) — nunca vincula a
  -- nota a um cliente/registro real, só guarda o caminho e o rótulo pra
  -- mostrar "Criada em: X" e voltar lá com um clique.
  context_path text,
  context_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_notes_user_id_idx on workspace_notes (user_id, updated_at desc);

alter table workspace_notes enable row level security;

drop policy if exists workspace_notes_select on workspace_notes;
create policy workspace_notes_select on workspace_notes
  for select using (user_id = current_team_member_id());

drop policy if exists workspace_notes_insert on workspace_notes;
create policy workspace_notes_insert on workspace_notes
  for insert with check (user_id = current_team_member_id());

drop policy if exists workspace_notes_update on workspace_notes;
create policy workspace_notes_update on workspace_notes
  for update using (user_id = current_team_member_id())
  with check (user_id = current_team_member_id());

drop policy if exists workspace_notes_delete on workspace_notes;
create policy workspace_notes_delete on workspace_notes
  for delete using (user_id = current_team_member_id());

create or replace function set_workspace_notes_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists workspace_notes_set_updated_at on workspace_notes;
create trigger workspace_notes_set_updated_at
  before update on workspace_notes
  for each row execute function set_workspace_notes_updated_at();
