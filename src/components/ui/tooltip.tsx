"use client";

import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 250;

/**
 * Etapa "MITZA Platform Constitution 1.0" (Wave 1 — Representação, E5):
 * primeiro componente oficial de tooltip da plataforma. Antes, texto
 * auxiliar usava o atributo nativo `title=""` — funciona, mas não é
 * acessível por teclado de um jeito consistente entre navegadores, não
 * escapa de `overflow: hidden` (mesmo problema que motivou o Portal dos
 * popovers, ver `floating-menu.tsx`) e não respeita `prefers-reduced-motion`
 * de propósito.
 *
 * Uso: `<Tooltip label="...">{trigger}</Tooltip>` — envolve o gatilho num
 * `<span style={{ display: "contents" }}>` (não participa do layout: o
 * gatilho continua sendo o item real dentro de qualquer flex/grid do
 * pai) que escuta hover/foco dos seus descendentes. Não usa
 * `cloneElement` de propósito — o compilador de React deste projeto
 * proíbe passar `ref` através de chamadas de função arbitrárias, e
 * `cloneElement` mexe no campo `ref` interno do elemento clonado mesmo
 * quando o código não pede isso explicitamente.
 *
 * Aparece com um pequeno atraso no hover (evita "piscar" ao passar o mouse
 * de leve) e imediatamente no foco por teclado (foco já é uma intenção
 * explícita, não precisa do mesmo atraso). Fecha com Esc, blur ou mouse
 * leave. `onFocus`/`onBlur` do React borbulham de descendentes focáveis
 * até este wrapper, então funciona com qualquer gatilho focável dentro
 * dele sem precisar saber qual elemento é.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  function clearShowTimer() {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function computePosition(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
  }

  function show(anchor: HTMLElement, immediate: boolean) {
    clearShowTimer();
    if (immediate) {
      computePosition(anchor);
      setOpen(true);
      return;
    }
    showTimer.current = setTimeout(() => {
      computePosition(anchor);
      setOpen(true);
    }, SHOW_DELAY_MS);
  }

  function hide() {
    clearShowTimer();
    setOpen(false);
  }

  return (
    <span
      style={{ display: "contents" }}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => show(event.currentTarget, false)}
      onMouseLeave={hide}
      onFocus={(event) => show(event.currentTarget, true)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      {children}
      {open && position
        ? createPortal(
            <span
              id={tooltipId}
              role="tooltip"
              className="fixed z-50 max-w-xs -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-100 shadow-[var(--shadow-float)] dark:bg-zinc-100 dark:text-zinc-900"
              style={{ top: position.top, left: position.left }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
