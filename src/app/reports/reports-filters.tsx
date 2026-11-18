"use client";

import { useRouter } from "next/navigation";
import type { WeeklyReportListFilters } from "@/app/reports/reports-data";
import type { WeeklyReportStatus } from "@/lib/weekly-reports/report-types";
import { DEFAULT_REPORTS_TAB } from "@/app/reports/reports-constants";

/**
 * Aba "Reports" (pedido, seção 4: "seleção de edição por data, filtro por
 * cliente e gestor"). Mesmo padrão já corrigido em `AlertsFilters`
 * (`app/alerts/alerts-filters.tsx`): os 3 `<select>`/input preservam a aba
 * ativa na URL ao navegar, e os `<select>` já nascem com `max-w-*` +
 * `truncate` (achado real da Etapa "Alertas — melhoria visual": sem isso,
 * um `<select>` cresce até a largura da opção mais larga, não do valor
 * selecionado, estourando a tela no mobile com qualquer nome mais longo).
 */
export function ReportsFilters({
  filters,
  activeTab,
  selectedDate,
  clients,
  managers,
}: {
  filters: WeeklyReportListFilters;
  activeTab: WeeklyReportStatus;
  selectedDate: string;
  clients: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}) {
  const router = useRouter();

  function buildUrl(overrides: { clientId?: string; managerId?: string; date?: string }) {
    const next = { ...filters, date: selectedDate, ...overrides };
    const params = new URLSearchParams();
    if (activeTab !== DEFAULT_REPORTS_TAB) params.set("aba", activeTab);
    params.set("data", next.date);
    if (next.clientId) params.set("cliente", next.clientId);
    if (next.managerId) params.set("gestor", next.managerId);
    const query = params.toString();
    return query ? `/reports?${query}` : "/reports";
  }

  function navigate(overrides: { clientId?: string; managerId?: string; date?: string }) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const hasAnyFilter = Boolean(filters.clientId) || Boolean(filters.managerId);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      <input
        type="date"
        value={selectedDate}
        onChange={(event) => navigate({ date: event.target.value })}
        aria-label="Semana de referência"
        className="max-w-[46vw] rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:max-w-none"
      />

      <select
        value={filters.clientId}
        onChange={(event) => navigate({ clientId: event.target.value })}
        className="max-w-[40vw] truncate rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:max-w-[180px]"
      >
        <option value="">Cliente: todos</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>

      <select
        value={filters.managerId}
        onChange={(event) => navigate({ managerId: event.target.value })}
        className="max-w-[40vw] truncate rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:max-w-[180px]"
      >
        <option value="">Gestor: todos</option>
        {managers.map((manager) => (
          <option key={manager.id} value={manager.id}>
            {manager.name}
          </option>
        ))}
      </select>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => navigate({ clientId: "", managerId: "" })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
