"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Etapa "Padronização Global de Feedback": `window.confirm()` nativo
 * trocado pelo mesmo `ConfirmDialog` usado em qualquer outra ação
 * destrutiva da plataforma — nenhuma regra muda (mesma Server Action,
 * mesmo texto de aviso). Ver `delete-task-button.tsx` para o mesmo padrão
 * (trigger `type="button"` + `requestSubmit()` no `<form>` real, pending
 * lido de dentro dele via `useFormStatus`). */
export function DeleteTeamMemberButton({
  action,
  memberName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  memberName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action}>
      <DeleteTeamMemberTrigger memberName={memberName} onConfirm={() => formRef.current?.requestSubmit()} />
    </form>
  );
}

function DeleteTeamMemberTrigger({ memberName, onConfirm }: { memberName: string; onConfirm: () => void }) {
  const { pending } = useFormStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        className="w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950"
      >
        {pending ? "Excluindo..." : "Excluir definitivamente"}
      </button>
      {confirmOpen && (
        <ConfirmDialog
          title={`Excluir "${memberName}" definitivamente?`}
          description="O acesso e o cadastro serão apagados de vez — essa ação não pode ser desfeita."
          confirmLabel="Excluir definitivamente"
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
