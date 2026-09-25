-- Etapa "Pendências" — evolução do sistema de tarefas já existente (`tasks`)
-- em vez de um sistema paralelo. Decisão de arquitetura (ver relatório de
-- entrega): `tasks` já tinha grão certo (cliente, responsável via
-- team_members, prazo, recorrência, sprint, contadores de auditoria) — só
-- faltava prioridade, status intermediários (em andamento/aguardando/
-- bloqueado) e a possibilidade de existir sem cliente (pendência interna).
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção.

-- ---------------------------------------------------------------------------
-- 1. Prioridade — dimensão nova, nunca existiu em `tasks`. Default 'normal'
-- pra toda tarefa já existente (nunca uma prioridade "chutada" mais alta ou
-- mais baixa — normal é o ponto neutro, consistente com "não force o
-- usuário a decidir prioridade de tarefas antigas").
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists priority text not null default 'normal';

alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks add constraint tasks_priority_check
  check (priority in ('urgente', 'alta', 'normal', 'baixa'));

comment on column tasks.priority is
  'Prioridade operacional (Etapa "Pendências") — urgente/alta/normal/baixa. Default "normal" pra nunca forçar o gestor a decidir prioridade de uma tarefa antiga na migração.';

-- ---------------------------------------------------------------------------
-- 2. Novos status intermediários — "em_andamento"/"aguardando"/"bloqueado"
-- somam ao enum existente (nunca substituem/removem "pendente"/"feito"/
-- "atrasado"/"nao_realizado" — nenhuma linha existente muda de valor).
-- "atrasado" continua sendo SÓ um status derivado em tempo de leitura
-- (`lib/task-status.ts`, `effectiveTaskStatus`) — nunca gravado
-- diretamente por nenhum caminho de escrita da aplicação; continua no CHECK
-- só porque já era um valor historicamente aceito (nunca removido).
-- ---------------------------------------------------------------------------
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('pendente', 'em_andamento', 'aguardando', 'bloqueado', 'feito', 'atrasado', 'nao_realizado'));

comment on column tasks.status is
  'Status gravado da tarefa. "atrasado" nunca é escrito pela aplicação (é sempre derivado de due_date em tempo de leitura, ver lib/task-status.ts) — mantido no CHECK só por compatibilidade histórica. "em_andamento"/"aguardando"/"bloqueado" adicionados na Etapa "Pendências".';

-- ---------------------------------------------------------------------------
-- 3. client_id opcional — permite pendência interna (sem cliente
-- associado). Nenhuma policy de RLS precisa mudar: is_client_manager()
-- já ignora o parâmetro desde a Etapa "Corrige modelo de autorização"
-- (current_team_member_id() is not null, independente de client_id) —
-- is_client_manager(null) se comporta exatamente igual a qualquer outro
-- valor.
-- ---------------------------------------------------------------------------
alter table tasks alter column client_id drop not null;

comment on column tasks.client_id is
  'Cliente associado — null = pendência interna da agência (Etapa "Pendências"). sprint_id só faz sentido quando client_id está preenchido (sprints são sempre de um cliente); nenhuma constraint nova impõe isso — a aplicação nunca envia sprint_id numa pendência sem cliente.';

-- ---------------------------------------------------------------------------
-- 4. Corrige recurring_tasks.default_assignee_id — apontava pra `profiles`
-- desde a criação (nunca migrado junto com os outros ~9 FKs em
-- team-members.sql, achado confirmado nesta auditoria). Seguro reapontar
-- sem UPDATE de dados: team_members.id reaproveita exatamente o mesmo uuid
-- de profiles.id no backfill original (team-members.sql, "Backfill: um
-- team_member por profile existente") — todo valor já gravado em
-- default_assignee_id já é um team_members.id válido, só a constraint
-- apontava pra tabela errada.
-- ---------------------------------------------------------------------------
alter table recurring_tasks drop constraint if exists recurring_tasks_default_assignee_id_fkey;
alter table recurring_tasks add constraint recurring_tasks_default_assignee_id_fkey
  foreign key (default_assignee_id) references team_members (id) on delete set null;
