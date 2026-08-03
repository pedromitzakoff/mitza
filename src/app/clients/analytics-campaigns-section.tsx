import { EmptyState } from "@/components/ui/empty-state";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import { NO_CAMPAIGNS_MESSAGE } from "@/lib/analytics-messages";
import { CampaignCard } from "./campaign-card";

/**
 * Seção "Campanhas" do hub de Analytics — visão consolidada, nunca uma
 * réplica do painel do Meta Ads (pedido explícito do usuário). Integração
 * Google Ads: fonte independente de Criativos (`campaign_daily_metrics`,
 * channel-aware) — vazio quando nenhuma fonte tiver `campaign_name_column`
 * configurada. Chave de renderização inclui o canal — Meta e Google podem
 * ter campanhas com o mesmo nome, nunca tratadas como o mesmo card.
 */
export function AnalyticsCampaignsSection({ summaries }: { summaries: CampaignSummary[] }) {
  if (summaries.length === 0) {
    return <EmptyState>{NO_CAMPAIGNS_MESSAGE}</EmptyState>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((summary) => (
        <CampaignCard key={`${summary.channel}-${summary.campaignName}`} summary={summary} />
      ))}
    </div>
  );
}
