"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/app/toast-provider";
import { updateReportTextAction } from "@/app/reports/actions";

/**
 * "Editar texto" (pedido, seção 4) — 2 campos: "Próximo passo" (estruturado,
 * opcional) e o texto final (textarea livre, pré-preenchida com o texto
 * atual). Se o gestor deixar a textarea EXATAMENTE como veio e só mudar o
 * próximo passo, a Server Action religa o novo próximo passo no template
 * (`didGestorEditBodyTextVerbatim`); se ele mexer no texto, a palavra dele
 * vale literal — o gestor nunca precisa saber dessa regra pra usar o
 * diálogo, ela só evita que mudar só o próximo passo obrigue a reescrever
 * o resto do texto à mão.
 *
 * Mesmo visual de `ConfirmDialog` (`components/ui/confirm-dialog.tsx`),
 * mas com 2 campos — não reaproveitado direto porque aquele componente só
 * suporta 1 `note`.
 */
export function ReportEditDialog({
  reportId,
  initialNextStep,
  initialBodyText,
  onClose,
}: {
  reportId: string;
  initialNextStep: string;
  initialBodyText: string;
  onClose: () => void;
}) {
  const [nextStep, setNextStep] = useState(initialNextStep);
  const [bodyText, setBodyText] = useState(initialBodyText);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const titleId = "report-edit-dialog-title";

  function handleSave() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("nextStep", nextStep);
      formData.set("bodyText", bodyText);
      const result = await updateReportTextAction(reportId, formData);
      if (result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result.message) showToast(result.message);
      onClose();
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Cancelar"
        onClick={onClose}
        disabled={isPending}
        className="mitza-backdrop-in fixed inset-0 z-50 bg-black/30"
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="mitza-modal-in flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg"
        >
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            Editar texto
          </h2>

          <label className="flex flex-col gap-1 text-sm text-foreground">
            Próximo passo (opcional)
            <input
              type="text"
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              placeholder='Ex.: "Testar uma nova abertura no vídeo de depoimento."'
              disabled={isPending}
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-foreground">
            Texto para copiar
            <textarea
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              rows={10}
              disabled={isPending}
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            />
          </label>

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="mitza-pressable rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
