"use client";

import { useState } from "react";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildClientPerformanceReportHref, isValidCustomRange } from "./report-period-href";

const PILL_BASE_CLASSES = "rounded-full px-3 py-1.5 text-sm font-medium transition-colors";
const PILL_ACTIVE_CLASSES = "bg-brand text-white";
const PILL_INACTIVE_CLASSES =
  "border border-overview-border text-overview-text-primary hover:bg-overview-surface-hover";

/**
 * Tela mínima "Período → Gerar relatório" (Etapa "Relatório Único") —
 * substitui o antigo Analytics intermediário: nenhum wizard, nenhuma
 * segunda camada de navegação, só a escolha do período e o link pro
 * Relatório de Performance já existente. Presets reaproveitam
 * `ANALYTICS_PERIOD_PRESET_OPTIONS`/`resolveAnalyticsPeriod`
 * (`lib/analytics.ts`) — nenhuma semântica de data nova. `target="_blank"`
 * pelo mesmo motivo de sempre (`/reports`, o antigo hub): é uma página HTML
 * pra visualizar/navegar, não um download — nunca substitui esta tela.
 */
export function ReportPeriodPicker({ clientId, today }: { clientId: string; today: string }) {
  const [preset, setPreset] = useState<AnalyticsPeriodPreset>("this_month");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);

  const isCustom = preset === "custom";
  const customIsValid = !isCustom || isValidCustomRange(customStart, customEnd);
  const href = customIsValid
    ? buildClientPerformanceReportHref(clientId, preset, isCustom ? { start: customStart, end: customEnd } : undefined)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Período do relatório">
        {ANALYTICS_PERIOD_PRESET_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preset === option.value}
            onClick={() => setPreset(option.value)}
            className={`${PILL_BASE_CLASSES} ${preset === option.value ? PILL_ACTIVE_CLASSES : PILL_INACTIVE_CLASSES}`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          onClick={() => setPreset("custom")}
          className={`${PILL_BASE_CLASSES} ${isCustom ? PILL_ACTIVE_CLASSES : PILL_INACTIVE_CLASSES}`}
        >
          Período personalizado
        </button>
      </div>

      {isCustom && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-sm text-overview-text-primary"
            aria-label="Data inicial"
          />
          <span className="text-sm text-overview-text-secondary">até</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-sm text-overview-text-primary"
            aria-label="Data final"
          />
        </div>
      )}
      {isCustom && !customIsValid && (
        <p className="text-xs text-overview-danger">A data final precisa ser igual ou posterior à data inicial.</p>
      )}

      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Gerar relatório
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="w-fit rounded-md bg-brand px-4 py-2 text-sm font-medium text-white opacity-50"
        >
          Gerar relatório
        </button>
      )}
    </div>
  );
}
