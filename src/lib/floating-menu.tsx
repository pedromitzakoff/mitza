"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export interface FloatingMenuPosition {
  top: number;
  left: number;
}

/**
 * Etapa "Sprint Workspace Polish 2.0" (Parte 2) — popovers que vivem dentro
 * da sprint-piloto do protótipo de accordion (`accordionRowsPrototype`,
 * `mitza-accordion-rows-inner` em globals.css) ficavam parcialmente
 * escondidos, com sombra cortada e clique perdido: `overflow: hidden` num
 * ancestral clipa QUALQUER descendente, inclusive `position: fixed` (só
 * escapa desse clipping quem sai da subárvore via Portal). Este hook calcula
 * a posição em coordenadas de viewport a partir do elemento-gatilho — quem
 * usa o hook então renderiza o popover via `createPortal(..., document.body)`
 * com `position: fixed` nessas coordenadas, o que resolve o problema pra
 * qualquer ancestral com overflow/stacking context, não só o protótipo.
 * Recalcula em scroll/resize enquanto aberto, pra não "descolar" do gatilho.
 */
export function useFloatingMenuPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  align: "left" | "right" = "right",
): FloatingMenuPosition | null {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);

  useLayoutEffect(() => {
    // Não reseta pra `null` ao fechar: quem consome já condiciona a
    // renderização a `open && position`, então um valor desatualizado
    // parado no estado enquanto fechado é inerte — e reabrir recalcula do
    // zero de qualquer forma (efeito roda de novo com `open === true`).
    if (!open) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: align === "right" ? rect.right : rect.left,
      });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, anchorRef, align]);

  return position;
}
