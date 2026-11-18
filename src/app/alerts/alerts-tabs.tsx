import Link from "next/link";
import { ALERT_STATUS_COLUMN_ORDER, ALERT_STATUS_LABEL } from "@/lib/alerts/alert-labels";
import type { AlertListFilters } from "@/app/alerts/alerts-data";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Melhoria visual da aba "Alertas" (pedido do usuário): "troque as três
 * colunas [Kanban] por abas com contagem... abra em Precisa de atenção
 * por padrão". Server Component puro — troca de aba é só uma navegação
 * (`?aba=...`), preserva cliente/gravidade/tipo já selecionados, nunca
 * precisa de JS pra funcionar. "Resolvidos" no plural (pedido), as outras
 * 2 mantêm o rótulo singular do Status Registry.
 */
export function AlertsTabs({
  activeTab,
  counts,
  filters,
}: {
  activeTab: AlertStatus;
  counts: Record<AlertStatus, number>;
  filters: AlertListFilters;
}) {
  function buildUrl(tab: AlertStatus): string {
    const params = new URLSearchParams();
    if (tab !== "precisa_atencao") params.set("aba", tab);
    if (filters.clientId) params.set("cliente", filters.clientId);
    if (filters.severity !== "problemas") params.set("gravidade", filters.severity);
    if (filters.alertType !== "todos") params.set("tipo", filters.alertType);
    const query = params.toString();
    return query ? `/alerts?${query}` : "/alerts";
  }

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-overview-border" role="tablist" aria-label="Situação do alerta">
      {ALERT_STATUS_COLUMN_ORDER.map((tab) => {
        const active = tab === activeTab;
        const label = tab === "resolvido" ? "Resolvidos" : ALERT_STATUS_LABEL[tab];
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
            {label} <span className={active ? "text-brand" : "text-overview-text-muted"}>({counts[tab]})</span>
          </Link>
        );
      })}
    </div>
  );
}
