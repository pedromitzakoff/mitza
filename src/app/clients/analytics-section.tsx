import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDateRange } from "@/lib/format";
import { buildAnalyticsHero, buildAnalyticsKpiCards, buildExecutiveSummaryNarrative, type AnalyticsPeriodPreset } from "@/lib/analytics";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsHeader } from "./analytics-header";
import { AnalyticsHeroSection } from "./analytics-hero";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsExecutiveSummary } from "./analytics-executive-summary";
import { AnalyticsScorePlaceholder } from "./analytics-score-placeholder";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsChannelCards } from "./analytics-channel-cards";
import { AnalyticsTopCreativesPlaceholder } from "./analytics-top-creatives-placeholder";
import { ClientHistoryList } from "./client-history-list";
import { Section } from "./section";

/**
 * Aba Analytics — Etapa "Analytics Instagramável": redesign completo pra ser
 * "bonita, fácil de entender em poucos segundos, digna de reunião e de
 * print pra Stories" (pedido explícito do usuário), sem virar mais
 * complexa — poucas informações, muito bem apresentadas, nunca uma dezena
 * de gráficos. Filosofia: como está → por que está assim → quais números
 * explicam isso (Hero → KPIs/Resumo → Evolução/Canais/Timeline), nunca
 * invertida.
 *
 * Composição (topo → base): cabeçalho de período → Hero (métrica principal +
 * variação vs. período anterior) → KPIs → Resumo Executivo (narrativa
 * determinística) → MITZA Score (placeholder puro) → Evolução diária →
 * Canais (cards, nunca "Campanhas" — ver `analytics-channel-cards.tsx`) →
 * Top Criativos (placeholder/skeleton, sem dado real ainda) → Timeline
 * (últimos eventos operacionais, mesmo dado da aba Timeline/drawer).
 */
export function AnalyticsSection({
  data,
  baseHref,
  activePreset,
  periodStart,
  periodEnd,
  customStart,
  customEnd,
  configureObjectiveHref,
  historyRows,
  buildReviewDetailHref,
}: {
  data: ClientAnalyticsData;
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
  configureObjectiveHref: string;
  historyRows: ClientHistoryRow[];
  buildReviewDetailHref: (reviewId: string) => string;
}) {
  const header = (
    <AnalyticsHeader
      baseHref={baseHref}
      activePreset={activePreset}
      periodStart={periodStart}
      periodEnd={periodEnd}
      customStart={customStart}
      customEnd={customEnd}
    />
  );

  if (!data.performanceGoal) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className="rounded-lg border border-border bg-card p-3">
          <EmptyState>Este cliente ainda não tem um objetivo de performance configurado.</EmptyState>
          <Link href={configureObjectiveHref} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
            Configurar objetivo
          </Link>
        </div>
      </div>
    );
  }

  const hasAnyData = data.actualSpend > 0 || (data.summary?.hasAnyRecord ?? false);
  if (!hasAnyData) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className="rounded-lg border border-border bg-card p-3">
          <EmptyState>Não encontramos dados para o período selecionado.</EmptyState>
        </div>
      </div>
    );
  }

  const hero = buildAnalyticsHero({
    goal: data.performanceGoal,
    summary: data.summary!,
    previousSummary: data.previousSummary,
    formatCurrencyValue: formatCurrency,
  });
  const kpiCards = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, formatCurrency);
  const executiveSummary = buildExecutiveSummaryNarrative({
    goal: data.performanceGoal,
    summary: data.summary!,
    channelRows: data.channelRows,
    totalActualSpend: data.actualSpend,
    heroPercentChange: hero.percentChange,
  });

  return (
    <div className="flex flex-col gap-3">
      {header}

      <div className="border-b border-border">
        <AnalyticsHeroSection hero={hero} periodLabel={formatDateRange(periodStart, periodEnd)} />
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <AnalyticsKpiGrid cards={kpiCards} />
      </div>

      <Section title="Resumo Executivo">
        <div className="rounded-lg border border-border bg-card p-4">
          <AnalyticsExecutiveSummary sentences={executiveSummary} />
        </div>
      </Section>

      <div className="mt-6 max-w-xs">
        <AnalyticsScorePlaceholder />
      </div>

      <Section title="Evolução diária">
        <div className="rounded-lg border border-border bg-card p-3">
          {data.trend ? (
            <AnalyticsTrendChart trend={data.trend} formatCurrencyValue={formatCurrency} />
          ) : (
            <EmptyState>Ainda não há dados diários suficientes para gerar este gráfico.</EmptyState>
          )}
        </div>
      </Section>

      {data.channelRows.length >= 2 && (
        <Section title="Canais">
          <AnalyticsChannelCards goal={data.performanceGoal} rows={data.channelRows} />
        </Section>
      )}

      <Section title="Top Criativos">
        <AnalyticsTopCreativesPlaceholder />
      </Section>

      <Section title="Timeline">
        <div className="rounded-lg border border-border bg-card p-3">
          <ClientHistoryList
            rows={historyRows}
            buildReviewDetailHref={buildReviewDetailHref}
            emptyLabel="Nenhum evento registrado no período selecionado."
          />
        </div>
      </Section>
    </div>
  );
}
