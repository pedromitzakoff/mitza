"use client";

import { useRouter } from "next/navigation";
import { ALERT_SEVERITY_LABEL, ALERT_STATUS_LABEL, ALERT_TYPE_LABEL } from "@/lib/alerts/alert-labels";
import { IMPLEMENTED_ALERT_TYPES } from "@/lib/alerts/alert-types";
import type { AlertListFilters } from "@/app/alerts/alerts-data";

/**
 * Aba "Alertas" (pedido, seção 1: "Filtros por: Cliente / Gravidade / Tipo
 * / Situação"). Mesmo padrão de `ClientsFilters` (`<select>` navega direto
 * no `onChange`, sem botão "Filtrar") — `<select>`s aqui nunca precisam de
 * debounce (não há campo de texto livre nesta tela).
 */
export function AlertsFilters({ filters, clients }: { filters: AlertListFilters; clients: { id: string; name: string }[] }) {
  const router = useRouter();

  function buildUrl(overrides: Partial<AlertListFilters>) {
    const next: AlertListFilters = { ...filters, ...overrides };
    const params = new URLSearchParams();
    if (next.clientId) params.set("cliente", next.clientId);
    if (next.severity !== "problemas") params.set("gravidade", next.severity);
    if (next.alertType !== "todos") params.set("tipo", next.alertType);
    if (next.status !== "todos") params.set("situacao", next.status);
    const query = params.toString();
    return query ? `/alerts?${query}` : "/alerts";
  }

  function navigate(overrides: Partial<AlertListFilters>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const hasAnyFilter = Boolean(filters.clientId) || filters.severity !== "problemas" || filters.alertType !== "todos" || filters.status !== "todos";

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      <select
        value={filters.clientId}
        onChange={(event) => navigate({ clientId: event.target.value })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="">Cliente: todos</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>

      <select
        value={filters.severity}
        onChange={(event) => navigate({ severity: event.target.value as AlertListFilters["severity"] })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="problemas">Gravidade: problemas (crítico + atenção)</option>
        <option value="critico">{ALERT_SEVERITY_LABEL.critico}</option>
        <option value="atencao">{ALERT_SEVERITY_LABEL.atencao}</option>
        <option value="oportunidade">{ALERT_SEVERITY_LABEL.oportunidade}</option>
      </select>

      <select
        value={filters.alertType}
        onChange={(event) => navigate({ alertType: event.target.value as AlertListFilters["alertType"] })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="todos">Tipo: todos</option>
        {IMPLEMENTED_ALERT_TYPES.map((type) => (
          <option key={type} value={type}>
            {ALERT_TYPE_LABEL[type]}
          </option>
        ))}
      </select>

      <select
        value={filters.status}
        onChange={(event) => navigate({ status: event.target.value as AlertListFilters["status"] })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="todos">Situação: todas</option>
        <option value="precisa_atencao">{ALERT_STATUS_LABEL.precisa_atencao}</option>
        <option value="acompanhamento">{ALERT_STATUS_LABEL.acompanhamento}</option>
        <option value="resolvido">{ALERT_STATUS_LABEL.resolvido}</option>
      </select>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => router.push("/alerts", { scroll: false })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
