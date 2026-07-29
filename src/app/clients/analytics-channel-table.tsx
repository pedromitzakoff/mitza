import { TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { AnalyticsChannelRow } from "@/lib/analytics";
import { formatCurrency } from "@/lib/format";

/**
 * Detalhamento por canal (substitui "por campanha" — ver `lib/analytics.ts`
 * pro porquê: a MITZA não guarda identidade de campanha em nenhuma tabela
 * hoje). Só renderiza com mais de 1 canal — com um único canal, os cards do
 * topo já contam toda a história (mesma regra de `ResultsByChannel`).
 */
export function AnalyticsChannelTable({ goal, rows }: { goal: PerformanceGoal; rows: AnalyticsChannelRow[] }) {
  if (rows.length < 2) return null;

  const config = PERFORMANCE_GOALS[goal];
  const hasRevenue = rows.some((r) => r.revenue !== null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-2">Canal</th>
            <th className="py-1.5 pr-2">Investimento</th>
            <th className="py-1.5 pr-2">{config.resultMetricLabel}</th>
            <th className="py-1.5 pr-2">{config.costMetricShortLabel}</th>
            {hasRevenue && <th className="py-1.5 pr-2">Faturamento</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-2 font-medium text-foreground">{TRAFFIC_CHANNELS[row.channel].label}</td>
              <td className="py-1.5 pr-2 text-foreground">{formatCurrency(row.spend)}</td>
              <td className="py-1.5 pr-2 text-foreground">{row.resultCount}</td>
              <td className="py-1.5 pr-2 text-foreground">{row.costPerResult !== null ? formatCurrency(row.costPerResult) : "—"}</td>
              {hasRevenue && <td className="py-1.5 pr-2 text-foreground">{row.revenue !== null ? formatCurrency(row.revenue) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
