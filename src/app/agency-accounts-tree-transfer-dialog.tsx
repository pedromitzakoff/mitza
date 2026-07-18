"use client";

import type { ClientTransferMode } from "./agency-accounts-tree-actions";

const CANCEL_CLASSES =
  "mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900";
const PRIMARY_CLASSES =
  "mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_CLASSES =
  "mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900";

/**
 * Confirmação da transferência de responsável (drag and drop da árvore
 * "Contas da Agência"). Mesmo padrão visual de `schedule-occurrence-drawer.tsx`
 * (`mitza-backdrop-in` + `mitza-modal-in`, `border-border bg-card`), só que
 * controlado por estado local do componente que arrasta (`agency-accounts-tree-client.tsx`)
 * em vez de rota/searchParam — a transferência nasce de um drop, não de
 * uma navegação.
 *
 * Duas variantes na mesma janela: sem atividades abertas do gestor
 * anterior, confirmação simples; havendo alguma, escolha explícita entre
 * "só a conta" e "conta + atividades abertas" (nunca conclusão implícita).
 */
export function AgencyTransferDialog({
  clientName,
  targetLabel,
  previousManagerName,
  openTaskCount,
  pending,
  onCancel,
  onConfirm,
}: {
  clientName: string;
  targetLabel: string;
  previousManagerName: string | null;
  openTaskCount: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (mode: ClientTransferMode) => void;
}) {
  const hasOpenTasks = openTaskCount > 0;

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
          {!hasOpenTasks ? (
            <>
              <h2 id="agency-transfer-title" className="text-sm font-semibold text-foreground">
                Transferir {clientName} para {targetLabel}?
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">O responsável principal da conta será alterado.</p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={pending} className={CANCEL_CLASSES}>
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => onConfirm("account_only")}
                  disabled={pending}
                  className={PRIMARY_CLASSES}
                >
                  {pending ? "Transferindo..." : "Transferir"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 id="agency-transfer-title" className="text-sm font-semibold text-foreground">
                Existem {openTaskCount} atividade{openTaskCount === 1 ? "" : "s"} aberta
                {openTaskCount === 1 ? "" : "s"} atribuída{openTaskCount === 1 ? "" : "s"} a {previousManagerName}.
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">O que deseja fazer?</p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => onConfirm("account_only")}
                  disabled={pending}
                  className={`${SECONDARY_CLASSES} w-full`}
                >
                  Transferir somente a conta
                </button>
                <button
                  type="button"
                  onClick={() => onConfirm("account_and_open_tasks")}
                  disabled={pending}
                  className={`${PRIMARY_CLASSES} w-full`}
                >
                  {pending ? "Transferindo..." : "Transferir conta e atividades abertas"}
                </button>
                <button type="button" onClick={onCancel} disabled={pending} className={`${CANCEL_CLASSES} w-full`}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
