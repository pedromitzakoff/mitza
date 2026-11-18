import Link from "next/link";
import { WEEKLY_REPORT_STATUS_COLUMN_ORDER, WEEKLY_REPORT_STATUS_LABEL } from "@/lib/weekly-reports/report-labels";
import type { WeeklyReportListFilters } from "@/app/reports/reports-data";
import type { WeeklyReportStatus } from "@/lib/weekly-reports/report-types";
import { DEFAULT_REPORTS_TAB } from "@/app/reports/reports-constants";

/**
 * Aba "Reports" (pedido, seção 4: "organize os cards em três estados" +
 * "adapte a navegação para celular sem exigir rolagem horizontal") — mesmo
 * padrão de `AlertsTabs` (`app/alerts/alerts-tabs.tsx`, já corrigido pra
 * nunca estourar a largura no mobile): Server Component puro, troca de
 * aba é só navegação (`?aba=...`), preserva data/cliente/gestor.
 */
export function ReportsTabs({
  activeTab,
  counts,
  filters,
  selectedDate,
}: {
  activeTab: WeeklyReportStatus;
  counts: Record<WeeklyReportStatus, number>;
  filters: WeeklyReportListFilters;
  selectedDate: string;
}) {
  function buildUrl(tab: WeeklyReportStatus): string {
    const params = new URLSearchParams();
    if (tab !== DEFAULT_REPORTS_TAB) params.set("aba", tab);
    params.set("data", selectedDate);
    if (filters.clientId) params.set("cliente", filters.clientId);
    if (filters.managerId) params.set("gestor", filters.managerId);
    const query = params.toString();
    return query ? `/reports?${query}` : "/reports";
  }

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-overview-border" role="tablist" aria-label="Situação do report">
      {WEEKLY_REPORT_STATUS_COLUMN_ORDER.map((tab) => {
        const active = tab === activeTab;
        return (
          <Link
            key={tab}
            href={buildUrl(tab)}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active ? "border-brand text-brand" : "border-transparent text-overview-text-secondary hover:text-overview-text-primary"
            }`}
          >
            {WEEKLY_REPORT_STATUS_LABEL[tab]} <span className={active ? "text-brand" : "text-overview-text-muted"}>({counts[tab]})</span>
          </Link>
        );
      })}
    </div>
  );
}
