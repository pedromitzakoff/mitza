import type { SelectHTMLAttributes } from "react";

/** `<select>` com altura/borda/radius/tipografia consistentes com o resto
 * do Design System (Etapa 47) — usado na toolbar (gestor/carteira) e no
 * popover de filtros secundários da Visão Geral. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-7 rounded-md border border-overview-border bg-overview-surface px-2 text-xs text-overview-text-primary transition-colors hover:border-overview-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 ${className ?? ""}`}
      {...props}
    />
  );
}
