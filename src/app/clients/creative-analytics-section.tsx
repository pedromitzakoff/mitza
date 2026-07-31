import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { AnalyticsPeriodPreset, AnalyticsTrend } from "@/lib/analytics";
import type { CreativeDetail, CreativeSummary } from "@/lib/creative-analytics";
import { AnalyticsPeriodMenu } from "./analytics-period-menu";
import { CreativeCard } from "./creative-card";
import { AnalyticsTrendChart } from "./analytics-trend-chart";

/**
 * Módulo de Criativos (Creative Analytics) — arquitetura aprovada: primeiro
 * módulo da plataforma que consolida performance por CRIATIVO (identidade =
 * `creative_name`, o `ad_name` do Meta — nunca `ad_id`), nunca por
 * campanha/conjunto. Nunca gated por `client.performance_goal` (pedido
 * explícito do usuário: "não limitar o módulo ao objetivo da conta") — a
 * própria disponibilidade de dado em cada card/detalhe é que decide o que
 * aparece, sem nenhuma regra por cliente aqui.
 *
 * Lista (cards, ordenados por investimento) e detalhe (resumo + campanhas +
 * evolução) vivem na MESMA aba, alternando por querystring
 * (`creative=<nome>`) — mesmo padrão de navegação 100% por URL já usado em
 * Relatórios/Analytics, nenhum estado de UI novo.
 */
export function CreativeAnalyticsSection({
  summaries,
  detail,
  baseHref,
  activePreset,
  periodStart,
  periodEnd,
  customStart,
  customEnd,
  buildDetailHref,
}: {
  summaries: CreativeSummary[];
  detail: CreativeDetail | null;
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
  buildDetailHref: (creativeName: string) => string;
}) {
  const masthead = (
    <div className="mb-6 flex items-center justify-between gap-3 border-b border-border pb-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Criativos</p>
      <AnalyticsPeriodMenu
        baseHref={baseHref}
        paramPrefix="creatives"
        activePreset={activePreset}
        periodStart={periodStart}
        periodEnd={periodEnd}
        customStart={customStart}
        customEnd={customEnd}
      />
    </div>
  );

  if (detail) {
    return (
      <div>
        {masthead}
        <CreativeDetailView detail={detail} backHref={baseHref} />
      </div>
    );
  }

  return (
    <div>
      {masthead}
      {summaries.length === 0 ? (
        <EmptyState>Nenhum dado de criativo encontrado no período selecionado.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((summary) => (
            <CreativeCard key={summary.creativeName} summary={summary} detailHref={buildDetailHref(summary.creativeName)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreativeDetailView({ detail, backHref }: { detail: CreativeDetail; backHref: string }) {
  const { summary, campaigns, evolution } = detail;
  const goalConfig = summary.resultType ? PERFORMANCE_GOALS[summary.resultType] : null;

  const trend: AnalyticsTrend | null =
    evolution.length >= 2
      ? {
          spend: { label: "Investimento", points: evolution.map((point) => ({ date: point.date, value: point.spend })) },
          result:
            goalConfig && evolution.some((point) => point.resultCount !== null)
              ? { label: goalConfig.resultMetricLabel, points: evolution.map((point) => ({ date: point.date, value: point.resultCount ?? 0 })) }
              : null,
        }
      : null;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={backHref} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Voltar aos criativos
        </Link>

        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{summary.creativeName}</h1>
          {summary.permalinkUrl && (
            <a href={summary.permalinkUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-brand" aria-label="Ver criativo no Instagram">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.campaignNames.length} {summary.campaignNames.length === 1 ? "campanha" : "campanhas"}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo</h2>
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <SummaryStat label="Investimento" value={formatCurrency(summary.totalSpend)} />
          {goalConfig && summary.totalResultCount !== null && (
            <SummaryStat label={goalConfig.resultMetricLabel} value={String(summary.totalResultCount)} />
          )}
          {goalConfig && summary.cpa !== null && <SummaryStat label={goalConfig.costMetricShortLabel} value={formatCurrency(summary.cpa)} />}
          {summary.totalImpressions !== null && <SummaryStat label="Impressões" value={summary.totalImpressions.toLocaleString("pt-BR")} />}
          {summary.totalReach !== null && <SummaryStat label="Alcance" value={summary.totalReach.toLocaleString("pt-BR")} />}
          {summary.totalClicks !== null && <SummaryStat label="Cliques" value={summary.totalClicks.toLocaleString("pt-BR")} />}
          {summary.ctr !== null && <SummaryStat label="CTR" value={formatPercent(summary.ctr * 100)} />}
          {summary.cpc !== null && <SummaryStat label="CPC" value={formatCurrency(summary.cpc)} />}
          {summary.roas !== null && <SummaryStat label="ROAS" value={`${summary.roas.toFixed(2)}x`} />}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campanhas</h2>
        <CampaignsTable campaigns={campaigns} goalLabel={goalConfig?.resultMetricLabel ?? null} costLabel={goalConfig?.costMetricShortLabel ?? null} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evolução</h2>
        {trend ? (
          <AnalyticsTrendChart trend={trend} />
        ) : (
          <EmptyState>Ainda não há dados diários suficientes para descrever a evolução deste criativo no período.</EmptyState>
        )}
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function CampaignsTable({
  campaigns,
  goalLabel,
  costLabel,
}: {
  campaigns: CreativeDetail["campaigns"];
  goalLabel: string | null;
  costLabel: string | null;
}) {
  const hasResult = goalLabel !== null && campaigns.some((c) => c.resultCount !== null);
  const hasImpressions = campaigns.some((c) => c.impressions !== null);
  const hasClicks = campaigns.some((c) => c.clicks !== null);
  const hasCtr = campaigns.some((c) => c.ctr !== null);
  const hasRoas = campaigns.some((c) => c.roas !== null);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Campanha</th>
            <th className="px-3 py-2 text-right">Investimento</th>
            {hasResult && <th className="px-3 py-2 text-right">{goalLabel}</th>}
            {hasResult && <th className="px-3 py-2 text-right">{costLabel}</th>}
            {hasImpressions && <th className="px-3 py-2 text-right">Impressões</th>}
            {hasClicks && <th className="px-3 py-2 text-right">Cliques</th>}
            {hasCtr && <th className="px-3 py-2 text-right">CTR</th>}
            {hasRoas && <th className="px-3 py-2 text-right">ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.campaignName} className="border-b border-border last:border-0">
              <td className="max-w-xs truncate px-3 py-2 text-foreground">{campaign.campaignName}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(campaign.spend)}</td>
              {hasResult && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.resultCount ?? "—"}</td>}
              {hasResult && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.cpa !== null ? formatCurrency(campaign.cpa) : "—"}</td>}
              {hasImpressions && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.impressions?.toLocaleString("pt-BR") ?? "—"}</td>}
              {hasClicks && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.clicks?.toLocaleString("pt-BR") ?? "—"}</td>}
              {hasCtr && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.ctr !== null ? formatPercent(campaign.ctr * 100) : "—"}</td>}
              {hasRoas && <td className="px-3 py-2 text-right tabular-nums text-foreground">{campaign.roas !== null ? `${campaign.roas.toFixed(2)}x` : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
