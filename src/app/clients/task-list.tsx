"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { TaskRow, type TaskListItem } from "./task-row";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";

export type { TaskListItem };

/**
 * Ordem cronológica pura — due_date crescente, id como desempate estável.
 * O status (concluída, atrasada, hoje) não entra no critério: concluir uma
 * tarefa não deve fazer ela pular pro final da lista, só muda o visual
 * (check, cor) e as ações disponíveis, nunca a posição.
 */
export function orderTasks(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id));
}

/**
 * "Outras tarefas" (sem sprint vinculada) — Etapa "MITZA Workspace-First
 * Tasks 1.0": ganhou o mesmo cabeçalho com criação inline e a mesma lista
 * otimista (`useOptimisticTasks`) que `SprintTaskList` já usava, em vez de
 * um link fixo pra `/tasks/new` no `action` da `Section` que envolve este
 * componente (removido em `[id]/page.tsx`). Mesma Server Action
 * (`createTaskInlineAction`), mesmo contrato — só a superfície muda.
 */
export function TaskList({
  tasks,
  clientId,
  managers,
  isAdmin,
}: {
  tasks: TaskListItem[];
  clientId: string;
  managers: InlineTaskManagerOption[];
  isAdmin?: boolean;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const ordered = orderTasks(optimisticTasks);

  return (
    <div>
      <div className="flex justify-end">
        <InlineCreateTaskForm
          clientId={clientId}
          sprintId={null}
          managers={managers}
          onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
        />
      </div>

      {ordered.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientId={clientId}
              detailsHref={`/clients/${clientId}?task=${task.id}`}
              isAdmin={isAdmin}
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
