"use client";

import { useState, useTransition } from "react";
import { updateClientPerformanceGoalAction } from "./performance-actions";
import { useToast } from "@/app/toast-provider";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS, type PerformanceGoal } from "@/lib/performance-goals";

/**
 * Etapa "Refinamento de Densidade..." (Parte 3) — configurar o objetivo de
 * performance direto na Sprint, sem navegar até a edição do cliente. Popover
 * compacto (mesmo padrão de `mitza-menu-in` já usado em outros menus
 * pequenos da plataforma) em vez de drawer — só 2 opções, não precisa de
 * mais estrutura que isso. Sem redirect: a Server Action só revalida as
 * telas que mostram o objetivo; o popover fecha e o toast único da
 * plataforma confirma o sucesso, sem perder scroll nem o que está expandido.
 */
export function ClientPerformanceGoalEditor({
  clientId,
  currentGoal,
}: {
  clientId: string;
  currentGoal: PerformanceGoal | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  function handleSelect(goal: PerformanceGoal) {
    setError(null);
    startTransition(async () => {
      const result = await updateClientPerformanceGoalAction(clientId, goal);
      if (result.error) {
        setError(result.error);
        return;
      }
      showToast("Objetivo de performance atualizado.");
      setOpen(false);
    });
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mitza-pressable rounded text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        Objetivo: {currentGoal ? PERFORMANCE_GOALS[currentGoal].label : "não configurado"}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Fechar seleção de objetivo"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            role="listbox"
            className="mitza-menu-in absolute left-0 z-50 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-float)]"
            style={{ top: "100%" }}
          >
            {PERFORMANCE_GOAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === currentGoal}
                disabled={isPending}
                onClick={() => handleSelect(option.value)}
                className={`mitza-pressable block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 ${
                  option.value === currentGoal ? "font-medium text-brand" : "text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </span>
  );
}
