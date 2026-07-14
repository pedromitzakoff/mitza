import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { formatPerformanceComparisonText, getLatestPerformanceUpdateText } from "@/lib/performance";
import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { formatCurrency, formatPercent, formatShortDateTime } from "@/lib/format";

const STATUS_TEXT_CLASSES: Record<PerformanceSummary["comparison"]["status"], string> = {
  better: "text-green-600 dark:text-green-400",
  on_target: "text-muted-foreground",
  worse: "text-red-600 dark:text-red-400",
  not_available: "text-muted-foreground",
};

/**
 * Bloco "Performance do mês" — dimensão nova e SEPARADA do financeiro
 * (Etapa 71): próxima do card de Investimento na página do cliente, mas
 * nunca fundida com ele (nenhum card único misturando os dois). Vazio
 * (`goal === null`) mostra só a ação de configurar; sem canal selecionado
 * nesta etapa — a visão inicial é sempre consolidada (seção 6/7).
 */
export function PerformanceSummarySection({
  goal,
  targetCostPerResult,
  summary,
  channelBreakdown,
  editHref,
}: {
  goal: PerformanceGoal | null;
  targetCostPerResult: number | null;
  /** `null` só quando `goal` também é `null` (sem objetivo configurado —
   * não há o que resumir). */
  summary: PerformanceSummary | null;
  /** Resultado por canal do mês, só os canais com pelo menos 1 registro
   * (Etapa 71, seção 8: nunca mostrar canal zerado/sem dado). Renderizado
   * apenas quando há dado em MAIS de 1 canal. */
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
  editHref: string;
}) {
  if (!goal || !summary) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-medium text-foreground">Performance do mês</h2>
        <p className="mt-1 text-sm text-muted-foreground">Objetivo de performance não configurado.</p>
        <div className="mt-1.5">
          <Link href={editHref} className="text-xs font-medium text-brand hover:underline">
            Configurar objetivo
          </Link>
        </div>
      </div>
    );
  }

  const config = PERFORMANCE_GOALS[goal];
  const comparisonText = formatPerformanceComparisonText(summary.comparison, formatPercent);
  const updateText = getLatestPerformanceUpdateText(summary.latestSource, summary.latestUpdatedAt, formatShortDateTime);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Performance do mês</h2>

      {!summary.hasAnyRecord ? (
        <p className="mt-1 text-sm text-muted-foreground">Sem dados de performance registrados.</p>
      ) : (
        <>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-base font-semibold text-foreground">
              {formatPerformanceResult(summary.resultCount, goal)}
            </p>
            <p className="text-sm text-foreground">
              {config.costMetricShortLabel}{" "}
              <span className="font-semibold">
                {summary.costPerResult !== null ? formatCurrency(summary.costPerResult) : "—"}
              </span>
            </p>
            {targetCostPerResult !== null && (
              <p className="text-[11px] text-muted-foreground">
                Meta {config.costMetricShortLabel} {formatCurrency(targetCostPerResult)}
              </p>
            )}
          </div>

          {summary.costUnavailableReason === "zero_results" && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Nenhum resultado gerado no período.</p>
          )}
          {summary.costUnavailableReason === "no_spend_for_scope" && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Custo por resultado indisponível.</p>
          )}

          {comparisonText && (
            <p className={`mt-0.5 text-[11px] font-medium ${STATUS_TEXT_CLASSES[summary.comparison.status]}`}>
              {comparisonText}
            </p>
          )}

          <p className="mt-1.5 text-[11px] text-muted-foreground">{updateText}</p>

          {channelBreakdown.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-border pt-1.5">
              {channelBreakdown.map(({ channel, resultCount }) => (
                <p key={channel} className="text-[11px] text-muted-foreground">
                  {TRAFFIC_CHANNELS[channel].shortLabel}:{" "}
                  <span className="font-medium text-foreground">{formatPerformanceResult(resultCount, goal)}</span>
                  {" · Custo por resultado indisponível"}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
