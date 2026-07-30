"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/workspace/button";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { formatDateRange } from "@/lib/format";

/**
 * Etapa "Analytics Instagramável" (facelift): substitui o cabeçalho antigo —
 * título + range de texto + linha de pills + um formulário de 2 campos de
 * data SEMPRE visível (ocupava espaço permanente por uma ação rara). Mesmo
 * padrão de popover já usado em `AgencyFilters`/`ClientPerformanceGoalEditor`
 * (estado local `open`, backdrop fixo, painel `mitza-menu-in`) — nenhum
 * componente de popover novo, só reaproveitado aqui pela primeira vez fora
 * da Visão Geral/agência.
 *
 * Navegação continua 100% por querystring (Server Component acima decide os
 * dados a partir de `analyticsPreset`/`analyticsStart`/`analyticsEnd`) — o
 * único motivo de ser Client Component é abrir/fechar o popover e revelar o
 * seletor de datas personalizado só quando pedido.
 */
export function AnalyticsPeriodMenu({
  baseHref,
  activePreset,
  periodStart,
  periodEnd,
  customStart,
  customEnd,
}: {
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showCustomFields, setShowCustomFields] = useState(activePreset === "custom");
  const [start, setStart] = useState(customStart);
  const [end, setEnd] = useState(customEnd);

  function applyCustomRange() {
    if (!start || !end || end < start) return;
    router.push(`${baseHref}&analyticsPreset=custom&analyticsStart=${start}&analyticsEnd=${end}`);
    setOpen(false);
  }

  const activeLabel =
    activePreset === "custom"
      ? formatDateRange(periodStart, periodEnd)
      : (ANALYTICS_PERIOD_PRESET_OPTIONS.find((o) => o.value === activePreset)?.label ?? formatDateRange(periodStart, periodEnd));

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} className="font-medium">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {activeLabel}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </Button>

      {open && (
        <>
          <button type="button" aria-label="Fechar seletor de período" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div className="mitza-menu-in absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-float)]">
            <div className="flex flex-col">
              {ANALYTICS_PERIOD_PRESET_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  href={`${baseHref}&analyticsPreset=${option.value}`}
                  onClick={() => setOpen(false)}
                  className={`rounded-md px-2.5 py-1.5 text-sm ${
                    activePreset === option.value ? "bg-brand/10 font-medium text-brand" : "text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  }`}
                >
                  {option.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomFields((v) => !v)}
                className={`rounded-md px-2.5 py-1.5 text-left text-sm ${
                  activePreset === "custom" ? "bg-brand/10 font-medium text-brand" : "text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                Personalizado
              </button>
            </div>

            {showCustomFields && (
              <div className="mt-1 flex flex-col gap-2 border-t border-border p-2">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
                    aria-label="Data inicial"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground"
                    aria-label="Data final"
                  />
                </div>
                <Button variant="primary" size="sm" onClick={applyCustomRange} className="w-full justify-center">
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
