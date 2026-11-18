"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToastActionButton } from "@/app/toast-action-button";
import { useToast } from "@/app/toast-provider";
import { markAlertReviewedAction, followUpAlertTomorrowAction, resolveAlertManuallyAction } from "@/app/alerts/actions";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Aba "Alertas" (pedido, seção 3) — as 3 ações sobre UM alerta, no mesmo
 * menu "•••" já usado em Clientes/Equipe (`AdminActionsMenu`/`team-table.tsx`),
 * só que sem o `adminOnly` (qualquer membro ativo pode agir aqui, ver
 * `actions.ts`). Um alerta "resolvido" não mostra mais nenhuma ação — nada
 * a fazer com ele até reabrir automaticamente, se reaparecer.
 */
export function AlertActionsMenu({ alertId, status }: { alertId: string; status: AlertStatus }) {
  const [dialog, setDialog] = useState<"follow_up" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  if (status === "resolvido") return null;

  function closeDialog() {
    setDialog(null);
    setNote("");
  }

  function submit(action: (alertId: string, formData: FormData) => Promise<{ error?: string; message?: string }>) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("note", note);
      const result = await action(alertId, formData);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result.message) showToast(result.message);
      closeDialog();
    });
  }

  return (
    <>
      <details className="relative">
        <summary className="mitza-pressable flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          •••
        </summary>
        <div className="mitza-menu-in absolute right-0 z-10 mt-1 flex w-52 flex-col gap-0.5 rounded-md border border-overview-border bg-overview-surface p-1 shadow-[var(--shadow-float)]">
          <ToastActionButton
            action={() => markAlertReviewedAction(alertId)}
            pendingLabel="Registrando..."
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-overview-text-secondary hover:bg-overview-surface-hover"
          >
            Marcar como revisado
          </ToastActionButton>
          {status !== "acompanhamento" && (
            <button
              type="button"
              onClick={() => setDialog("follow_up")}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-overview-text-secondary hover:bg-overview-surface-hover"
            >
              Acompanhar amanhã
            </button>
          )}
          <button
            type="button"
            onClick={() => setDialog("resolve")}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-overview-text-secondary hover:bg-overview-surface-hover"
          >
            Resolver manualmente
          </button>
        </div>
      </details>

      {dialog === "follow_up" && (
        <ConfirmDialog
          title="Acompanhar amanhã"
          description="O alerta passa pra 'Em acompanhamento' — a próxima avaliação do dia completo decide se ele normalizou (resolve automático) ou se persiste (volta pra 'Precisa de atenção')."
          note={{ value: note, onChange: setNote, label: "Observação (opcional)", placeholder: 'Ex.: "Conta retomada após regularização do cartão. Acompanhar se o investimento normaliza amanhã."' }}
          confirmLabel="Acompanhar amanhã"
          confirmPendingLabel="Salvando..."
          pending={isPending}
          onCancel={closeDialog}
          onConfirm={() => submit(followUpAlertTomorrowAction)}
        />
      )}

      {dialog === "resolve" && (
        <ConfirmDialog
          title="Resolver manualmente"
          description="Marca este alerta como resolvido. Se a condição reaparecer, o mesmo alerta é reaberto automaticamente (histórico preservado)."
          note={{ value: note, onChange: setNote, label: "Por que está sendo resolvido?", placeholder: "Observação curta obrigatória", required: true }}
          confirmLabel="Resolver"
          confirmPendingLabel="Resolvendo..."
          pending={isPending}
          onCancel={closeDialog}
          onConfirm={() => submit(resolveAlertManuallyAction)}
        />
      )}
    </>
  );
}
