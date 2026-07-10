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
    return <p className="text-sm text-zinc-500">Nenhuma tarefa ainda.</p>;
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-border">
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
