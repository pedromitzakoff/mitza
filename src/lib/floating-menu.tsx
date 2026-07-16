"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

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

/**
 * Etapa "MITZA Interaction Engine v1.5" — extraído de `TaskRowMenu`
 * (`task-row.tsx`) e `ClientPerformanceGoalEditor`, que reimplementavam o
 * mesmo trio Portal + botão-backdrop + painel posicionado cada um do seu
 * jeito. Qualquer popover ancorado (menu de linha, seletor pequeno) que
 * precise escapar de um ancestral com `overflow: hidden`/stacking context
 * (ver doc de `useFloatingMenuPosition`) usa este componente em vez de
 * remontar o Portal na mão. Não estiliza o conteúdo interno — só entrega o
 * botão que fecha ao clicar fora (`aria-label={closeLabel}`) e o `<div>`
 * posicionado (`role`/`className` decididos por quem chama, já que menu de
 * ações e listbox de seleção têm papéis ARIA e larguras diferentes).
 */
export function FloatingPortalPanel({
  open,
  position,
  onClose,
  role,
  closeLabel,
  className,
  children,
}: {
  open: boolean;
  position: FloatingMenuPosition | null;
  onClose: () => void;
  role: "menu" | "listbox";
  closeLabel: string;
  className: string;
  children: ReactNode;
}) {
  if (!open || !position) return null;

  return createPortal(
    <>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="fixed inset-0 z-40" />
      <div role={role} className={`mitza-menu-in fixed z-50 ${className}`} style={{ top: position.top, left: position.left }}>
        {children}
      </div>
    </>,
    document.body,
  );
}
