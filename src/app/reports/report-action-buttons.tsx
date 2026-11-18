"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/app/toast-provider";
import { markReportSentAction, undoReportSentAction } from "@/app/reports/actions";
import { ReportEditDialog } from "@/app/reports/report-edit-dialog";

/**
 * Aba "Reports" (pedido, seção 4: "Editar texto, Copiar para WhatsApp e
 * Marcar como enviado" num report pronto). "Copiar" é 100% client-side
 * (Clipboard API) — pedido explícito: "Copiar mantém o status atual",
 * nada pra persistir no servidor.
 */
export function ReportReadyActions({ reportId, bodyText, nextStep }: { reportId: string; bodyText: string; nextStep: string | null }) {
  const [dialog, setDialog] = useState<"edit" | "confirmSend" | null>(null);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  function handleCopy() {
    navigator.clipboard
      .writeText(bodyText)
      .then(() => showToast("Texto copiado."))
      .catch(() => showToast("Não foi possível copiar — selecione e copie manualmente.", "error"));
  }

  function handleMarkSent() {
    startTransition(async () => {
      const result = await markReportSentAction(reportId);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result.message) showToast(result.message);
      setDialog(null);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDialog("edit")}
          className="mitza-pressable rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-overview-surface-hover"
        >
          Editar texto
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="mitza-pressable flex-1 rounded-md border border-border px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-overview-surface-hover"
        >
          Copiar para WhatsApp
        </button>
        <button
          type="button"
          onClick={() => setDialog("confirmSend")}
          className="mitza-pressable flex-1 rounded-md bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-hover"
        >
          Marcar como enviado
        </button>
      </div>

      {dialog === "edit" && <ReportEditDialog reportId={reportId} initialNextStep={nextStep ?? ""} initialBodyText={bodyText} onClose={() => setDialog(null)} />}

      {dialog === "confirmSend" && (
        <ConfirmDialog
          title="Marcar como enviado"
          description="Registra quem marcou, a data e a versão final do texto. Dá pra desfazer depois, caso tenha sido por engano."
          confirmLabel="Marcar como enviado"
          confirmPendingLabel="Salvando..."
          pending={isPending}
          onCancel={() => setDialog(null)}
          onConfirm={handleMarkSent}
        />
      )}
    </>
  );
}

/** Aba "Reports" — "Desfazer" num report já enviado (pedido: "permita
 * desfazer uma marcação feita por engano"). O texto não regride; só os
 * campos de envio (quem/quando) são limpos e o status volta pra "Pronto
 * para enviar". */
export function ReportUndoSentButton({ reportId }: { reportId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  function handleUndo() {
    startTransition(async () => {
      const result = await undoReportSentAction(reportId);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result.message) showToast(result.message);
      setConfirming(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mitza-pressable self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-overview-surface-hover"
      >
        Desfazer
      </button>

      {confirming && (
        <ConfirmDialog
          title="Desfazer envio"
          description='Volta este report pra "Pronto para enviar". O texto continua como estava — só os dados de quem/quando enviou são limpos.'
          confirmLabel="Desfazer"
          confirmPendingLabel="Desfazendo..."
          pending={isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={handleUndo}
        />
      )}
    </>
  );
}
