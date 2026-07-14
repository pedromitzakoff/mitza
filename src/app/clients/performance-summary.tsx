import type { PerformanceSummary } from "@/lib/performance";
import { formatPerformanceComparisonText } from "@/lib/performance";
import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { formatCurrency, formatPercent } from "@/lib/format";

const STATUS_TEXT_CLASSES: Record<PerformanceSummary["comparison"]["status"], string> = {
  better: "text-green-600 dark:text-green-400",
  on_target: "text-muted-foreground",
  worse: "text-red-600 dark:text-red-400",
  not_available: "text-muted-foreground",
};

/**
 * Bloco "Performance do mês" — dimensão nova e SEPARADA do financeiro
 * (Etapa 71), próxima do card de Investimento na página do cliente. A
 * partir do refinamento visual do Acompanhamento da Conta (Etapa 72), o
 * resultado principal e o custo por resultado passaram a viver só em
 * "Principais KPIs do mês" (`monthly-kpi-summary.tsx`) — nunca duplicar os
 * mesmos 3 números em dois lugares consecutivos da página. Este componente
 * fica só com o que é SECUNDÁRIO à performance (meta de custo, comparação,
 * detalhe por canal) e retorna `null` quando não há nada secundário a
 * mostrar (objetivo não configurado, sem dado, ou sem meta/canal extra).
 */
export function PerformanceSummarySection({
  goal,
  targetCostPerResult,
  summary,
  channelBreakdown,
}: {
  goal: PerformanceGoal | null;
  targetCostPerResult: number | null;
  /** `null` só quando `goal` também é `null`. */
  summary: PerformanceSummary | null;
  /** Resultado por canal do mês, só os canais com pelo menos 1 registro —
   * exibido apenas quando há dado em MAIS de 1 canal. */
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
}) {
  const hasChannelBreakdown = channelBreakdown.length > 1;
  const hasTarget = Boolean(goal && summary?.hasAnyRecord && targetCostPerResult !== null);

  if (!goal || !summary || !summary.hasAnyRecord || (!hasTarget && !hasChannelBreakdown)) {
    return null;
  }

  const config = PERFORMANCE_GOALS[goal];
  const comparisonText = formatPerformanceComparisonText(summary.comparison, formatPercent);

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Performance do mês</h2>

      {hasTarget && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-[11px] text-muted-foreground">
            Meta {config.costMetricShortLabel} {formatCurrency(targetCostPerResult!)}
          </p>
          {comparisonText && (
            <p className={`text-[11px] font-medium ${STATUS_TEXT_CLASSES[summary.comparison.status]}`}>
              {comparisonText}
            </p>
          )}
        </div>
      )}

      {hasChannelBreakdown && (
        <div className={`flex flex-wrap gap-x-4 gap-y-0.5 ${hasTarget ? "mt-2 border-t border-border pt-1.5" : "mt-1"}`}>
          {channelBreakdown.map(({ channel, resultCount }) => (
            <p key={channel} className="text-[11px] text-muted-foreground">
              {TRAFFIC_CHANNELS[channel].shortLabel}:{" "}
              <span className="font-medium text-foreground">{formatPerformanceResult(resultCount, goal)}</span>
              {" · Custo por resultado indisponível"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
