"use client";

const CANCEL_CLASSES =
  "mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY_CLASSES =
  "mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Confirmação da transferência de responsável (drag and drop da árvore
 * "Contas da Agência"). Mesmo padrão visual de `schedule-occurrence-drawer.tsx`
 * (`mitza-backdrop-in` + `mitza-modal-in`, `border-border bg-card`), só que
 * controlado por estado local do componente que arrasta (`agency-accounts-tree-client.tsx`)
 * em vez de rota/searchParam — a transferência nasce de um drop, não de
 * uma navegação.
 *
 * KOFF Analytics — Etapa 1.9: a escolha "só a conta / conta + atividades
 * abertas" foi removida — a transferência sempre move só a responsabilidade
 * da conta agora, com uma única confirmação simples.
 */
export function AgencyTransferDialog({
  clientName,
  targetLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  clientName: string;
  targetLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Cancelar transferência"
        onClick={onCancel}
        disabled={pending}
        className="mitza-backdrop-in fixed inset-0 z-50 bg-black/30"
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-16 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="agency-transfer-title"
          className="mitza-modal-in w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
        >
          <h2 id="agency-transfer-title" className="text-sm font-semibold text-foreground">
            Transferir {clientName} para {targetLabel}?
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">O responsável principal da conta será alterado.</p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={pending} className={CANCEL_CLASSES}>
              Cancelar
            </button>
            <button type="button" onClick={onConfirm} disabled={pending} className={PRIMARY_CLASSES}>
              {pending ? "Transferindo..." : "Transferir"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
