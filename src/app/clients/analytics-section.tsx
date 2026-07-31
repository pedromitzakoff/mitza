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
} from "@/lib/analytics";
import type { ClientAnalyticsData } from "./analytics-data";
import { AnalyticsChapter } from "./analytics-chapter";
import { AnalyticsKpiGrid } from "./analytics-kpi-grid";
import { AnalyticsExecutiveSummary } from "./analytics-executive-summary";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { AnalyticsWhere } from "./analytics-where";

/**
 * Seção "Resumo" do hub de Analytics — Etapa "Reorganização do hub": deixou
 * de ter masthead/período próprios (agora vivem no `AnalyticsHubHeader`
 * compartilhado por todas as sub-seções) e perdeu o antigo Capítulo V ("O
 * que fizemos durante esse período?") — essa pergunta já tem resposta
 * própria na aba Timeline (histórico operacional completo), então repeti-la
 * aqui era exatamente a redundância que o usuário pediu pra eliminar.
 *
 * Quatro capítulos fixos, cada um com a PERGUNTA que responde como título
 * literal (`AnalyticsChapter`), nunca um rótulo genérico de dashboard:
 *
 *   I.   Como foi o resultado?          → manchete + lide em prosa
 *   II.  O que explica esse resultado?  → narrativa + evidência (KPIs)
 *   III. Onde aconteceu?                → participação por canal
 *   IV.  O que mudou?                   → evolução diária + legenda
 *
 * Mesma arquitetura de dados de sempre (`analytics-data.ts`,
 * `lib/analytics.ts`, `lib/instagram-metrics.ts`) — nenhuma consulta ou
 * cálculo novo, só a composição/apresentação. Coluna de leitura travada em
 * `max-w-2xl`, nunca esticando em telas largas — um relatório não fica mais
 * largo num monitor grande.
 */
export function AnalyticsSection({
  data,
  configureObjectiveHref,
}: {
  data: ClientAnalyticsData;
  configureObjectiveHref: string;
}) {
  if (!data.performanceGoal) {
    return (
      <div className="mx-auto max-w-2xl">
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
            <AnalyticsTrendChart trend={data.trend} />
            {trendCaption && (
              <p className="mt-5 max-w-xl border-l-2 border-brand pl-3.5 text-sm leading-relaxed text-muted-foreground">{trendCaption}</p>
            )}
          </div>
        ) : (
          <EmptyState>Ainda não há dados diários suficientes para descrever a mudança no período.</EmptyState>
        )}
      </AnalyticsChapter>
    </div>
  );
}
