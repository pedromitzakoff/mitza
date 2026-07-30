import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import { buildAnalyticsHero, buildAnalyticsKpiCards, buildExecutiveSummaryNarrative, type AnalyticsPeriodPreset } from "@/lib/analytics";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsPeriodMenu } from "./analytics-period-menu";
import { AnalyticsHeroSection } from "./analytics-hero";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsExecutiveSummary } from "./analytics-executive-summary";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsChannelCards } from "./analytics-channel-cards";
import { AnalyticsTopCreativesPlaceholder } from "./analytics-top-creatives-placeholder";
import { ClientHistoryList } from "./client-history-list";
import { Section } from "./section";

/**
 * Aba Analytics — Etapa "Analytics Instagramável" (facelift de UX/UI, ver
 * análise crítica apresentada antes da implementação): mesma arquitetura de
 * dados/cálculos de sempre, só a apresentação muda. Filosofia inalterada:
 * como está → por que está assim → quais números explicam isso (Hero → KPIs
 * → Resumo Executivo → Evolução/Canais/Timeline).
 *
 * Cabeçalho compacto (eyebrow "Analytics" + seletor de período em popover,
 * `AnalyticsPeriodMenu` — nunca mais um formulário de 2 campos sempre
 * visível). MITZA Score foi removido por completo (decisão explícita do
 * usuário: nenhum placeholder pra recurso inexistente). Profundidade vem de
 * variar deliberadamente o que tem moldura (Hero+KPIs, Evolução, Timeline —
 * os blocos "primários") do que não tem (Resumo Executivo, Canais, Top
 * Criativos — leem direto no fundo da página), em vez de tudo repetir a
 * mesma receita branco+borda.
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
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Analytics</p>
      <AnalyticsPeriodMenu
        baseHref={baseHref}
        activePreset={activePreset}
        periodStart={periodStart}
        periodEnd={periodEnd}
        customStart={customStart}
        customEnd={customEnd}
      />
    </div>
  );

  if (!data.performanceGoal) {
    return (
      <div>
        {header}
        <div className="mt-6">
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
      <div>
        {header}
        <div className="mt-6">
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
  const kpiCards = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, data.previousSummary, formatCurrency);
  const executiveSummary = buildExecutiveSummaryNarrative({
    goal: data.performanceGoal,
    summary: data.summary!,
    channelRows: data.channelRows,
    totalActualSpend: data.actualSpend,
    heroPercentChange: hero.percentChange,
  });

  return (
    <div>
      {header}

      <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <AnalyticsHeroSection hero={hero} />
        <div className="mt-6 border-t border-border pt-5">
          <AnalyticsKpiGrid cards={kpiCards} />
        </div>
      </div>

      <Section title="Resumo Executivo">
        <AnalyticsExecutiveSummary sentences={executiveSummary} />
      </Section>

      <Section title="Evolução">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
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
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
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
