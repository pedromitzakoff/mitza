"use client";

import { runBackfillAction } from "../sprint-task-templates-actions";
import { ToastActionButton } from "@/app/toast-action-button";

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
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black transition-opacity hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
    >
      Aplicar às sprints já existentes
    </ToastActionButton>
  );
}
