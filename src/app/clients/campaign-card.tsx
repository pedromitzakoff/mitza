import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/**
 * Card executivo de UMA campanha — nome, canal, investimento, resultado
 * principal, CPA e ROAS (quando existir). Deliberadamente enxuto (pedido
 * explícito: "não quero copiar o Meta Ads, quero uma visão muito mais
 * limpa") — nunca mostra todas as métricas disponíveis de uma vez, só o
 * essencial pra decisão rápida.
 *
 * Integração Google Ads: Campanhas passou a ser channel-aware
 * (`campaign_daily_metrics`, independente de Criativos) — o badge de canal
 * é a única identificação nova no card, nunca um comparativo entre canais
 * aqui (isso pertence ao resumo consolidado do Resumo Executivo).
 *
 * Etapa "Resumo Executivo": SEM indicador de variação % (removido a pedido
 * explícito do usuário — "essa informação gera mais dúvida do que valor").
 * Nunca reintroduzir esse dado neste card sem reabrir essa decisão.
 */
export function CampaignCard({ summary }: { summary: CampaignSummary }) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="truncate text-sm font-semibold text-foreground">{summary.campaignName}</p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {TRAFFIC_CHANNELS[summary.channel].shortLabel}
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
    </div>
  );
}
