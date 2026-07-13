"use client";

/**
 * Confirmação com o impacto ANTES de desativar (seção 17 do pedido) — mesmo
 * padrão de `DeleteClientButton` (window.confirm bloqueando o submit).
 */
export function DeactivateMemberButton({
  action,
  memberName,
  assignedClientsCount,
  pendingTasksCount,
}: {
  action: () => void;
  memberName: string;
  assignedClientsCount: number;
  pendingTasksCount: number;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const impact =
          assignedClientsCount === 0 && pendingTasksCount === 0
            ? "Nenhum cliente ou tarefa pendente está atribuído a este membro no momento."
            : `${assignedClientsCount} cliente(s) atribuído(s) e ${pendingTasksCount} tarefa(s) pendente(s) continuarão vinculados a este membro no histórico, mas ele deixa de aparecer nas novas atribuições.`;
        const confirmed = window.confirm(`Desativar "${memberName}"?\n\n${impact}`);
        if (!confirmed) event.preventDefault();
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        Desativar membro
      </button>
    </form>
  );
}
