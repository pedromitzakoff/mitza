"use client";

import { restoreClientAction } from "@/app/clients/actions";
import { ToastActionButton } from "@/app/toast-action-button";

/**
 * "Restaurar" é o exemplo clássico de ação cujo resultado some da tela
 * (o cliente sai da própria lista de excluídos) — sem toast, o gestor não
 * teria nenhuma confirmação de que funcionou (Platform Continuity System
 * 1.0, seção "Confirmação de sucesso sem navegar").
 */
export function RestoreClientButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  return (
    <ToastActionButton
      action={async () => {
        await restoreClientAction(clientId);
        return { message: `${clientName} foi restaurado.` };
      }}
      pendingLabel="Restaurando..."
      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
    >
      Restaurar
    </ToastActionButton>
  );
}
