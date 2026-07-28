"use client";

import { useState } from "react";
import { OPTIMIZATION_QUICK_GROUPS } from "@/lib/recurring-tasks";

function comboKey(type: string, action: string): string {
  return `${type}:${action}`;
}

/**
 * Registro rápido de Otimização por chips (refatoração do formulário —
 * decisão do usuário: "o gestor não pensa em categorias, pensa nas decisões
 * que tomou"). Clicar num chip seleciona (quantidade 1, chip muda de cor);
 * clicar de novo desseleciona. Com o chip já selecionado, um contador +/−
 * aparece do lado — ajusta quantas vezes aquela ação foi feita NESTA mesma
 * execução (ex.: "Pausei − 2 +" = pausou duas campanhas numa revisão só).
 * Seleção livre entre e dentro dos grupos (dá pra Pausar E Ativar campanhas
 * na mesma execução).
 *
 * O estado inteiro vira um JSON num input hidden
 * (`optimization_selections_json`), lido por `registerRecurringExecutionAction`
 * — o servidor nunca confia nele sem revalidar contra `OPTIMIZATION_QUICK_GROUPS`.
 */
export function OptimizationQuickPicker() {
  const [selections, setSelections] = useState<Record<string, number>>({});

  function toggle(type: string, action: string) {
    const key = comboKey(type, action);
    setSelections((current) => {
      if (key in current) {
        return Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key));
      }
      return { ...current, [key]: 1 };
    });
  }

  function adjust(type: string, action: string, delta: number) {
    const key = comboKey(type, action);
    setSelections((current) => {
      const nextQuantity = (current[key] ?? 1) + delta;
      if (nextQuantity <= 0) {
        return Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key));
      }
      return { ...current, [key]: nextQuantity };
    });
  }

  const payload = Object.entries(selections).map(([key, quantity]) => {
    const [type, action] = key.split(":");
    return { type, action, quantity };
  });

  return (
    <div className="flex flex-col gap-2.5">
      <input type="hidden" name="optimization_selections_json" value={JSON.stringify(payload)} />
      {OPTIMIZATION_QUICK_GROUPS.map((group) => (
        <div key={group.type}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.groupLabel}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {group.actions.map((quickAction) => {
              const key = comboKey(quickAction.type, quickAction.action);
              const quantity = selections[key];
              const isSelected = quantity !== undefined;
              return (
                <div
                  key={key}
                  className={`mitza-pressable flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    isSelected ? "border-brand bg-brand text-white" : "border-border text-muted-foreground hover:border-brand hover:text-brand"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(quickAction.type, quickAction.action)}
                    className="flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <span aria-hidden="true">{quickAction.icon}</span>
                    {quickAction.label}
                  </button>
                  {isSelected && (
                    <span className="ml-0.5 flex items-center gap-1 tabular-nums">
                      <button
                        type="button"
                        onClick={() => adjust(quickAction.type, quickAction.action, -1)}
                        aria-label={`Diminuir quantidade de "${quickAction.label}"`}
                        className="rounded-full px-1 hover:bg-white/20"
                      >
                        −
                      </button>
                      {quantity}
                      <button
                        type="button"
                        onClick={() => adjust(quickAction.type, quickAction.action, 1)}
                        aria-label={`Aumentar quantidade de "${quickAction.label}"`}
                        className="rounded-full px-1 hover:bg-white/20"
                      >
                        +
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
