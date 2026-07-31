import { TrendingDown, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/**
 * Card executivo de UMA campanha — investimento, resultado principal, CPA e
 * variação vs período anterior. Deliberadamente enxuto (pedido explícito:
 * "não quero copiar o Meta Ads, quero uma visão muito mais limpa") — nunca
 * mostra todas as métricas disponíveis de uma vez, só o essencial pra
 * decisão rápida. Métricas sem dado real (sem metric_mappings, sem
 * variação anterior confiável) simplesmente não aparecem.
 */
export function CampaignCard({ summary }: { summary: CampaignSummary }) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="truncate text-sm font-semibold text-foreground">{summary.campaignName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.creativeCount} {summary.creativeCount === 1 ? "criativo" : "criativos"}
        </p>
      </div>

      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Investimento</p>
        <p className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(summary.totalSpend)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        {goalConfig && summary.totalResultCount !== null && (
          <span className="tabular-nums text-foreground">
            {summary.totalResultCount} {goalConfig.resultMetricLabel}
          </span>
        )}
        {goalConfig && summary.cpa !== null && (
          <span className="tabular-nums text-muted-foreground">
            {goalConfig.costMetricShortLabel} {formatCurrency(summary.cpa)}
          </span>
        )}
        {summary.roas !== null && <span className="tabular-nums text-muted-foreground">ROAS {summary.roas.toFixed(2)}x</span>}
      </div>

      {summary.percentChange !== null && (
        <div className={`flex items-center gap-1 text-sm font-medium ${summary.percentChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {summary.percentChange >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
          {summary.percentChange >= 0 ? "+" : ""}
          {summary.percentChange.toFixed(0)}%
        </div>
      )}
    </div>
  );
}
