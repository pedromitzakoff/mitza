"use client";

import { DASHBOARD_METRIC_CATALOG, type DashboardMetricGroup, type DashboardMetricKey } from "@/lib/dashboard-metrics";
import { updateClientDashboardMetricsAction } from "./dashboard-metrics-actions";
import { SubmitButton } from "@/app/submit-button";
import { CLIENT_SETTINGS_SAVE_BUTTON_CLASSES } from "./client-settings-ui";

const GROUP_LABEL: Record<DashboardMetricGroup, string> = {
  resultado: "Resultados",
  eficiencia: "Eficiência",
  entrega: "Entrega",
};

const GROUP_ORDER: DashboardMetricGroup[] = ["resultado", "eficiencia", "entrega"];

/**
 * "Métricas exibidas" (Etapa "Catálogo de métricas do Dashboard") — seção
 * única, 3 grupos de checkboxes, pedido explícito do usuário. Independente
 * de `client_goals`/"Objetivos da conta": marcar um Resultado aqui nunca
 * cria nem exige uma linha de objetivo (ponto 2) — só decide o que aparece
 * no Dashboard/tabelas. O mapeamento de evento da Meta continua
 * exclusivamente na seção "Métricas de performance" (ponto 3) — nunca
 * misturado aqui.
 */
export function DashboardMetricsSection({
  clientId,
  returnTo,
  selected,
}: {
  clientId: string;
  returnTo: string;
  selected: DashboardMetricKey[];
}) {
  const selectedSet = new Set(selected);

  return (
    <form action={updateClientDashboardMetricsAction.bind(null, clientId, returnTo)} className="flex flex-col gap-4">
      {GROUP_ORDER.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-overview-text-muted">{GROUP_LABEL[group]}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Object.values(DASHBOARD_METRIC_CATALOG)
              .filter((metric) => metric.group === group)
              .map((metric) => (
                <label key={metric.key} className="flex items-center gap-1.5 text-sm text-overview-text-primary">
                  <input
                    type="checkbox"
                    name="metrics"
                    value={metric.key}
                    defaultChecked={selectedSet.has(metric.key)}
                    className="h-3.5 w-3.5 rounded border-overview-border accent-brand"
                  />
                  {metric.label}
                </label>
              ))}
          </div>
        </div>
      ))}

      <SubmitButton pendingChildren="Salvando..." className={`self-start ${CLIENT_SETTINGS_SAVE_BUTTON_CLASSES}`}>
        Salvar métricas exibidas
      </SubmitButton>
    </form>
  );
}
