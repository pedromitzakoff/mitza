"use client";

export function DeleteTaskButton({
  action,
  taskTitle,
  returnTo,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  taskTitle: string;
  returnTo?: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Tem certeza que deseja excluir a tarefa "${taskTitle}"? Essa ação não pode ser desfeita.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <button
        type="submit"
        className={
          className ??
          "rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        }
      >
        Excluir tarefa
      </button>
    </form>
  );
}
