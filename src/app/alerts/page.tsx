import { EmptyState } from "@/components/ui/empty-state";
import { requireActiveProfile } from "@/lib/auth";
import { loadAlertList, type AlertListFilters, type AlertTypeFilter, type SeverityFilter, type StatusFilter } from "@/app/alerts/alerts-data";
import { AlertsFilters } from "@/app/alerts/alerts-filters";
import { AlertCard } from "@/app/alerts/alert-card";
import { IMPLEMENTED_ALERT_TYPES, type AlertType } from "@/lib/alerts/alert-types";

/**
 * Aba "Alertas" (pedido do usuário) — identifica, numa lista única, quais
 * clientes precisam de atenção, priorizada por gravidade (crítico > atenção
 * > oportunidade, "sem competir com os problemas na visualização inicial").
 * Qualquer membro ativo pode ver/agir (`requireActiveProfile`, não admin).
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; gravidade?: string; tipo?: string; situacao?: string }>;
}) {
  await requireActiveProfile();
  const params = await searchParams;

  const severity: SeverityFilter = params.gravidade === "critico" || params.gravidade === "atencao" || params.gravidade === "oportunidade" ? params.gravidade : "problemas";
  const alertType: AlertTypeFilter = IMPLEMENTED_ALERT_TYPES.includes(params.tipo as AlertType) ? (params.tipo as AlertTypeFilter) : "todos";
  const status: StatusFilter =
    params.situacao === "precisa_atencao" || params.situacao === "acompanhamento" || params.situacao === "resolvido" ? params.situacao : "todos";

  const filters: AlertListFilters = { clientId: params.cliente ?? "", severity, alertType, status };
  const { items, clients, attentionCount } = await loadAlertList(filters);

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

      <AlertsFilters filters={filters} clients={clients} />

      {items.length === 0 ? (
        <EmptyState className="bg-card p-4">Nenhum alerta encontrado com os filtros atuais.</EmptyState>
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
