-- Limpeza opcional das tarefas de teste geradas pelo modelo antigo (por
-- cliente), antes de migrar para os templates globais.
--
-- Rode em duas etapas, uma de cada vez. NÃO precisa rodar isso se você não
-- se importa em manter as tarefas antigas de teste na lista (elas não geram
-- mais nada nem duplicam nada; rodar essa limpeza é só cosmético).
--
-- Rode depois de supabase/task-templates.sql e ANTES de
-- supabase/global-sprint-task-templates.sql (esse último já zera
-- tasks.template_id de qualquer forma; depois disso não dá mais pra
-- diferenciar "gerada por template antigo" de "tarefa manual").

-- ---------------------------------------------------------------------------
-- Passo 1 (preview): olha o que seria afetado antes de apagar qualquer coisa.
-- ---------------------------------------------------------------------------
select
  t.id,
  t.title,
  t.status,
  t.due_date,
  c.name as client_name,
  exists (
    select 1 from comments
    where commentable_type = 'task' and commentable_id = t.id
  ) as has_comment
from tasks t
join client_task_templates ctt on ctt.id = t.template_id
join clients c on c.id = t.client_id
order by c.name, t.due_date;

-- ---------------------------------------------------------------------------
-- Passo 2 (delete seguro): só apaga tarefa gerada por template antigo que
-- ainda está "pendente" e não tem nenhum comentário — ou seja, claramente
-- não foi tocada por ninguém. Tarefas concluídas ou comentadas nunca são
-- apagadas por esse script.
-- ---------------------------------------------------------------------------
delete from tasks t
using client_task_templates ctt
where t.template_id = ctt.id
  and t.status = 'pendente'
  and not exists (
    select 1 from comments
    where commentable_type = 'task' and commentable_id = t.id
  );
