import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import { buildAnalyticsChannelInsights, buildAnalyticsKpiCards, type AnalyticsPeriodPreset } from "@/lib/analytics";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsHeader } from "./analytics-header";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsChannelTable } from "./analytics-channel-table";
import { AnalyticsInsights } from "./analytics-insights";
import { Section } from "./section";

/**
 * MVP da aba Analytics — módulo exclusivo do cliente (nunca aparece na
 * visão global da agência), UMA estrutura única que renderiza só o que os
 * dados disponíveis permitem (nunca um dashboard diferente por objetivo,
 * nunca uma métrica preenchida com zero quando o dado é indisponível).
 * Composição: cabeçalho de período → KPIs → evolução diária → detalhamento
 * por canal → insights — cada bloco decide sozinho se tem o que mostrar.
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
}: {
  data: ClientAnalyticsData;
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  periodStart: string;
  periodEnd: string;
  customStart: string;
  customEnd: string;
  configureObjectiveHref: string;
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

  const kpiCards = buildAnalyticsKpiCards(data.performanceGoal, data.actualSpend, data.summary, formatCurrency);
  const insights = buildAnalyticsChannelInsights(data.channelRows, data.performanceGoal, formatCurrency);

  return (
    <div className="flex flex-col gap-3">
      {header}

      <div className="rounded-lg border border-border bg-card p-3">
        <AnalyticsKpiGrid cards={kpiCards} />
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
        <Section title="Detalhamento por canal">
          <div className="rounded-lg border border-border bg-card p-3">
            <AnalyticsChannelTable goal={data.performanceGoal} rows={data.channelRows} />
          </div>
        </Section>
      )}

      {insights.length > 0 && (
        <Section title="Insights">
          <AnalyticsInsights insights={insights} />
        </Section>
      )}
    </div>
  );
}
