"use client";

import { useState } from "react";
import { formatMoneyDisplay, parseMoneyInput } from "@/lib/money-format";

/**
 * Input monetário reutilizável (Investimento planejado e Gasto real): campo
 * de texto livre pra digitação natural + reformatação só ao sair do campo
 * (blur), com um input hidden carregando sempre o valor numérico limpo —
 * nunca uma string formatada — pra a action do servidor receber um número
 * válido direto de `formData.get(name)`.
 *
 * `defaultValue: null` (Investimento manual multicanal — adoção de
 * `sprint_channel_spend`): estado "sem lançamento ainda" pra este canal —
 * nasce em branco (nunca "R$ 0,00" fabricado) e, se o gestor não digitar
 * nada, o hidden input submete string vazia — quem lê a action decide não
 * tocar esse canal (nunca grava override manual `0` sem o gestor ter
 * digitado nada; ver `updateSprintPerformanceAction`). Só limpar o campo
 * manualmente também volta pro estado em branco, mesmo que `defaultValue`
 * fosse um número.
 */
export function MoneyInput({
  name,
  defaultValue,
  autoFocus,
}: {
  name: string;
  defaultValue: number | null;
  autoFocus?: boolean;
}) {
  const [display, setDisplay] = useState(() => (defaultValue !== null ? formatMoneyDisplay(defaultValue) : ""));
  const numericValue = display.trim() === "" ? null : (parseMoneyInput(display) ?? 0);

  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs text-overview-text-secondary">R$</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(event) => setDisplay(event.target.value)}
        onBlur={() => setDisplay(numericValue !== null ? formatMoneyDisplay(numericValue) : "")}
        placeholder="0,00"
        autoFocus={autoFocus}
        className="w-24 rounded-md border border-overview-border px-2 py-1 text-xs text-overview-text-primary outline-none focus:border-overview-border-strong"
      />
      <input type="hidden" name={name} value={numericValue ?? ""} />
    </span>
  );
}
