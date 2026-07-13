import type { ReactNode } from "react";

/** Faixa compacta de toolbar — borda fina, sem sombra, sem virar um card
 * grande em volta dos filtros (seção 9 do pedido). */
export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5">
      {children}
    </div>
  );
}
