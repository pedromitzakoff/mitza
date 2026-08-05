"use client";

import { useFormStatus } from "react-dom";

/**
 * Círculo "concluir" — mesma linguagem visual do checkbox de tarefa
 * (`task-row.tsx`: círculo colorido por urgência, nunca um checkbox
 * genérico), dentro de um `<form action={completeReminderAction.bind(null,
 * reminderId)}>` simples (progressive enhancement, mesmo padrão já usado
 * pelos toggles de `settings/*-list.tsx` — sem `useTransition` custom).
 */
export function ReminderCompleteButton({ tone }: { tone: "overdue" | "today" | "normal" }) {
  const { pending } = useFormStatus();
  const toneClass =
    tone === "overdue"
      ? "border-overview-danger"
      : tone === "today"
        ? "border-brand"
        : "border-overview-border-strong";

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Concluir pendência"
      title="Concluir"
      className={`mitza-pressable h-4 w-4 shrink-0 rounded-full border-2 bg-transparent hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    />
  );
}

/** "Ver concluídas" → Restaurar — texto simples, mesmo `<form>` + status. */
export function ReminderRestoreButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mitza-pressable rounded-md px-2 py-1 text-xs font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Restaurando..." : "Restaurar"}
    </button>
  );
}
