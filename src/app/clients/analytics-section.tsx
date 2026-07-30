import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import {
  buildAnalyticsHero,
  buildAnalyticsKpiCards,
  buildExecutiveSummaryNarrative,
  buildResultHeadline,
  buildResultLede,
  buildTrendCaption,
  buildWhereAside,
  type AnalyticsPeriodPreset,
} from "@/lib/analytics";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsPeriodMenu } from "./analytics-period-menu";
import { AnalyticsChapter } from "./analytics-chapter";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsExecutiveSummary } from "./analytics-executive-summary";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsWhere } from "./analytics-where";
import { ClientHistoryList } from "./client-history-list";

/**
 * Aba Analytics — Etapa "Analytics como Relatório": segunda reformulação
 * completa (a primeira foi um facelift de dashboard; esta trata a tela como
 * a experiência de leitura de um relatório executivo — pedido explícito do
 * usuário). Cinco capítulos fixos, cada um com a PERGUNTA que responde como
 * título literal (`AnalyticsChapter`), nunca um rótulo genérico de
 * dashboard:
 *
 *   I.   Como foi o resultado?          → manchete + lide em prosa
 *   II.  O que explica esse resultado?  → narrativa + evidência (KPIs)
 *   III. Onde aconteceu?                → participação por canal
 *   IV.  O que mudou?                   → evolução diária + legenda
 *   V.   O que fizemos durante esse período? → histórico de ações
 *
 * Mesma arquitetura de dados de sempre (`analytics-data.ts`,
 * `lib/analytics.ts`, `lib/instagram-metrics.ts`) — nenhuma consulta ou
 * cálculo novo, só a composição/apresentação. Coluna de leitura travada em
 * `max-w-2xl`, nunca esticando em telas largas — um relatório não fica mais
 * largo num monitor grande.
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
  const masthead = (
    <div className="mb-10 flex items-center justify-between gap-3 border-b border-border pb-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Relatório executivo</p>
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
      <div className="mx-auto max-w-2xl">
        {masthead}
        <EmptyState>Este cliente ainda não tem um objetivo de performance configurado.</EmptyState>
        <Link href={configureObjectiveHref} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      </div>
    );
  }

  const hasAnyData = data.actualSpend > 0 || (data.summary?.hasAnyRecord ?? false);
  if (!hasAnyData) {
    return (
      <div className="mx-auto max-w-2xl">
        {masthead}
        <EmptyState>Não encontramos dados para o período selecionado.</EmptyState>
      </div>
    );
  }

  const goal = data.performanceGoal;
  const hasAnyRecord = data.summary?.hasAnyRecord ?? false;
  const hero = buildAnalyticsHero({ goal, summary: data.summary!, previousSummary: data.previousSummary, formatCurrencyValue: formatCurrency });
  const headline = buildResultHeadline(goal, hero, hasAnyRecord);
  const lede = buildResultLede({ goal, hero, hasAnyRecord, actualSpend: data.actualSpend, formatCurrencyValue: formatCurrency });
  const kpiCards = buildAnalyticsKpiCards(goal, data.actualSpend, data.summary, data.previousSummary, formatCurrency);
  const executiveSummary = buildExecutiveSummaryNarrative({
    goal,
    summary: data.summary!,
    channelRows: data.channelRows,
    totalActualSpend: data.actualSpend,
    heroPercentChange: hero.percentChange,
  });
  const whereAside = buildWhereAside(data.channelRows.length);
  const trendCaption = data.trend ? buildTrendCaption(data.trend) : null;

  return (
    <div className="mx-auto max-w-2xl">
      {masthead}

      <AnalyticsChapter index={1} question="Como foi o resultado?">
        <h1 className="mb-3 font-serif text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">{headline}</h1>
        <p className="max-w-xl font-serif text-lg leading-relaxed text-foreground sm:text-xl">{lede}</p>
      </AnalyticsChapter>

      <AnalyticsChapter index={2} question="O que explica esse resultado?">
        <div className="flex flex-col gap-6">
          <AnalyticsExecutiveSummary sentences={executiveSummary} />
          <AnalyticsKpiGrid cards={kpiCards} />
        </div>
      </AnalyticsChapter>

      <AnalyticsChapter index={3} question="Onde aconteceu?">
        <div className="flex flex-col gap-4">
          <AnalyticsWhere goal={goal} rows={data.channelRows} totalSpend={data.actualSpend} />
          <p className="border-t border-dashed border-border pt-4 text-sm leading-relaxed text-muted-foreground">{whereAside}</p>
        </div>
      </AnalyticsChapter>

      <AnalyticsChapter index={4} question="O que mudou?">
        {data.trend ? (
          <div>
            <AnalyticsTrendChart trend={data.trend} formatCurrencyValue={formatCurrency} />
            {trendCaption && (
              <p className="mt-5 max-w-xl border-l-2 border-brand pl-3.5 text-sm leading-relaxed text-muted-foreground">{trendCaption}</p>
            )}
          </div>
        ) : (
          <EmptyState>Ainda não há dados diários suficientes para descrever a mudança no período.</EmptyState>
        )}
      </AnalyticsChapter>

      <AnalyticsChapter index={5} question="O que fizemos durante esse período?">
        <div className="rounded-lg bg-zinc-50 px-4 py-1 dark:bg-zinc-900/40">
          <ClientHistoryList
            rows={historyRows}
            buildReviewDetailHref={buildReviewDetailHref}
            emptyLabel="Nenhuma ação registrada no período selecionado."
          />
        </div>
      </AnalyticsChapter>
    </div>
  );
}
