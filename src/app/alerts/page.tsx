import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveProfile } from "@/lib/auth";
import { loadAlertList, type AlertListFilters, type AlertTypeFilter, type SeverityFilter } from "@/app/alerts/alerts-data";
import { AlertsFilters } from "@/app/alerts/alerts-filters";
import { AlertsTabs } from "@/app/alerts/alerts-tabs";
import { AlertCard } from "@/app/alerts/alert-card";
import { IMPLEMENTED_ALERT_TYPES, type AlertStatus, type AlertType } from "@/lib/alerts/alert-types";

/** Pedido da melhoria visual: "defina um estado vazio curto para cada
 * aba" — nunca a mesma frase genérica nas 3. */
const EMPTY_STATE_BY_TAB: Record<AlertStatus, string> = {
  precisa_atencao: "Nenhum alerta precisa de atenção agora.",
  acompanhamento: "Nenhum alerta em acompanhamento.",
  resolvido: "Nenhum alerta resolvido ainda.",
};

/**
 * Aba "Alertas" (pedido do usuário) — identifica, numa lista única, quais
 * clientes precisam de atenção, priorizada por gravidade (crítico > atenção
 * > oportunidade, "sem competir com os problemas na visualização inicial").
 * Qualquer membro ativo pode ver/agir (`requireActiveProfile`, não admin).
 *
 * Melhoria visual (pedido do usuário): "situação" virou abas
 * (`AlertsTabs`), não mais um `<select>` — `?aba=` decide qual das 3
 * (padrão: "precisa_atencao", a única que nunca aparece na URL).
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; gravidade?: string; tipo?: string; aba?: string }>;
}) {
  await requireActiveProfile();
  const params = await searchParams;

  const severity: SeverityFilter = params.gravidade === "critico" || params.gravidade === "atencao" || params.gravidade === "oportunidade" ? params.gravidade : "problemas";
  const alertType: AlertTypeFilter = IMPLEMENTED_ALERT_TYPES.includes(params.tipo as AlertType) ? (params.tipo as AlertTypeFilter) : "todos";
  const activeTab: AlertStatus = params.aba === "acompanhamento" || params.aba === "resolvido" ? params.aba : "precisa_atencao";

  const filters: AlertListFilters = { clientId: params.cliente ?? "", severity, alertType };
  const { items, counts, clients, attentionCount } = await loadAlertList(filters, activeTab);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-overview-text-primary">Alertas</h1>
          <p className="text-sm text-overview-text-secondary">
            {attentionCount > 0 ? `${attentionCount} alerta(s) precisam de atenção agora.` : "Nenhum alerta precisa de atenção agora."}
          </p>
        </div>
      </div>

      <AlertsFilters filters={filters} activeTab={activeTab} clients={clients} />
      <AlertsTabs activeTab={activeTab} counts={counts} filters={filters} />

      {items.length === 0 ? (
        <EmptyState className="bg-card p-4">{EMPTY_STATE_BY_TAB[activeTab]}</EmptyState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
