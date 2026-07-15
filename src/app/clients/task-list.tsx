import { EmptyState } from "@/components/ui/empty-state";
import { TaskRow, type TaskListItem } from "./task-row";

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

export function TaskList({ tasks, clientId }: { tasks: TaskListItem[]; clientId: string }) {
  const ordered = orderTasks(tasks);

  if (ordered.length === 0) {
    return <EmptyState>Nenhuma tarefa ainda.</EmptyState>;
  }

  return (
    <ul className="rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
      {ordered.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          clientId={clientId}
          detailsHref={`/clients/${clientId}?task=${task.id}`}
        />
      ))}
    </ul>
  );
}
