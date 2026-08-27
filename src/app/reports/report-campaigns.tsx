import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { EmptyState } from "@/components/workspace/empty-state";
import { NO_CAMPAIGNS_MESSAGE } from "@/lib/analytics-messages";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/**
 * Lista de campanhas do Relatório — mesma fonte/agregação da seção
 * "Campanhas" do Analytics (`CampaignSummary`, `buildCampaignSummaries`,
 * lib/campaign-analytics.ts), apresentação nova: linha + divisória sutil,
 * nunca grid de cards com borda (`campaign-card.tsx`/
 * `analytics-campaigns-section.tsx` continuam intocados, servindo só o
 * Analytics) — identidade desta rodada é "poucos containers", card dentro
 * de card explicitamente evitado. Cada linha carrega o badge do próprio
 * canal, nunca confundindo campanhas de Meta e Google mesmo lado a lado
 * (escopo "Consolidado").
 */
export function ReportCampaignsList({ summaries }: { summaries: CampaignSummary[] }) {
  if (summaries.length === 0) {
    return <EmptyState title={NO_CAMPAIGNS_MESSAGE} />;
  }

  return (
    <div className="divide-y divide-overview-border">
      {summaries.map((summary) => (
        <ReportCampaignRow key={`${summary.channel}-${summary.campaignName}`} summary={summary} />
      ))}
    </div>
  );
}

function ReportCampaignRow({ summary }: { summary: CampaignSummary }) {
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-semibold text-overview-text-primary">{summary.campaignName}</p>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">
          {TRAFFIC_CHANNELS[summary.channel].shortLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <CampaignMetric label="Investimento" value={formatCurrency(summary.totalSpend)} />
        {goalConfig && summary.totalResultCount !== null && (
          <CampaignMetric label={goalConfig.resultMetricLabel} value={String(summary.totalResultCount)} />
        )}
        {goalConfig && summary.cpa !== null && (
          <CampaignMetric label={goalConfig.costMetricShortLabel} value={formatCurrency(summary.cpa)} />
        )}
        {/* Faturamento/ROAS só quando a fonte real tiver o dado por campanha
            — nunca distribuído artificialmente a partir do agregado do
            cliente (seção 10 do pedido). */}
        {summary.totalRevenue !== null && <CampaignMetric label="Faturamento" value={formatCurrency(summary.totalRevenue)} />}
        {summary.roas !== null && <CampaignMetric label="ROAS" value={`${summary.roas.toFixed(2)}x`} />}
      </div>
    </div>
  );
}

function CampaignMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-overview-text-primary">{value}</p>
    </div>
  );
}
