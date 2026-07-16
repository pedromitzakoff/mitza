"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { updateClientPerformanceGoalAction } from "./performance-actions";
import { useToast } from "@/app/toast-provider";
import { useFloatingMenuPosition } from "@/lib/floating-menu";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS, type PerformanceGoal } from "@/lib/performance-goals";

/**
 * Etapa "Refinamento de Densidade..." (Parte 3) — configurar o objetivo de
 * performance direto na Sprint, sem navegar até a edição do cliente. Popover
 * compacto (mesmo padrão de `mitza-menu-in` já usado em outros menus
 * pequenos da plataforma) em vez de drawer — só 2 opções, não precisa de
 * mais estrutura que isso. Sem redirect: a Server Action só revalida as
 * telas que mostram o objetivo; o popover fecha e o toast único da
 * plataforma confirma o sucesso, sem perder scroll nem o que está expandido.
 *
 * Etapa "Sprint Workspace Polish 1.0" (Parte 7): o gatilho virou uma badge
 * discreta (pílula com borda, sem cor chamativa) em vez de texto sublinhado
 * — fica mais fácil de identificar como o valor atual do objetivo, e o
 * hover/focus já deixam claro que é clicável. O rótulo "Objetivo:" saiu
 * daqui de dentro: quem chama (`SprintPerformanceSection`) já mostra esse
 * rótulo fora, uma vez só — nunca "Objetivo: Objetivo: Vendas".
 *
 * Etapa "Sprint Workspace Polish 2.0" (Parte 2/9): popover passou a
 * renderizar via Portal (mesmo motivo/técnica de `TaskRowMenu` em
 * `task-row.tsx`) — dentro da sprint-piloto do protótipo de accordion
 * (`accordionRowsPrototype`), o `overflow: hidden` da animação clipava este
 * popover também.
 *
 * Etapa "Sprint Workspace Polish 2.0" (Parte 4): `triggerClassName`/
 * `triggerLabel` opcionais permitem reaproveitar este MESMO componente e a
 * mesma Server Action no botão "Configurar objetivo" da linha "Próxima
 * ação" (`sprint-card.tsx`) — mesmo padrão visual de botão secundário
 * (`SECONDARY_ACTION_BUTTON_CLASSES`) em vez da pílula discreta de sempre.
 * Omitir os dois preserva exatamente o comportamento/visual anterior (só a
 * toolbar de Performance usa o padrão), então nenhum outro uso muda.
 *
 * Etapa "MITZA Interaction Engine v1" (Parte 2/5): o gatilho agora mostra o
 * objetivo escolhido na hora (`useOptimistic`), sem esperar a revalidação
 * — a Server Action já não redirecionava (Platform Continuity System 1.0),
 * só faltava a interface parar de esperar por ela. Rollback automático: se
 * a troca falhar, `currentGoal` (a prop real) nunca muda, e o
 * `useOptimistic` volta sozinho pro valor real assim que a transition
 * termina. O toast também passou a dizer qual objetivo foi escolhido (Parte
 * 7 — "toast inteligente"), não só "atualizado".
 */
export function ClientPerformanceGoalEditor({
  clientId,
  currentGoal,
  triggerClassName,
  triggerLabel,
}: {
  clientId: string;
  currentGoal: PerformanceGoal | null;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [optimisticGoal, setOptimisticGoal] = useOptimistic(currentGoal);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const position = useFloatingMenuPosition(triggerRef, open, "left");

  function handleSelect(goal: PerformanceGoal) {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      setOptimisticGoal(goal);
      const result = await updateClientPerformanceGoalAction(clientId, goal);
      if (result.error) {
        setError(result.error);
        return;
      }
      showToast(`Objetivo alterado para ${PERFORMANCE_GOALS[goal].label}.`);
    });
  }

  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Objetivo: ${optimisticGoal ? PERFORMANCE_GOALS[optimisticGoal].label : "não configurado"} — clique para alterar`}
        className={
          triggerClassName ??
          "mitza-pressable rounded-full border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {triggerLabel ?? (optimisticGoal ? PERFORMANCE_GOALS[optimisticGoal].label : "Não configurado")}
      </button>

      {open &&
        position &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Fechar seleção de objetivo"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
            />
            <div
              role="listbox"
              className="mitza-menu-in fixed z-50 w-40 rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-float)]"
              style={{ top: position.top, left: position.left }}
            >
              {PERFORMANCE_GOAL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === optimisticGoal}
                  disabled={isPending}
                  onClick={() => handleSelect(option.value)}
                  className={`mitza-pressable block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 ${
                    option.value === optimisticGoal ? "font-medium text-brand" : "text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}

      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </span>
  );
}
