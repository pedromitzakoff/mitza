"use client";

import { restoreClientAction } from "@/app/clients/actions";
import { ToastActionButton } from "@/app/toast-action-button";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings-shell";

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
      className={`shrink-0 px-3 py-1.5 text-sm ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}
    >
      Restaurar
    </ToastActionButton>
  );
}
