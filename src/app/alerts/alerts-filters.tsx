"use client";

import { useRouter } from "next/navigation";
import { ALERT_SEVERITY_LABEL, ALERT_TYPE_LABEL } from "@/lib/alerts/alert-labels";
import { IMPLEMENTED_ALERT_TYPES } from "@/lib/alerts/alert-types";
import type { AlertListFilters } from "@/app/alerts/alerts-data";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Aba "Alertas" (melhoria visual, pedido do usuário: "mantenha os
 * filtros de cliente, gravidade e tipo. Use a aba para filtrar por
 * situação") — "Situação" SAIU daqui, virou `AlertsTabs`; estes 3
 * filtros preservam a aba ativa na URL (`?aba=...`) ao navegar, nunca
 * voltam pra "Precisa de atenção" só porque o gestor trocou o cliente.
 * Mesmo padrão de `ClientsFilters` (`<select>` navega direto no
 * `onChange`, sem botão "Filtrar") — `<select>`s aqui nunca precisam de
 * debounce (não há campo de texto livre nesta tela).
 */
export function AlertsFilters({
  filters,
  activeTab,
  clients,
}: {
  filters: AlertListFilters;
  activeTab: AlertStatus;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();

  function buildUrl(overrides: Partial<AlertListFilters>) {
    const next: AlertListFilters = { ...filters, ...overrides };
    const params = new URLSearchParams();
    if (activeTab !== "precisa_atencao") params.set("aba", activeTab);
    if (next.clientId) params.set("cliente", next.clientId);
    if (next.severity !== "problemas") params.set("gravidade", next.severity);
    if (next.alertType !== "todos") params.set("tipo", next.alertType);
    const query = params.toString();
    return query ? `/alerts?${query}` : "/alerts";
  }

  function navigate(overrides: Partial<AlertListFilters>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const hasAnyFilter = Boolean(filters.clientId) || filters.severity !== "problemas" || filters.alertType !== "todos";

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      {/* `max-w-*` + `truncate` (bug achado na QA visual): sem isso, um
          <select> cresce até a largura da sua OPÇÃO MAIS LARGA, não do
          valor selecionado — qualquer cliente com nome mais longo estourava
          a tela no celular (rolagem horizontal na página, que o pedido
          original proibiu explicitamente). */}
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
        value={filters.severity}
        onChange={(event) => navigate({ severity: event.target.value as AlertListFilters["severity"] })}
        className="max-w-[40vw] truncate rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:max-w-[260px]"
      >
        <option value="problemas">Gravidade: problemas (crítico + atenção)</option>
        <option value="critico">{ALERT_SEVERITY_LABEL.critico}</option>
        <option value="atencao">{ALERT_SEVERITY_LABEL.atencao}</option>
        <option value="oportunidade">{ALERT_SEVERITY_LABEL.oportunidade}</option>
      </select>

      <select
        value={filters.alertType}
        onChange={(event) => navigate({ alertType: event.target.value as AlertListFilters["alertType"] })}
        className="max-w-[40vw] truncate rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:max-w-[220px]"
      >
        <option value="todos">Tipo: todos</option>
        {IMPLEMENTED_ALERT_TYPES.map((type) => (
          <option key={type} value={type}>
            {ALERT_TYPE_LABEL[type]}
          </option>
        ))}
      </select>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => navigate({ clientId: "", severity: "problemas", alertType: "todos" })}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
