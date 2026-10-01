"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export interface ClientContextSelectOption {
  value: string;
  label: string;
  href: string;
  active: boolean;
}

const TRIGGER_CLASSES =
  "flex items-center gap-1 rounded-md border border-overview-border bg-overview-surface px-2.5 py-1 text-sm font-medium text-overview-text-primary transition-colors hover:border-overview-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Dropdown de contexto compartilhado — Mês / Meta-Planejamento / Canal
 * (Etapa "Primeira Rodada Visual — Contexto + Performance"). Mesmo
 * mecanismo visual de `SearchableSelect` (`components/ui/searchable-select.tsx`,
 * `mitza-menu-in`/`shadow-[var(--shadow-float)]`/tokens `overview-*`) sem a
 * caixa de busca — as três listas (mês, objetivo, canal) são sempre curtas
 * o bastante pra não precisar de filtro, e cada opção é um `<Link>` real
 * (navegação de página inteira por querystring, nunca estado de cliente —
 * mesmo padrão que `VisaoGeralChannelSwitch` já usava antes desta etapa).
 *
 * Opções com `options.length <= 1` deveriam ser renderizadas como rótulo
 * estático por quem chama (mesmo critério que `VisaoGeralChannelSwitch` já
 * aplicava) — este componente não decide isso sozinho, só desenha o menu.
 */
export function ClientContextSelect({ label, options, ariaLabel }: { label: string; options: ClientContextSelectOption[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} className={TRIGGER_CLASSES}>
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-overview-text-secondary" aria-hidden="true" />
      </button>

      {open && (
        <>
          <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            className="mitza-menu-in absolute left-0 z-50 mt-1 w-56 rounded-xl border border-overview-border bg-overview-surface p-1.5 shadow-[var(--shadow-float)]"
            style={{ top: "100%", transformOrigin: "top left" }}
          >
            <ul role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto">
              {options.map((option) => (
                <li key={option.value}>
                  <Link
                    href={option.href}
                    scroll={false}
                    role="option"
                    aria-selected={option.active}
                    onClick={() => setOpen(false)}
                    className={`block rounded-md px-2 py-1.5 text-sm ${
                      option.active ? "font-medium text-brand" : "text-overview-text-primary hover:bg-overview-surface-hover"
                    }`}
                  >
                    {option.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
