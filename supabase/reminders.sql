-- Módulo "Pendências" — Visão Geral da Agência. Registro RÁPIDO de assuntos
-- que precisam ser lembrados/resolvidos, deliberadamente independente de
-- tarefas/sprints/performance/otimizações (pedido explícito do usuário:
-- "não misturar pendências com tarefas dos clientes"). Nunca cria uma
-- tarefa automaticamente, nunca aparece dentro de uma sprint.
--
-- Nome da TABELA em inglês (`reminders`) de propósito, mesmo a UI usando
-- "Pendências" — o termo "pendências" já existe no produto com outro
-- significado (Core de diagnóstico: `diagnostics.pendencias` = tarefas em
-- aberto de um cliente, ver lib/metric-diagnostics.ts). São conceitos
-- diferentes; usar o mesmo nome de tabela colidiria com esse código já
-- existente.
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,

  title text not null,

  -- "Relacionado a": Agência (client_id null) ou um Cliente específico
  -- (client_id obrigatório) — nunca os dois, nunca nenhum.
  scope text not null check (scope in ('agency', 'client')),
  client_id uuid references clients (id) on delete cascade,
  check (
    (scope = 'client' and client_id is not null)
    or (scope = 'agency' and client_id is null)
  ),

  assignee_id uuid references team_members (id) on delete set null,
  due_date date,
  notes text,

  -- Só dois estados, de propósito (pedido explícito do usuário) — nunca
  -- status manual/prioridade/categoria/sprint/tipo.
  status text not null default 'pending' check (status in ('pending', 'done')),

  created_by uuid references team_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  completed_by uuid references team_members (id) on delete set null,
  completed_at timestamptz
);

create index if not exists reminders_org_status_idx on reminders (organization_id, status, due_date);
create index if not exists reminders_client_idx on reminders (client_id);
create index if not exists reminders_assignee_idx on reminders (assignee_id);

create or replace function set_reminders_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reminders_set_updated_at on reminders;
create trigger reminders_set_updated_at
  before update on reminders
  for each row execute function set_reminders_updated_at();

alter table reminders enable row level security;

-- Leitura aberta pra qualquer autenticado — mesmo padrão de colaboração já
-- usado em `tasks`/`comments` (ver supabase/operation-collaboration-rls.sql):
-- o filtro "Todas" do módulo precisa mostrar pendências da agência E de
-- qualquer cliente pra qualquer gestor, não só as suas.
drop policy if exists reminders_select on reminders;
create policy reminders_select on reminders
  for select using (auth.uid() is not null);

drop policy if exists reminders_insert on reminders;
create policy reminders_insert on reminders
  for insert with check (auth.uid() is not null and created_by = current_team_member_id());

-- Update cobre tanto "editar" quanto "concluir"/"restaurar" (mesma
-- operação SQL, `update`) — quem criou, quem é o responsável atual, ou
-- admin. Nunca restrito só a quem criou: o responsável precisa poder
-- concluir uma pendência atribuída a ele por outra pessoa.
drop policy if exists reminders_update on reminders;
create policy reminders_update on reminders
  for update
  using (is_admin() or created_by = current_team_member_id() or assignee_id = current_team_member_id())
  with check (is_admin() or created_by = current_team_member_id() or assignee_id = current_team_member_id());

drop policy if exists reminders_delete on reminders;
create policy reminders_delete on reminders
  for delete using (is_admin() or created_by = current_team_member_id());
