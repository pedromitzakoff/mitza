import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveProfile } from "@/lib/auth";
import { todayDateString } from "@/lib/today";
import { loadWeeklyReportList, type WeeklyReportListFilters } from "@/app/reports/reports-data";
import { ReportsFilters } from "@/app/reports/reports-filters";
import { ReportsTabs } from "@/app/reports/reports-tabs";
import { ReportCard } from "@/app/reports/report-card";
import { WEEKLY_REPORT_STATUS_COLUMN_ORDER } from "@/lib/weekly-reports/report-labels";
import { DEFAULT_REPORTS_TAB } from "@/app/reports/reports-constants";
import type { WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

/** Pedido, seção 4: "estado vazio curto para cada aba" (mesmo espírito já
 * usado em `AlertsPage`) — nunca a mesma frase genérica nas 3. */
const EMPTY_STATE_BY_TAB: Record<WeeklyReportStatus, string> = {
  aguardando_dados: "Nenhum report aguardando dados nesta semana.",
  pronto_para_enviar: "Nenhum report pronto para enviar nesta semana.",
  enviado: "Nenhum report enviado ainda nesta semana.",
};

/**
 * Aba "Reports" (pedido do usuário) — dois reports por semana prontos pra
 * cada cliente ativo com integração automática, pro gestor conferir,
 * copiar e marcar como enviado no WhatsApp.
 *
 * Qualquer membro ativo pode ver/agir (`requireActiveProfile`, mesmo
 * critério de "Alertas"/"Reportar cliente" — trabalho de dia a dia, não
 * administrativo). "Situação" vira abas (pedido: "organize os cards em
 * três estados"), `?aba=` decide qual das 3 (padrão: "pronto_para_enviar",
 * a fila de ação — nunca aparece na URL).
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; data?: string; cliente?: string; gestor?: string }>;
}) {
  await requireActiveProfile();
  const params = await searchParams;

  const activeTab: WeeklyReportStatus = WEEKLY_REPORT_STATUS_COLUMN_ORDER.includes(params.aba as WeeklyReportStatus)
    ? (params.aba as WeeklyReportStatus)
    : DEFAULT_REPORTS_TAB;
  const selectedDate = params.data && /^\d{4}-\d{2}-\d{2}$/.test(params.data) ? params.data : todayDateString();
  const filters: WeeklyReportListFilters = { clientId: params.cliente ?? "", managerId: params.gestor ?? "" };

  const { items, counts, clients, managers } = await loadWeeklyReportList(selectedDate, filters, activeTab);

  const total = counts.aguardando_dados + counts.pronto_para_enviar + counts.enviado;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-overview-text-primary">Reports</h1>
          <p className="text-sm text-overview-text-secondary">{total > 0 ? `${counts.enviado} de ${total} enviados` : "Nenhum report nesta semana."}</p>
        </div>
      </div>

      <ReportsFilters filters={filters} activeTab={activeTab} selectedDate={selectedDate} clients={clients} managers={managers} />
      <ReportsTabs activeTab={activeTab} counts={counts} filters={filters} selectedDate={selectedDate} />

      {items.length === 0 ? (
        <EmptyState className="bg-card p-4">{EMPTY_STATE_BY_TAB[activeTab]}</EmptyState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}
    </div>
  );
}
