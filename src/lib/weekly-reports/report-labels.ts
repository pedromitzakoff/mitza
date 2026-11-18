import { WEEKLY_REPORT_STATUS_REGISTRY } from "@/lib/status-registry";
import type { WeeklyReportPeriodKind, WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

/** Adapter fino derivado do Status Registry (`@/lib/status-registry`) —
 * mesmo padrão de `ALERT_STATUS_LABEL`/`ALERT_STATUS_BADGE_CLASSES`: nunca
 * uma cor/rótulo redeclarado fora do registry. */
export const WEEKLY_REPORT_STATUS_LABEL: Record<WeeklyReportStatus, string> = {
  aguardando_dados: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.aguardando_dados"].label,
  pronto_para_enviar: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.pronto_para_enviar"].label,
  enviado: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.enviado"].label,
};

export const WEEKLY_REPORT_STATUS_BADGE_CLASSES: Record<WeeklyReportStatus, string> = {
  aguardando_dados: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.aguardando_dados"].badgeClassName,
  pronto_para_enviar: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.pronto_para_enviar"].badgeClassName,
  enviado: WEEKLY_REPORT_STATUS_REGISTRY["weekly_report.enviado"].badgeClassName,
};

/** Ordem canônica das 3 abas da tela (pedido: "organize os cards em três
 * estados") — única fonte, nunca uma 2ª lista hardcoded em `reports-tabs.tsx`. */
export const WEEKLY_REPORT_STATUS_COLUMN_ORDER: WeeklyReportStatus[] = ["aguardando_dados", "pronto_para_enviar", "enviado"];

/** "Relatório de segunda" / "Relatório de sexta" — rótulo curto do lote
 * (pedido, seção 1), mostrado como contexto secundário no card (a data do
 * período em si é a informação principal). */
export const WEEKLY_REPORT_PERIOD_KIND_LABEL: Record<WeeklyReportPeriodKind, string> = {
  segunda: "Relatório de segunda",
  sexta: "Relatório de sexta",
};
