"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildReportPeriodHref, isValidCustomRange } from "./report-period-nav";

/**
 * Controle compacto de período no topo do Relatório de Performance nativo —
 * "Cliente → Relatório → relatório", nunca uma tela própria de seleção
 * (aposentada nesta etapa). Toda troca de preset navega pra ESTA MESMA rota
 * com outra querystring (`buildReportPeriodHref`) — nunca um estado de
 * cliente paralelo à URL, pra refresh/back/forward sempre reproduzirem
 * exatamente o período visto. Presets vêm de
 * `ANALYTICS_PERIOD_PRESET_OPTIONS`/`resolveAnalyticsPeriod`
 * (`lib/analytics.ts`) — nenhuma semântica de data nova.
 */
export function ReportPeriodControl({
  clientId,
  activePreset,
  periodLabel,
  customStart,
  customEnd,
}: {
  clientId: string;
  activePreset: AnalyticsPeriodPreset;
  /** Já formatado (`PerformanceReportDocument.periodLabel`) — mostrado ao
   * lado do seletor pra qualquer preset, inclusive fora de "custom". */
  periodLabel: string;
  /** Início/fim do período REALMENTE resolvido pro servidor nesta
   * renderização — usado só como valor inicial dos campos de data ao trocar
   * pra "Período personalizado" (nunca refeito no cliente). */
  customStart: string;
  customEnd: string;
}) {
  const router = useRouter();
  const isCustom = activePreset === "custom";
  const [start, setStart] = useState(customStart);
  const [end, setEnd] = useState(customEnd);
  const customIsValid = isValidCustomRange(start, end);

  function handlePresetChange(value: string) {
    if (value === "custom") {
      router.push(buildReportPeriodHref(clientId, "custom", { start, end }));
      return;
    }
    router.push(buildReportPeriodHref(clientId, value as AnalyticsPeriodPreset));
  }

  function applyCustomRange() {
    if (!customIsValid) return;
    router.push(buildReportPeriodHref(clientId, "custom", { start, end }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="report-period-preset">
        Período do relatório
      </label>
      <select
        id="report-period-preset"
        value={activePreset}
        onChange={(e) => handlePresetChange(e.target.value)}
        className="rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-sm font-medium text-overview-text-primary"
      >
        {ANALYTICS_PERIOD_PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value="custom">Período personalizado</option>
      </select>

      {isCustom ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-sm text-overview-text-primary"
            aria-label="Data inicial"
          />
          <span className="text-sm text-overview-text-secondary">até</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-sm text-overview-text-primary"
            aria-label="Data final"
          />
          <button
            type="button"
            onClick={applyCustomRange}
            disabled={!customIsValid}
            className="rounded-md border border-overview-border px-2.5 py-1.5 text-sm font-medium text-overview-text-primary hover:bg-overview-surface-hover disabled:pointer-events-none disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      ) : (
        <span className="text-sm text-overview-text-secondary">{periodLabel}</span>
      )}
    </div>
  );
}
