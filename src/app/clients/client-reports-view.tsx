import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateRange, formatShortDateFromInstant } from "@/lib/format";
import { CLIENT_REPORT_STATUS_LABEL } from "@/lib/client-reports";
import type { ClientReportSummary } from "./client-report-data";

const STATUS_BADGE_CLASSES: Record<ClientReportSummary["status"], string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

/**
 * Módulo Reports dentro da gestão do cliente (histórico oficial da
 * comunicação de resultados enviada ao cliente) — NUNCA uma aba própria da
 * navegação: cabeçalho + "Gerar novo report" + lista do histórico, cada
 * item reabrindo o mesmo wizard (`ClientReportWizard`) em modo de edição.
 * Organizado pelo período analisado de cada report — nenhuma referência a
 * sprint em lugar nenhum. Nenhum texto é gerado aqui: este componente só lê
 * o que já foi salvo em `client_reports`.
 */
export function ClientReportsView({
  history,
  newReportHref,
  buildReportHref,
}: {
  history: ClientReportSummary[];
  newReportHref: string;
  buildReportHref: (reportId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Reports</h2>
          <p className="text-xs text-muted-foreground">Gerencie todos os reports enviados para este cliente.</p>
        </div>
        <Link
          href={newReportHref}
          scroll={false}
          className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
        >
          + Gerar novo report
        </Link>
      </div>

      {history.length === 0 ? (
        <EmptyState>Nenhum report gerado ainda para este cliente.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((report) => (
            <li key={report.id}>
              <Link
                href={buildReportHref(report.id)}
                scroll={false}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{formatDateRange(report.periodStart, report.periodEnd)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASSES[report.status]}`}>
                    {CLIENT_REPORT_STATUS_LABEL[report.status]}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  Criado em {formatShortDateFromInstant(report.createdAt)}
                  {report.createdByName ? ` · por ${report.createdByName}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
