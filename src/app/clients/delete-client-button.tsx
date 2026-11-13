"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Etapa "Configurações do Cliente" (pedido explícito do usuário, ponto 3):
 * "Adicione confirmação explícita antes da exclusão de um cliente, mesmo
 * sendo soft-delete." — substitui a ausência de confirmação de antes
 * (Platform Continuity System 1.0: ações reversíveis executavam na hora,
 * sem diálogo) especificamente PARA ESTA ação, por pedido explícito e
 * reforçado do usuário nesta rodada; nenhuma outra ação reversível da
 * plataforma muda de comportamento. Mesmo `ConfirmDialog`/padrão de
 * trigger+`requestSubmit()` que `DeleteTeamMemberButton` já usa — nenhuma
 * segunda implementação de diálogo de confirmação.
 */
export function DeleteClientButton({
  action,
  clientName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  clientName: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action}>
      <DeleteClientTrigger clientName={clientName} onConfirm={() => formRef.current?.requestSubmit()} />
    </form>
  );
}

function DeleteClientTrigger({ clientName, onConfirm }: { clientName: string; onConfirm: () => void }) {
  const { pending } = useFormStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        className="mitza-pressable w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-950"
      >
        {pending ? "Excluindo..." : "Excluir cliente"}
      </button>
      {confirmOpen && (
        <ConfirmDialog
          title={`Excluir "${clientName}"?`}
          description="O cliente some das listagens e para de sincronizar com o Meta — sprints, tarefas e comentários ficam preservados, e dá pra restaurar depois em Configurações → Clientes excluídos."
          confirmLabel="Excluir cliente"
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
