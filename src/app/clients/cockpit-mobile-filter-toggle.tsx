"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { CockpitGlobalFilterBar } from "./cockpit-global-filter-bar";
import type { NameFilterMode } from "@/lib/performance-report/report-filter-recompute";

/**
 * Etapa "Otimizacao mobile - Fase 1" (pedido explicito do usuario): no
 * celular, o filtro de campanhas (select + busca) deixa de ficar sempre
 * visivel na linha de filtros - vira um botao "Filtros" que abre um painel
 * com os MESMOS controles de sempre (`CockpitGlobalFilterBar`, nenhuma
 * segunda logica/estado de filtro - mesma URL/parametros de sempre). O
 * ponto colorido no botao reaproveita `isFilterActive`, que ja vinha pronto
 * do modelo (mesma fonte que a mensagem "Pagina filtrada" de sempre).
 *
 * `lg:hidden` no botao / `hidden lg:block` na barra inline (ver
 * `cockpit-view.tsx`) sao as duas metades do mesmo corte: exatamente uma
 * das duas apresentacoes fica visivel em cada largura.
 */
export function CockpitMobileFilterToggle({
  initialText,
  initialMode,
  isFilterActive,
}: {
  initialText: string;
  initialMode: NameFilterMode;
  isFilterActive: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="mitza-pressable inline-flex items-center gap-1.5 rounded-full border border-overview-border bg-overview-surface px-3 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Filtros
        {isFilterActive && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand" />}
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-2 w-[min(92vw,22rem)] rounded-lg border border-overview-border bg-overview-surface p-3 shadow-lg">
          <CockpitGlobalFilterBar initialText={initialText} initialMode={initialMode} />
        </div>
      )}
    </div>
  );
}
