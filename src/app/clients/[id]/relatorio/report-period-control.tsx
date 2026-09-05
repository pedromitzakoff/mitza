"use client";

import { useRouter } from "next/navigation";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { PeriodRangeSelector, type PeriodRangePreset } from "@/components/ui/period-range-selector";
import { buildReportPeriodHref } from "./report-period-nav";

/**
 * Etapa "Padronização Global dos Seletores de Período" (Fase 2) —
 * substitui o antigo `<select>` + `<input type="date">` pelo componente
 * canônico `PeriodRangeSelector` (Fase 1), preservando 100% do contrato de
 * navegação já existente: toda troca de período ainda navega pra ESTA
 * MESMA rota via `buildReportPeriodHref` (`analyticsPreset`/
 * `analyticsStart`/`analyticsEnd` na URL), nunca um estado paralelo — só a
 * experiência de escolha mudou. `resolveAnalyticsPeriod` continua sendo a
 * ÚNICA fonte de verdade de semântica de data (chamada aqui só pra
 * pré-calcular os intervalos de cada preset e o valor atual, nunca
 * reimplementada).
 *
 * Usada IDENTICAMENTE por `/clients/[id]/relatorio` (interno) e `/r/[token]`
 * (público, Etapa "Link Externo V1") — a única diferença entre os dois é o
 * `basePath` que cada página já passava antes desta etapa; o componente em
 * si nunca sabe se está dentro ou fora do login.
 */
export function ReportPeriodControl({
  basePath,
  activePreset,
  customStart,
  customEnd,
  today,
}: {
  /** Rota atual do relatório já resolvida por quem chama — `/clients/<id>/relatorio`
   * na página interna, `/r/<token>` no link externo (Etapa "Link Externo V1"). */
  basePath: string;
  activePreset: AnalyticsPeriodPreset;
  /** Início/fim do período REALMENTE resolvido pro servidor nesta
   * renderização — vira o `value` do seletor (a URL continua sendo a fonte
   * de verdade; isto é só a leitura dela). */
  customStart: string;
  customEnd: string;
  /** `YYYY-MM-DD` do dia real — usado só pra resolver os presets e formatar
   * o rótulo compacto, nunca uma segunda semântica de "hoje". */
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
      router.push(buildReportPeriodHref(basePath, next.presetKey as AnalyticsPeriodPreset));
      return;
    }
    router.push(buildReportPeriodHref(basePath, "custom", { start: next.start, end: next.end }));
  }

  return <PeriodRangeSelector value={value} presets={presets} onApply={handleApply} today={today} />;
}
