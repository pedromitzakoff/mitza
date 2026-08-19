"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/app/toast-provider";

/**
 * Botão pra ações cujo resultado não é óbvio na tela (convite enviado,
 * acesso revogado...) — chama a Server Action diretamente (sem
 * `<form action>`/redirect), mostra "processando" enquanto espera e, ao
 * terminar, dispara o toast único da plataforma ou um erro discreto
 * embaixo do próprio botão. Reaproveitado em vez de cada tela inventar sua
 * própria versão (Platform Continuity System 1.0).
 *
 * Etapa "Padronização Global de Estados de Interação": `focus-visible` na
 * base, mesmo raciocínio de `SubmitButton` — nenhum chamador precisa mais
 * lembrar de acrescentar isso na própria className.
 */
export function ToastActionButton({
  action,
  className,
  pendingLabel,
  children,
}: {
  action: () => Promise<{ error?: string; message?: string }>;
  className: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.message) showToast(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`${className} mitza-pressable focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {isPending ? pendingLabel : children}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
