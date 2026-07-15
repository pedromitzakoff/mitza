"use client";

import { SubmitButton } from "@/app/submit-button";

/**
 * Desativar é seguro e reversível — existe "Reativar membro" logo ao lado,
 * assim que o drawer reabre (a Server Action devolve pro mesmo drawer, no
 * novo estado). Por isso não bloqueia mais com `window.confirm()` antes de
 * agir (Interaction Design System 1.0 — "executar imediatamente, oferecer
 * desfazer" em vez de "perguntar primeiro" sempre que a ação puder ser
 * desfeita com segurança).
 */
export function DeactivateMemberButton({ action }: { action: () => void }) {
  return (
    <form action={action}>
      <SubmitButton
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        pendingChildren="Desativando..."
      >
        Desativar membro
      </SubmitButton>
    </form>
  );
}
