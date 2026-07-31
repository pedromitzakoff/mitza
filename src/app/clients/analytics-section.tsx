import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import { buildAnalyticsHero, buildAnalyticsKpiCards, buildLearningsNarrative, buildResultHeadline, buildResultLede, buildTrendCaption } from "@/lib/analytics";
import { buildPeriodHighlights } from "@/lib/period-highlights";
import { NO_ANALYTICS_DATA_MESSAGE, NO_HIGHLIGHTS_MESSAGE, NO_PERFORMANCE_GOAL_MESSAGE } from "@/lib/analytics-messages";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsChapter } from "./analytics-chapter";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsExecutiveSummary } from "./analytics-executive-summary";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsHighlightCard } from "./analytics-highlight-card";
import { AnalyticsOpportunities } from "./analytics-opportunities";

/**
 * "Resumo Executivo" — tela principal do hub de Analytics. Etapa "Resumo
 * Executivo" (refinamento pós-reorganização): deixou de responder só "como
 * foi o resultado" pra responder "o que realmente vale a pena saber"
 * (pedido explícito do usuário — "prefiro menos informação, mas extremamente
 * relevante"). Quatro capítulos, cada um com a PERGUNTA que responde como
 * título literal:
 *
 *   I.   Como foi o resultado?          → manchete + lide + KPIs + evolução
 *   II.  O que mais chamou atenção?     → Destaques do período (cards)
 *   III. O que aprendemos?              → narrativa executiva determinística
 *   IV.  Quais oportunidades existem?   → espaço reservado, sem regra ainda
 *
 * O antigo Capítulo "Onde aconteceu?" (tabela por canal) saiu daqui — a
 * sub-seção Campanhas responde essa pergunta com muito mais profundidade
 * hoje; mantê-lo aqui também seria a redundância que o usuário pediu pra
 * eliminar. KPIs e gráfico de evolução subiram pro Capítulo I (mesmo
 * agrupamento da futura página 2 do PDF executivo: "Resumo Executivo — KPIs
 * + gráfico de evolução").
 *
 * Mesma arquitetura de dados de sempre (`analytics-data.ts`,
 * `lib/analytics.ts`) mais `lib/period-highlights.ts` (Destaques, reaproveita
 * os agregados de Criativos/Campanhas já buscados pro mesmo período — nenhum
 * dado novo). Coluna de leitura travada em `max-w-2xl`, nunca esticando em
 * telas largas.
 */
export function AnalyticsSection({
  data,
  creativeSummaries,
  campaignSummaries,
  configureObjectiveHref,
}: {
  data: ClientAnalyticsData;
  creativeSummaries: CreativeSummary[];
  campaignSummaries: CampaignSummary[];
  configureObjectiveHref: string;
}) {
  if (!data.performanceGoal) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState>{NO_PERFORMANCE_GOAL_MESSAGE}</EmptyState>
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
        <EmptyState>{NO_ANALYTICS_DATA_MESSAGE}</EmptyState>
      </div>
    );
  }

  const goal = data.performanceGoal;
  const hasAnyRecord = data.summary?.hasAnyRecord ?? false;
  const hero = buildAnalyticsHero({ goal, summary: data.summary!, previousSummary: data.previousSummary, formatCurrencyValue: formatCurrency });
  const headline = buildResultHeadline(goal, hero, hasAnyRecord);
  const lede = buildResultLede({ goal, hero, hasAnyRecord, actualSpend: data.actualSpend, formatCurrencyValue: formatCurrency });
  const kpiCards = buildAnalyticsKpiCards(goal, data.actualSpend, data.summary, data.previousSummary, formatCurrency);
  const learnings = buildLearningsNarrative({
    goal,
    summary: data.summary!,
    previousSummary: data.previousSummary,
    channelRows: data.channelRows,
    totalActualSpend: data.actualSpend,
    heroPercentChange: hero.percentChange,
  });
  const trendCaption = data.trend ? buildTrendCaption(data.trend) : null;
  const highlights = buildPeriodHighlights({
    goal,
    trend: data.trend,
    creativeSummaries,
    campaignSummaries,
    formatCurrencyValue: formatCurrency,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <AnalyticsChapter index={1} question="Como foi o resultado?">
        <h1 className="mb-3 font-serif text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">{headline}</h1>
        <p className="mb-6 max-w-xl font-serif text-lg leading-relaxed text-foreground sm:text-xl">{lede}</p>
        <AnalyticsKpiGrid cards={kpiCards} />
        {data.trend && (
          <div className="mt-6">
            <AnalyticsTrendChart trend={data.trend} />
            {trendCaption && (
              <p className="mt-5 max-w-xl border-l-2 border-brand pl-3.5 text-sm leading-relaxed text-muted-foreground">{trendCaption}</p>
            )}
          </div>
        )}
      </AnalyticsChapter>

      <AnalyticsChapter index={2} question="O que mais chamou atenção?">
        {highlights.length === 0 ? (
          <EmptyState>{NO_HIGHLIGHTS_MESSAGE}</EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {highlights.map((highlight) => (
              <AnalyticsHighlightCard key={highlight.key} highlight={highlight} />
            ))}
          </div>
        )}
      </AnalyticsChapter>

      <AnalyticsChapter index={3} question="O que aprendemos?">
        <AnalyticsExecutiveSummary sentences={learnings} />
      </AnalyticsChapter>

      <AnalyticsChapter index={4} question="Quais oportunidades existem?">
        <AnalyticsOpportunities />
      </AnalyticsChapter>
    </div>
  );
}
