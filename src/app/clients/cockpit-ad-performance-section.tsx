import type { MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";
import type { ChartMetricSeries } from "@/lib/meta-ads-dashboard/evolution-data";
import type { ExplorationRow } from "@/lib/meta-ads-dashboard/exploration-data";
import type { AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { CockpitAdMetricCards } from "./cockpit-ad-metric-cards";
import { CockpitAdEvolutionSection } from "./cockpit-ad-evolution-section";
import { CockpitAdExplorationSection } from "./cockpit-ad-exploration-section";

/**
 * MITZA ONE — Cockpit Único do Cliente, seção "Performance Meta Ads".
 * Substitui a antiga `CockpitPerformanceSection` (resumo + botão "Ver
 * Performance completa") — pedido explícito do usuário: todo o conteúdo
 * rico que vivia em `/clients/[id]/meta-ads` (cards de KPI, gráficos de
 * evolução, exploração Campanha→Conjunto→Anúncio) passa a viver AQUI
 * DENTRO, sem nenhum link pra outra rota (regra de página única,
 * reafirmada mesmo após a consolidação).
 *
 * Só renderizada pelo Cockpit (`app/clients/[id]/page.tsx`) quando o
 * cliente usa o canal Meta (`clientChannels.includes("meta")`) — mesmo
 * critério condicional já usado pela seção "Canais" logo acima, nenhuma
 * segunda regra de "este cliente usa Meta Ads?".
 */
export function CockpitAdPerformanceSection({
  clientId,
  metaAdAccountId,
  resultType,
  cards,
  evolution,
  explorationCampaigns,
  explorationAdSetRows,
  explorationCreativeRows,
}: {
  clientId: string;
  metaAdAccountId: string | null;
  resultType: PerformanceGoal | null;
  cards: MetricCardViewModel[];
  evolution: ChartMetricSeries[];
  explorationCampaigns: ExplorationRow[];
  explorationAdSetRows: AdSetDailyMetricRow[];
  explorationCreativeRows: AdCreativeDailyMetricRow[];
}) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Performance Meta Ads</h2>
        <p className="shrink-0 text-right text-[11px] text-overview-text-muted">
          {metaAdAccountId ? `Conta ${metaAdAccountId}` : "Conta Meta direta não configurada"}
        </p>
      </div>

      {/* Pedido do usuário (reafirmado na Etapa 2.4): diferenciar métricas
          atribuídas pela Meta de resultados gerais do negócio — rótulo
          explícito sempre visível junto dos cards de resultado. */}
      <p className="mt-1 text-xs text-overview-text-secondary">
        Resultados atribuídos pela Meta (janela de atribuição do Ads Manager) — não confirmados por uma fonte de negócio independente.
      </p>

      <div className="mt-3">
        <CockpitAdMetricCards cards={cards} />
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Evolução da performance</p>
        <div className="mt-1.5">
          <CockpitAdEvolutionSection series={evolution} />
        </div>
      </div>

      <div className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Campanhas, conjuntos e anúncios</p>
        <div className="mt-1.5">
          <CockpitAdExplorationSection
            clientId={clientId}
            resultType={resultType}
            campaigns={explorationCampaigns}
            adSetDailyRows={explorationAdSetRows}
            creativeDailyRows={explorationCreativeRows}
          />
        </div>
      </div>
    </div>
  );
}
