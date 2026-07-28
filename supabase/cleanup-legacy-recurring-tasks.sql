-- Ativação final do novo modelo de tarefa recorrente (Checar saldo/Reportar
-- cliente/Otimização) — rode isto só depois que TODAS as fases de interface
-- (lista única → badge → drawer → drawer de Otimização → pendências →
-- configuração) estiverem prontas e testadas. Decisão explícita do usuário
-- (28/07): nenhum período intermediário sem os gestores conseguirem ver as
-- recorrências — por isso o schema (`supabase/recurring-tasks.sql`) já pode
-- rodar antes, sem risco (é só aditivo, tabelas vazias), mas ISTO AQUI —
-- que desativa o modelo antigo e apaga as pendências antigas — só depois
-- que a interface nova já estiver no ar.
--
-- Rode em três etapas, uma de cada vez.

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

-- ---------------------------------------------------------------------------
-- Passo 3 (ativação): desativa o modelo antigo pros 3 tipos oficiais de
-- recorrência (otimizacao já estava desativado desde a Etapa 57 — isto aqui
-- cobre verificacao_saldo/report também). A partir daqui, nenhuma tarefa
-- nova é gerada por esses templates — o gestor só vê as recorrências pela
-- interface nova. Templates do tipo 'outro' (fora do escopo desta reforma,
-- se existirem) continuam funcionando exatamente como hoje.
-- ---------------------------------------------------------------------------
update sprint_task_templates set is_active = false where type in ('otimizacao', 'verificacao_saldo', 'report');
