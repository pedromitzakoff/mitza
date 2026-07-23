"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { TaskRow, type TaskListItem } from "./task-row";
import { orderTasks } from "./task-order";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";

export type { TaskListItem };

/**
 * "Outras tarefas" (sem sprint vinculada) — Etapa "MITZA Workspace-First
 * Tasks 1.0": ganhou o mesmo cabeçalho com criação inline e a mesma lista
 * otimista (`useOptimisticTasks`) que a Sprint já usava, em vez de um link
 * fixo pra `/tasks/new` no `action` da `Section` que envolve este
 * componente (removido em `[id]/page.tsx`). Mesma Server Action
 * (`createTaskInlineAction`), mesmo contrato — só a superfície muda.
 *
 * MITZA Unified Activities 1.0: esta lista continua fora da fila
 * "Atividades" de propósito — não existe revisão de conta pra unificar
 * aqui (tarefas soltas, sem sprint vinculada, não têm equivalente de
 * revisão), então não ganhou `typeLabel` nem CTA de revisão.
 */
export function TaskList({
  tasks,
  clientId,
  managers,
  isAdmin,
  canOperate = true,
}: {
  tasks: TaskListItem[];
  clientId: string;
  managers: InlineTaskManagerOption[];
  isAdmin?: boolean;
  /** Princípio "Workspace = só cliente ativo" — `false` quando o cliente
   * está pausado/encerrado: esconde a criação de tarefa e desabilita
   * "Marcar como feito" em cada linha (histórico continua visível).
   * Omitir preserva o comportamento de sempre (`true`). */
  canOperate?: boolean;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const ordered = orderTasks(optimisticTasks);

  return (
    <div>
      {canOperate && (
        <div className="flex justify-end">
          <InlineCreateTaskForm
            clientId={clientId}
            sprintId={null}
            managers={managers}
            onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
          />
        </div>
      )}

      {ordered.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientId={clientId}
              detailsHref={`/clients/${clientId}?task=${task.id}`}
              isAdmin={isAdmin}
              canOperate={canOperate}
              onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: task.id })}
              onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: task.id })}
            />
          ))}
        </ul>
      ) : (
        <EmptyState className="mt-1.5">Nenhuma tarefa ainda.</EmptyState>
      )}
    </div>
  );
}
