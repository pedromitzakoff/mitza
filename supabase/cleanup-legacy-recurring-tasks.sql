-- Limpeza do modelo antigo de tarefa recorrente (Checar saldo/Reportar
-- cliente/Otimização), depois de rodar supabase/recurring-tasks.sql.
-- Decisão explícita do usuário (28/07): remover TODAS as pendências
-- existentes desse modelo, sem migrar nada — o novo modelo (recurring_tasks
-- + recurring_task_executions) começa limpo, sem histórico herdado.
--
-- Rode em duas etapas, uma de cada vez.

-- ---------------------------------------------------------------------------
-- Passo 1 (preview): olha o que seria afetado antes de apagar qualquer coisa.
-- has_comment é só informativo aqui — a decisão foi apagar mesmo assim.
-- ---------------------------------------------------------------------------
select
  t.id,
  t.title,
  t.type,
  t.status,
  t.due_date,
  c.name as client_name,
  exists (
    select 1 from comments
    where commentable_type = 'task' and commentable_id = t.id
  ) as has_comment
from tasks t
join sprint_task_templates stt on stt.id = t.template_id
join clients c on c.id = t.client_id
where stt.type in ('otimizacao', 'verificacao_saldo', 'report')
  and t.status = 'pendente'
order by c.name, t.due_date;

-- ---------------------------------------------------------------------------
-- Passo 2 (delete): apaga todas as pendentes do modelo antigo pros 3 tipos
-- oficiais de recorrência — inclusive as que têm comentário (decisão
-- explícita: começar limpo, sem exceção). Tarefas já concluídas não são
-- tocadas (permanecem como histórico).
-- ---------------------------------------------------------------------------
delete from tasks t
using sprint_task_templates stt
where t.template_id = stt.id
  and stt.type in ('otimizacao', 'verificacao_saldo', 'report')
  and t.status = 'pendente';
