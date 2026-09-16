"use client";

import { useState } from "react";

/**
 * Botão "Copiar mensagem" (pedido "Ajuste no conceito de Conquistas", seção
 * 6) — copia EXATAMENTE `message` (a mensagem pronta pra cliente já montada
 * por `achievement-messages.ts`), nunca nome do cliente, tags, data ou
 * qualquer outro metadado técnico. Mesmo padrão de Clipboard API já usado em
 * `report-share-link-panel.tsx` (`navigator.clipboard.writeText` + rótulo
 * temporário "Copiado", sem modal).
 */
export function CopyMessageButton({ message }: { message: string }) {
  const [label, setLabel] = useState("Copiar mensagem");

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    // O feed usa este botão dentro de uma linha inteira clicável (abre o
    // drawer de detalhe) — nunca deixar o clique de copiar também disparar
    // essa abertura.
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(message);
      setLabel("Copiado");
    } catch {
      setLabel("Não foi possível copiar");
    } finally {
      setTimeout(() => setLabel("Copiar mensagem"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mitza-pressable rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-overview-surface-hover hover:text-foreground"
    >
      {label}
    </button>
  );
}
