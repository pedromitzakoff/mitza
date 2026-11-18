import type { WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

/** Aba padrão ao abrir "Reports" — "Pronto para enviar" é a fila de ação
 * do gestor (mesmo raciocínio de `AlertsPage` abrir em "Precisa de
 * atenção": a aba acionável, nunca a de histórico). Única fonte — nunca
 * um literal repetido entre `page.tsx`/`reports-tabs.tsx`/`reports-filters.tsx`. */
export const DEFAULT_REPORTS_TAB: WeeklyReportStatus = "pronto_para_enviar";
