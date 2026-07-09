"use client";

export function DeleteClientButton({
  action,
  clientName,
}: {
  action: () => void;
  clientName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Tem certeza que deseja excluir "${clientName}"? Essa ação não pode ser desfeita.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >
        Excluir cliente
      </button>
    </form>
  );
}
