import type { AnalyticsPeriodPreset } from "@/lib/analytics";

/**
 * Núcleo puro da tela mínima de período (Etapa "Relatório Único") — só
 * resolve o HREF do Relatório de Performance JÁ EXISTENTE
 * (`/api/clients/[id]/performance-report`), nunca uma segunda implementação
 * de relatório. Mesmo princípio de `app/reports/report-panel.ts`
 * (`buildPerformanceReportHref`): sem `analyticsPreset` explícito,
 * `resolveAnalyticsPeriod` (`lib/analytics.ts`) ignora `analyticsStart`/
 * `analyticsEnd` e cai no mês corrente — por isso o preset viaja sempre, e
 * `analyticsStart`/`analyticsEnd` só quando o preset é "custom" (os demais
 * presets já carregam a semântica de data inteira dentro de si mesmos, sem
 * precisar de datas explícitas na URL).
 */
export function buildClientPerformanceReportHref(
  clientId: string,
  preset: AnalyticsPeriodPreset,
  custom?: { start: string; end: string },
): string {
  const params = new URLSearchParams({ analyticsPreset: preset });
  if (preset === "custom" && custom) {
    params.set("analyticsStart", custom.start);
    params.set("analyticsEnd", custom.end);
  }
  return `/api/clients/${clientId}/performance-report?${params.toString()}`;
}

/** Mesma regra de validade que `resolveAnalyticsPeriod` já aplica pro
 * preset "custom" (`custom.end >= custom.start`) — replicada aqui só pra
 * decidir se o botão "Gerar relatório" fica habilitado, nunca uma segunda
 * fonte de verdade sobre o que é um período válido (o servidor sempre
 * recalcula/valida de novo ao gerar o relatório). */
export function isValidCustomRange(start: string, end: string): boolean {
  return Boolean(start) && Boolean(end) && end >= start;
}
