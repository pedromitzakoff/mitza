"use client";

import { SubmitButton } from "@/app/submit-button";

export function DeleteTeamMemberButton({
  action,
  memberName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  memberName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Tem certeza que deseja excluir definitivamente "${memberName}"? O acesso e o cadastro serão apagados de vez — essa ação não pode ser desfeita.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton
        pendingChildren="Excluindo..."
        className="w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950"
      >
        Excluir definitivamente
      </SubmitButton>
    </form>
  );
}
