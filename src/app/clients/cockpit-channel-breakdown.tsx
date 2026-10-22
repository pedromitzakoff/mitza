import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { ClientGoal } from "@/lib/client-goals";
import type { DashboardChannelDataIssue } from "./channel-data-issue";

/**
 * KOFF Analytics — Redesign definitivo do Cockpit: quebra por canal
 * compacta, dentro da Visão executiva — substitui a antiga seção "Canais"
 * (um card com moldura própria POR canal).
 * Só renderizada quando o cliente usa MAIS de um canal — com um canal só, o
 * número por canal é idêntico ao consolidado que a Visão executiva já
 * mostra acima, repeti-lo aqui seria a duplicação exata que o redesign
 * pediu pra eliminar (`eliminar cards repetidos em outras seções`).
 *
 * Mesma lógica/dado de sempre (`deriveMonthlyKpiTexts`, nenhum cálculo
 * novo) — só a apresentação vira uma linha compacta por canal em vez de um
 * card inteiro.
 */
export interface ChannelBreakdownRowView {
  channel: TrafficChannel;
  goal: ClientGoal | null;
  actualSpend: number;
  performanceSummary: PerformanceSummary | null;
  targetCostPerResult: number | null;
  configureObjectiveHref: string;
  dataIssue?: DashboardChannelDataIssue | null;
}

export function CockpitChannelBreakdown({ rows }: { rows: ChannelBreakdownRowView[] }) {
  if (rows.length < 2) return null;

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Por canal</h3>
      <div className="mt-2 flex flex-col divide-y divide-overview-border">
        {rows.map((row) => {
          const performanceGoal = row.goal?.resultType ?? null;
          const { resultsValue, costValue } = deriveMonthlyKpiTexts(performanceGoal, row.performanceSummary, formatCurrency);
          const resultLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].resultMetricLabel : "Resultado";

          return (
            <div key={row.channel} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
              <div className="flex min-w-[6rem] items-center gap-1.5">
                <span className="font-medium text-overview-text-primary">{TRAFFIC_CHANNELS[row.channel].label}</span>
                {row.dataIssue && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      row.dataIssue.severity === "error"
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {row.dataIssue.label}
                  </span>
                )}
              </div>
              {performanceGoal ? (
                <div className="ml-auto flex items-center gap-4 text-overview-text-secondary">
                  <span className="tabular-nums">{formatCurrency(row.actualSpend)} invest.</span>
                  <span className="tabular-nums">
                    {resultsValue} {resultLabel.toLowerCase()}
                  </span>
                  <span className="tabular-nums">{costValue}</span>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-2 text-overview-text-secondary">
                  <span className="tabular-nums">{formatCurrency(row.actualSpend)} invest.</span>
                  <Link href={row.configureObjectiveHref} className="font-medium text-brand hover:underline">
                    Configurar objetivo
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
