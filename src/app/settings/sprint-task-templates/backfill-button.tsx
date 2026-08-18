"use client";

import { useState, useTransition } from "react";
import { runBackfillAction } from "../sprint-task-templates-actions";
import { useToast } from "@/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings-shell";

/**
 * Etapa "Proteger backfill global" (Auditoria de Settings, item 2) — depois
 * generalizada em "Padronização Global de Feedback": "Aplicar às sprints já
 * existentes" verifica TODAS as sprints já existentes, de qualquer cliente
 * (a RPC não recebe filtro nenhum — ver `backfill_sprint_tasks_from_templates()`,
 * supabase/global-sprint-task-templates.sql), e pode criar tarefas em
 * sprints que já existem — nunca duplicando as que já foram geradas
 * (idempotente por `template_id`+`sprint_id`), mas isso não era comunicado
 * antes de clicar. Confirmação via `ConfirmDialog` (componente
 * compartilhado — nenhum diálogo exclusivo desta tela), com a prévia de
 * alcance já calculada no servidor (`clientCount`/`sprintCount`, sem query
 * nova além de uma coluna de `sprints`). Nenhuma regra de negócio muda — a
 * RPC continua exatamente a mesma, só passou a exigir um clique extra e
 * explícito.
 */
export function BackfillButton({ clientCount, sprintCount }: { clientCount: number; sprintCount: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await runBackfillAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      showToast("Geração aplicada às sprints existentes.");
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className={`mitza-pressable px-3 py-1.5 text-sm ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}
      >
        Aplicar às sprints já existentes
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {confirmOpen && (
        <ConfirmDialog
          title="Aplicar templates às sprints já existentes?"
          description="Ação retroativa: verifica todas as sprints já existentes, de qualquer cliente, e cria as tarefas que ainda faltam para os templates ativos hoje. Sprints que já têm a tarefa não são duplicadas."
          scopeText={`${clientCount} cliente${clientCount === 1 ? "" : "s"} · ${sprintCount} sprint${sprintCount === 1 ? "" : "s"} serão verificad${sprintCount === 1 ? "a" : "as"}`}
          confirmLabel="Aplicar mesmo assim"
          confirmPendingLabel="Aplicando..."
          pending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
