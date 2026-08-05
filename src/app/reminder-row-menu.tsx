"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useFloatingMenuPosition, FloatingPortalPanel } from "@/lib/floating-menu";
import { useToast } from "@/app/toast-provider";
import { deleteReminderAction } from "./reminders-actions";

/** Menu "•••" de cada linha do módulo de Pendências — mesma estrutura de
 * `TaskRowMenu` (task-row.tsx), sem o modo de expansão inline (não existe
 * aqui) e sem gate por admin: a RLS de `reminders` já decide quem pode
 * excluir, um erro do servidor aparece por toast. */
export function ReminderRowMenu({ reminderId, reminderTitle, editHref }: { reminderId: string; reminderTitle: string; editHref: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const position = useFloatingMenuPosition(triggerRef, open, "right");

  function closeMenu() {
    setOpen(false);
    setConfirming(false);
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteReminderAction(reminderId);
      if (result?.error) {
        showToast(result.error, "error");
        setConfirming(false);
        return;
      }
      showToast(`"${reminderTitle}" excluída.`);
      closeMenu();
    });
  }

  return (
    <span className="relative z-10 inline-block shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mais ações da pendência"
        className="mitza-pressable rounded px-1 text-sm text-overview-text-muted transition-colors hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        •••
      </button>

      <FloatingPortalPanel
        open={open}
        position={position}
        onClose={closeMenu}
        role="menu"
        closeLabel="Fechar menu"
        className="w-40 -translate-x-full rounded-lg border border-overview-border bg-overview-surface p-1 shadow-[var(--shadow-float)]"
      >
        <Link
          href={editHref}
          scroll={false}
          role="menuitem"
          onClick={closeMenu}
          className="mitza-pressable block rounded-md px-2 py-1.5 text-left text-xs text-overview-text-primary hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          Editar
        </Link>

        {confirming ? (
          <div className="mt-0.5 flex items-center gap-1.5 px-2 py-1">
            <span className="text-[11px] text-overview-text-muted">Confirmar?</span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="mitza-pressable rounded px-1 text-[11px] font-medium text-overview-danger hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Excluindo..." : "Sim"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="mitza-pressable rounded px-1 text-[11px] text-overview-text-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Não
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            onClick={() => setConfirming(true)}
            className="mitza-pressable block w-full rounded-md px-2 py-1.5 text-left text-xs text-overview-danger hover:bg-overview-danger-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
          >
            Excluir
          </button>
        )}
      </FloatingPortalPanel>
    </span>
  );
}
