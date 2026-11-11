import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import {
  DASHBOARD_METRIC_CATALOG,
  METRIC_ERROR_REASON_LABEL,
  METRIC_UNAVAILABLE_REASON_LABEL,
  type DashboardMetricGroup,
  type DashboardMetricKey,
  type MetricView,
} from "@/lib/dashboard-metrics";

/**
 * Fase B ("integração das métricas selecionadas com o Dashboard") — cards
 * de "Métricas exibidas", um por chave marcada em `/clients/[id]/edit`
 * (Fase A). Componente puramente de apresentação: todo `MetricView` já
 * chega resolvido (`dashboard-metrics-resolver.ts`) — nunca recalcula nada,
 * só formata e escolhe o tom certo pros 3 estados (ponto 4 do pedido):
 * disponível (valor real, zero incluso) em texto normal; indisponível por
 * configuração em cinza neutro, sem alarme (nada quebrou); erro de
 * integração com um ponto âmbar, mesma linguagem visual de
 * `cockpit-diagnostics-card.tsx` pra "precisa de atenção".
 *
 * Renderizado ADICIONALMENTE à Visão executiva já existente (Meta & Ritmo/
 * `resultCards`, Planejamento/`is_primary` — nada disso muda, ponto 6/7 do
 * pedido) — só aparece quando o cliente já configurou "Métricas exibidas"
 * de propósito (`client.dashboard_metrics` não vazio, ponto 2/8: cliente
 * que nunca configurou mantém a tela exatamente como sempre foi).
 */

function formatMetricValue(key: DashboardMetricKey, value: number): string {
  switch (DASHBOARD_METRIC_CATALOG[key].group) {
    case "resultado":
      return formatCount(value);
    case "eficiencia":
      return key === "roas" ? `${value.toFixed(2)}x` : formatCurrency(value);
    case "entrega":
      if (key === "ctr") return formatPercent(value * 100);
      if (key === "cpc" || key === "cpm" || key === "spend") return formatCurrency(value);
      return formatCount(value);
  }
}

const GROUP_LABEL: Record<DashboardMetricGroup, string> = {
  resultado: "Resultados",
  eficiencia: "Eficiência",
  entrega: "Entrega",
};

const GROUP_ORDER: DashboardMetricGroup[] = ["resultado", "eficiencia", "entrega"];

function MetricCard({ metricKey, view }: { metricKey: DashboardMetricKey; view: MetricView }) {
  const label = DASHBOARD_METRIC_CATALOG[metricKey].label;

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{label}</p>
      {view.status === "available" ? (
        <p className="mt-0.5 text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">
          {formatMetricValue(metricKey, view.value)}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-xl font-semibold tracking-tight text-overview-text-muted tabular-nums">—</p>
          <p className={`mt-1 flex items-center gap-1.5 text-xs ${view.status === "error" ? "text-amber-700 dark:text-amber-400" : "text-overview-text-secondary"}`}>
            {view.status === "error" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />}
            {view.status === "error" ? METRIC_ERROR_REASON_LABEL[view.reason] : METRIC_UNAVAILABLE_REASON_LABEL[view.reason]}
          </p>
        </>
      )}
    </div>
  );
}

export function DashboardMetricsCards({ views }: { views: Map<DashboardMetricKey, MetricView> }) {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    keys: Array.from(views.keys()).filter((key) => DASHBOARD_METRIC_CATALOG[key].group === group),
  })).filter((g) => g.keys.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ group, keys }) => (
        <div key={group}>
          <p className="text-xs font-semibold uppercase tracking-wide text-overview-text-muted">{GROUP_LABEL[group]}</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {keys.map((key) => (
              <MetricCard key={key} metricKey={key} view={views.get(key) as MetricView} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
