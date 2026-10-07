"use client";

import { useState, useTransition } from "react";
import { completeTaskAction } from "./tasks-actions";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), botão "Concluir" do
 * preview de Demandas (seção 24 do pedido: "permitir, quando simples,
 * concluir/reabrir"). `completeTaskAction` devolve `{error?: string}`
 * (nunca redireciona) — por isso precisa de um componente cliente pra
 * chamar a action e tratar o retorno, em vez de um `<form action>` puro
 * (que exigiria uma action que sempre devolve `void`). MESMA Server
 * Action que a Demandas completa já usa (`pendencia-row.tsx`), nenhuma
 * segunda implementação de "concluir".
 */
export function CockpitCompleteTaskButton({ taskId, clientId }: { taskId: string; clientId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await completeTaskAction(taskId, clientId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <span className="shrink-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="mitza-pressable rounded-md border border-overview-border px-1.5 py-0.5 text-[11px] font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Concluindo..." : "Concluir"}
      </button>
      {error && <span className="ml-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
