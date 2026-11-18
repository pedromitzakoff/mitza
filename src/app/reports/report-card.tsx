import Link from "next/link";
import { COCKPIT_CARD_CLASSES } from "@/lib/cockpit-pace";
import { formatRelativeDateTime } from "@/lib/format";
import { buildWorkspaceHref } from "@/lib/client-workspace-nav";
import { formatReportPeriodLabel } from "@/lib/weekly-reports/report-template";
import { WEEKLY_REPORT_PERIOD_KIND_LABEL } from "@/lib/weekly-reports/report-labels";
import { ReportReadyActions, ReportUndoSentButton } from "@/app/reports/report-action-buttons";
import type { WeeklyReportListItem } from "@/app/reports/reports-data";

/**
 * Aba "Reports" (pedido, seção 4: "mostre cliente, gestor e período em
 * cada card"). O corpo do card é o PRÓPRIO texto que vai pro WhatsApp
 * (pedido: "o gestor confere, copia o texto") — nunca uma versão
 * resumida/reformatada só pra exibição, pra conferir ser sempre conferir
 * exatamente o que vai ser copiado.
 */
export function ReportCard({ report }: { report: WeeklyReportListItem }) {
  const periodLabel = formatReportPeriodLabel(report.periodStart, report.periodEnd);
  const rankingHref = `/clients/${report.clientId}/anuncios?period=custom&start=${report.periodStart}&end=${report.periodEnd}`;

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border p-3.5 ${COCKPIT_CARD_CLASSES}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={buildWorkspaceHref(report.clientId, "", null)} className="truncate text-sm font-semibold text-overview-text-primary hover:underline">
            {report.clientName}
          </Link>
          <p className="text-xs text-overview-text-secondary">
            {report.managerName ?? "Sem gestor"} · {periodLabel}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-overview-surface-hover px-2 py-0.5 text-[11px] font-medium text-overview-text-muted">
          {WEEKLY_REPORT_PERIOD_KIND_LABEL[report.periodKind]}
        </span>
      </div>

      {report.status === "aguardando_dados" && (
        <p className="text-sm text-overview-text-secondary">
          Aguardando a sincronização completa dos dados do período — assim que terminar, este card passa pra &quot;Pronto para enviar&quot; automaticamente.
        </p>
      )}

      {report.status !== "aguardando_dados" && (
        <div className="whitespace-pre-wrap rounded-md bg-overview-surface-hover px-3 py-2.5 text-sm text-overview-text-primary">
          {report.status === "enviado" ? report.sentText : report.bodyText}
        </div>
      )}

      {report.status === "enviado" && (
        <p className="text-xs text-overview-text-secondary">
          Enviado por {report.sentByName ?? "—"}
          {report.sentAt && ` · ${formatRelativeDateTime(report.sentAt, new Date())}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-overview-border pt-2 text-[11px] text-overview-text-muted">
        <Link href={buildWorkspaceHref(report.clientId, "", null)} className="text-brand hover:underline">
          Ver cliente
        </Link>
        {report.status !== "aguardando_dados" && (
          <Link href={rankingHref} className="text-brand hover:underline">
            Ver ranking de anúncios
          </Link>
        )}
      </div>

      {report.status === "pronto_para_enviar" && <ReportReadyActions reportId={report.id} bodyText={report.bodyText} nextStep={report.nextStep} />}
      {report.status === "enviado" && <ReportUndoSentButton reportId={report.id} />}
    </div>
  );
}
