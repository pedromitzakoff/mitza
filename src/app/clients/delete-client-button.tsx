"use client";

import { SubmitButton } from "@/app/submit-button";

/**
 * Excluir cliente é reversível (soft delete + restauração em Configurações
 * > Clientes excluídos) — por isso não bloqueia mais com `window.confirm()`
 * antes de agir (Platform Continuity System 1.0: ações reversíveis
 * executam na hora, sem confirmação; a mesma regra já valia pra "Desativar
 * membro" da Equipe).
 */
export function DeleteClientButton({
  action,
}: {
  action: () => void;
}) {
  return (
    <form action={action}>
      <SubmitButton
        pendingChildren="Excluindo..."
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >
        Excluir cliente
      </SubmitButton>
    </form>
  );
}
