import { EmptyState } from "@/components/ui/empty-state";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import { CampaignCard } from "./campaign-card";

/**
 * Seção "Campanhas" do hub de Analytics — visão consolidada, nunca uma
 * réplica do painel do Meta Ads (pedido explícito do usuário). Mesma fonte
 * de dados de Criativos (`ad_creative_daily_metrics`) — vazio pelo mesmo
 * motivo (fonte sem `ad_name_column`/`campaign_name_column` configurados).
 */
export function AnalyticsCampaignsSection({ summaries }: { summaries: CampaignSummary[] }) {
  if (summaries.length === 0) {
    return <EmptyState>Nenhum dado de campanha encontrado no período selecionado.</EmptyState>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((summary) => (
        <CampaignCard key={summary.campaignName} summary={summary} />
      ))}
    </div>
  );
}
