"use client";

/**
 * Diálogo de confirmação — único componente de confirmação da plataforma
 * (Etapa "Padronização Global de Feedback"): antes existiam 3 implementações
 * praticamente idênticas espalhadas (`BulkDeleteConfirmDialog` em
 * `month-tasks-panel.tsx`, `BackfillConfirmDialog` em `backfill-button.tsx`,
 * e dois `window.confirm()` nativos em `delete-task-button.tsx`/
 * `delete-team-member-button.tsx`) — nenhuma nova regra de confirmação,
 * só a mesma estrutura (backdrop + `role="dialog"` + título + descrição +
 * Cancelar/Confirmar) reaproveitada em vez de reescrita a cada tela.
 *
 * Usa tokens de base (`border-border`/`bg-card`/`text-foreground`/
 * `text-muted-foreground`) mesmo quando embutido em telas que usam a família
 * `overview-*` (página do cliente) — as duas paletas são próximas o
 * suficiente (mesmo raciocínio já documentado em `globals.css`) pra não
 * gerar choque visual, e evita uma prop de variante só pra trocar de
 * família de cor.
 *
 * `tone="destructive"` é reservado pra ações que apagam/removem algo de
 * verdade; `tone="default"` (marca) serve pra ações retroativas/de alcance
 * amplo que não são destrutivas em si (ex.: o backfill de templates).
 */
export function ConfirmDialog({
  title,
  description,
  /** Linha extra opcional, em destaque — ex.: prévia de alcance
   * ("8 clientes · 34 sprints serão verificadas"). */
  scopeText,
  confirmLabel,
  confirmPendingLabel,
  tone = "default",
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  scopeText?: string;
  confirmLabel: string;
  confirmPendingLabel: string;
  tone?: "default" | "destructive";
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = "confirm-dialog-title";
  const confirmClasses =
    tone === "destructive"
      ? "mitza-pressable rounded-md border border-red-200 bg-transparent px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      : "mitza-pressable rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover";

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
          aria-labelledby={titleId}
          className="mitza-modal-in w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg"
        >
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          {scopeText && <p className="mt-2 text-xs font-medium text-foreground">{scopeText}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="mitza-pressable rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className={`${confirmClasses} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {pending ? confirmPendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
