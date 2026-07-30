import { TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { AnalyticsChannelRow } from "@/lib/analytics";
import { formatCurrency } from "@/lib/format";

/**
 * Capítulo III do relatório ("Onde aconteceu?") — Etapa "Analytics como
 * Relatório": substitui os cards de canal por uma lista comparativa com
 * barra de participação, honesta com qualquer número de canais reais —
 * NUNCA inventa um segundo canal só pra ter o que comparar (achado real:
 * um cliente pode ter só Meta Ads ativo, e a barra deve mostrar 100% sem
 * fingir disputa nenhuma).
 */
export function AnalyticsWhere({ goal, rows, totalSpend }: { goal: PerformanceGoal; rows: AnalyticsChannelRow[]; totalSpend: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum canal com investimento registrado no período.</p>;
  }

  const config = PERFORMANCE_GOALS[goal];
  const sorted = [...rows].sort((a, b) => b.spend - a.spend);
  const single = sorted.length === 1;

  return (
    <div className="flex flex-col">
      {sorted.map((row) => {
        const share = totalSpend > 0 ? Math.round((row.spend / totalSpend) * 100) : 0;
        return (
          <div
            key={row.channel}
            className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[7.5rem_1fr_auto_auto]"
          >
            <p className="text-sm font-medium text-foreground">{TRAFFIC_CHANNELS[row.channel].label}</p>
            <div className="h-[5px] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-brand" style={{ width: `${single ? 100 : share}%` }} />
            </div>
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {single ? "100% do investimento" : `${share}% do investimento`}
              </span>
              {formatCurrency(row.spend)}
            </p>
            <p className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/70">{config.costMetricShortLabel}</span>
              {row.costPerResult !== null ? formatCurrency(row.costPerResult) : "—"}
            </p>
          </div>
        );
      })}
    </div>
  );
}
