"use client";

import { useState } from "react";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";

/**
 * Input monetário reutilizável (Investimento planejado e Gasto real): campo
 * de texto livre pra digitação natural + reformatação só ao sair do campo
 * (blur), com um input hidden carregando sempre o valor numérico limpo —
 * nunca uma string formatada — pra a action do servidor receber um número
 * válido direto de `formData.get(name)`.
 */
export function MoneyInput({
  name,
  defaultValue,
  autoFocus,
}: {
  name: string;
  defaultValue: number;
  autoFocus?: boolean;
}) {
  const [display, setDisplay] = useState(() => formatMoneyDisplay(defaultValue));
  const numericValue = parseMoneyInput(display) ?? 0;

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-muted-foreground">R$</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(event) => setDisplay(event.target.value)}
        onBlur={() => setDisplay(formatMoneyDisplay(numericValue))}
        autoFocus={autoFocus}
        className="w-24 rounded-md border border-border px-2 py-1 text-xs text-foreground outline-none focus:border-zinc-500 dark:bg-zinc-900"
      />
      <input type="hidden" name={name} value={numericValue} />
    </span>
  );
}
