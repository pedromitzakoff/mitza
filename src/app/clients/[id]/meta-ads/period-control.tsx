"use client";

import { useRouter } from "next/navigation";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { PeriodRangeSelector, type PeriodRangePreset } from "@/components/ui/period-range-selector";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.2. Seletor de período do
 * Dashboard Meta Ads — PRÓPRIO desta rota (nunca `ReportPeriodControl`,
 * `clients/[id]/relatorio/report-period-control.tsx`): aquele componente é
 * acoplado a `ReportView`/`report-data.ts` (a dimensão de Funis, exclusiva
 * do Relatório), que este dashboard não tem. Reaproveita, sim, os mesmos
 * blocos genéricos: `PeriodRangeSelector` (componente canônico de período,
 * identidade KOFF) e `ANALYTICS_PERIOD_PRESET_OPTIONS`/`resolveAnalyticsPeriod`
 * (`lib/analytics.ts`, única fonte de verdade de semântica de data) —
 * nenhuma segunda implementação desses dois.
 *
 * Mesma regra de "página única" (seção 6 do pedido): trocar de período
 * nunca é um link pra fora — sempre a MESMA rota (`/clients/[id]/meta-ads`)
 * com outra querystring (`preset`/`start`/`end`, vocabulário PRÓPRIO desta
 * rota — nunca `analyticsPreset`/`analyticsStart`/`analyticsEnd` do
 * Relatório, pra não sugerir nenhum acoplamento entre as duas rotas).
 */
function buildMetaAdsPeriodHref(clientId: string, preset: AnalyticsPeriodPreset, custom?: { start: string; end: string }): string {
  const params = new URLSearchParams({ preset });
  if (preset === "custom" && custom) {
    params.set("start", custom.start);
    params.set("end", custom.end);
  }
  return `/clients/${clientId}/meta-ads?${params.toString()}`;
}

export function MetaAdsPeriodControl({
  clientId,
  activePreset,
  customStart,
  customEnd,
  today,
}: {
  clientId: string;
  activePreset: AnalyticsPeriodPreset;
  /** Início/fim do período REALMENTE resolvido pro servidor nesta
   * renderização — vira o `value` do seletor (a URL continua sendo a fonte
   * de verdade; isto é só a leitura dela, mesma convenção de
   * `ReportPeriodControl`). */
  customStart: string;
  customEnd: string;
  today: string;
}) {
  const router = useRouter();

  const presets: PeriodRangePreset[] = ANALYTICS_PERIOD_PRESET_OPTIONS.map((option) => ({
    key: option.value,
    label: option.label,
    range: resolveAnalyticsPeriod(option.value, today),
  }));

  const value = activePreset === "custom" ? { start: customStart, end: customEnd } : resolveAnalyticsPeriod(activePreset, today);

  function handleApply(next: { start: string; end: string; presetKey: string | null }) {
    if (next.presetKey) {
      router.push(buildMetaAdsPeriodHref(clientId, next.presetKey as AnalyticsPeriodPreset));
      return;
    }
    router.push(buildMetaAdsPeriodHref(clientId, "custom", { start: next.start, end: next.end }));
  }

  return <PeriodRangeSelector value={value} presets={presets} onApply={handleApply} today={today} />;
}
