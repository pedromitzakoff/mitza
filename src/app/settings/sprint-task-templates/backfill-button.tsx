"use client";

import { runBackfillAction } from "../sprint-task-templates-actions";
import { ToastActionButton } from "@/app/toast-action-button";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings-shell";

/**
 * "Aplicar às sprints já existentes" não deixa nenhum rastro visível na
 * lista de templates — sem o toast, o gestor não teria como saber se
 * funcionou (Platform Continuity System 1.0).
 */
export function BackfillButton() {
  return (
    <ToastActionButton
      action={async () => {
        const result = await runBackfillAction();
        if (result.error) return { error: result.error };
        return { message: "Geração aplicada às sprints existentes." };
      }}
      pendingLabel="Aplicando..."
      className={`px-3 py-1.5 text-sm ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}
    >
      Aplicar às sprints já existentes
    </ToastActionButton>
  );
}
