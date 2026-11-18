import type { WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

/** Pedido: "contador de progresso, como 16 de 20 enviados" — conta as 3
 * situações sempre, mesmo em 0 (nunca omitida do objeto), igual
 * `countAlertsByStatus` (`lib/alerts/alert-list-view.ts`). */
export function countWeeklyReportsByStatus(items: { status: WeeklyReportStatus }[]): Record<WeeklyReportStatus, number> {
  const counts: Record<WeeklyReportStatus, number> = { aguardando_dados: 0, pronto_para_enviar: 0, enviado: 0 };
  for (const item of items) counts[item.status]++;
  return counts;
}
