"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const DEFAULT_CLASSES =
  "mitza-pressable rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950";

/** Etapa "Padronização Global de Feedback": `window.confirm()` (nativo do
 * navegador, fora da linguagem visual da plataforma) trocado pelo mesmo
 * `ConfirmDialog` usado em qualquer outra ação destrutiva — nenhuma regra
 * muda (mesma Server Action, mesmo texto de aviso), só a UI de confirmação
 * passa a ser a única da plataforma. O botão real vira `type="button"` (só
 * abre o diálogo); confirmar dispara `form.requestSubmit()` no `<form>`
 * de verdade — `useFormStatus`, lido de dentro dele, continua sendo a
 * única fonte de "pending" (nenhum estado duplicado). */
export function DeleteTaskButton({
  action,
  taskTitle,
  returnTo,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  taskTitle: string;
  returnTo?: string;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action}>
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <DeleteTaskTrigger
        taskTitle={taskTitle}
        className={className}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </form>
  );
}

function DeleteTaskTrigger({
  taskTitle,
  className,
  onConfirm,
}: {
  taskTitle: string;
  className?: string;
  onConfirm: () => void;
}) {
  const { pending } = useFormStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        className={`${className ?? DEFAULT_CLASSES} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? "Excluindo..." : "Excluir tarefa"}
      </button>
      {confirmOpen && (
        <ConfirmDialog
          title={`Excluir a tarefa "${taskTitle}"?`}
          description="Essa ação não pode ser desfeita."
          confirmLabel="Excluir tarefa"
          confirmPendingLabel="Excluindo..."
          tone="destructive"
          pending={pending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onConfirm();
          }}
        />
      )}
    </>
  );
}
