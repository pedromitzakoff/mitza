"use client";

import { useState, useTransition } from "react";
import { runBackfillAction } from "../sprint-task-templates-actions";
import { useToast } from "@/app/toast-provider";
import { SETTINGS_SECONDARY_BUTTON_CLASSES } from "../settings-shell";

/**
 * Etapa "Proteger backfill global" (Auditoria de Settings, item 2):
 * "Aplicar às sprints já existentes" verifica TODAS as sprints já
 * existentes, de qualquer cliente (a RPC não recebe filtro nenhum — ver
 * `backfill_sprint_tasks_from_templates()`, supabase/global-sprint-task-templates.sql),
 * e pode criar tarefas em sprints que já existem — nunca duplicando as que
 * já foram geradas (idempotente por `template_id`+`sprint_id`), mas isso não
 * era comunicado antes de clicar. Confirmação em diálogo (mesmo padrão de
 * `BulkDeleteConfirmDialog`, month-tasks-panel.tsx), com a prévia de alcance
 * já calculada no servidor (`clientCount`/`sprintCount`, sem query nova
 * além de uma coluna de `sprints`). Nenhuma regra de negócio muda — a RPC
 * continua exatamente a mesma, só passou a exigir um clique extra e
 * explícito.
 */
function BackfillConfirmDialog({
  clientCount,
  sprintCount,
  pending,
  onCancel,
  onConfirm,
}: {
  clientCount: number;
  sprintCount: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Cancelar"
        onClick={onCancel}
        disabled={pending}
        className="mitza-backdrop-in fixed inset-0 z-50 bg-black/30"
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-16 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="backfill-confirm-title"
          className="mitza-modal-in w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
        >
          <h2 id="backfill-confirm-title" className="text-sm font-semibold text-foreground">
            Aplicar templates às sprints já existentes?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ação retroativa: verifica todas as sprints já existentes, de qualquer cliente, e cria as tarefas que ainda
            faltam para os templates ativos hoje. Sprints que já têm a tarefa não são duplicadas.
          </p>
          <p className="mt-2 text-xs font-medium text-foreground">
            {clientCount} cliente{clientCount === 1 ? "" : "s"} · {sprintCount} sprint{sprintCount === 1 ? "" : "s"}{" "}
            serão verificad{sprintCount === 1 ? "a" : "as"}
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className={`px-3 py-1.5 text-sm ${SETTINGS_SECONDARY_BUTTON_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Aplicando..." : "Aplicar mesmo assim"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

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
        <BackfillConfirmDialog
          clientCount={clientCount}
          sprintCount={sprintCount}
          pending={isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
