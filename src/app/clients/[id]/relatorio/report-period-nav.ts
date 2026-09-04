import type { AnalyticsPeriodPreset } from "@/lib/analytics";

/**
 * Etapa "Relatório Nativo": núcleo puro de HREF da página nativa do
 * Relatório de Performance — nunca uma segunda semântica de data. O período
 * sempre viaja como `analyticsPreset` (+`analyticsStart`/`analyticsEnd` só
 * quando "custom"), a MESMA convenção já usada em `/reports`
 * (`report-panel.ts`) e lida por `resolveAnalyticsPeriod`
 * (`lib/analytics.ts`) — garante que refresh/back/forward sempre reproduzem
 * exatamente o mesmo período (a URL É o estado, nunca um estado de cliente
 * paralelo).
 */
function buildPeriodParams(preset: AnalyticsPeriodPreset, custom?: { start: string; end: string }): URLSearchParams {
  const params = new URLSearchParams({ analyticsPreset: preset });
  if (preset === "custom" && custom) {
    params.set("analyticsStart", custom.start);
    params.set("analyticsEnd", custom.end);
  }
  return params;
}

/** Navegação dentro da própria página nativa (`/clients/[id]/relatorio`) —
 * trocar de período nunca é um link pra fora, sempre a MESMA rota com outra
 * querystring. */
export function buildReportPeriodHref(clientId: string, preset: AnalyticsPeriodPreset, custom?: { start: string; end: string }): string {
  return `/clients/${clientId}/relatorio?${buildPeriodParams(preset, custom).toString()}`;
}

/** "Baixar PDF" — mesmo período em exibição, mesma rota de geração de PDF
 * já existente (`/api/clients/[id]/performance-report`, agora exclusiva de
 * PDF — ver Etapa "Relatório Nativo"). */
export function buildReportPdfHref(clientId: string, preset: AnalyticsPeriodPreset, custom?: { start: string; end: string }): string {
  return `/api/clients/${clientId}/performance-report?${buildPeriodParams(preset, custom).toString()}`;
}

/** Mesma regra de validade que `resolveAnalyticsPeriod` já aplica pro
 * preset "custom" (`custom.end >= custom.start`) — replicada aqui só pra
 * decidir se o controle de período personalizado navega, nunca uma segunda
 * fonte de verdade sobre o que é um período válido (o servidor sempre
 * recalcula/valida de novo ao montar o relatório). */
export function isValidCustomRange(start: string, end: string): boolean {
  return Boolean(start) && Boolean(end) && end >= start;
}
