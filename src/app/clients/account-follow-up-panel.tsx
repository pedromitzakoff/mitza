import type { ReactNode } from "react";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { DailyResultSeries } from "@/lib/daily-results";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
import { MonthlyGoalProgress } from "./monthly-goal-progress";
import { ResultsByChannel } from "./results-by-channel";
import { CollapsibleAccountHistory } from "./collapsible-account-history";

/**
 * Última otimização (Etapa 74) — substitui os antigos indicadores separados
 * "Última análise"/"Última otimização": otimização é a revisão estratégica
 * da conta em si (account_reviews), registrada mesmo quando nenhuma
 * alteração foi necessária — nunca dois indicadores pro mesmo evento.
 */
export interface LastOptimizationInfo {
  reviewedAt: string;
  managerName: string;
  outcome: AccountReviewOutcome;
  /** Tipos das alterações técnicas registradas (só quando outcome é
   * OPTIMIZATION_PERFORMED) — vazio nos demais casos. */
  optimizationTypes: OptimizationType[];
  /** Descrição do problema (só quando outcome é ISSUE_IDENTIFIED). */
  issueDescription: string | null;
}

/**
 * "ACOMPANHAMENTO DA CONTA" — principal bloco operacional da página do
 * cliente. "Cadência" e "Intervalo atual" foram removidos da interface por
 * pedido explícito — continuam existindo por baixo, intactos, só não são
 * mais exibidos aqui. "Última revisão" (antes exibida aqui, junto de
 * "Próxima reunião"/"Próxima entrega") foi reposicionada pro cabeçalho da
 * conta (`clients/[id]/page.tsx`) — reunião/entrega saíram de vez do fluxo
 * operacional, por pedido explícito.
 *
 * Etapa 62: o histórico (antes só de análises, sempre as 2 mais recentes)
 * virou um histórico unificado (análises + otimizações + reuniões +
 * entregas) escopado ao mês selecionado, no máximo 5 linhas, com "Ver
 * todos de {mês}" pro resto (Etapa 9) — reaproveita `operational_events`
 * (nenhuma tabela nova, ver `lib/client-operational-history.ts`).
 *
 * Refinamento visual (Etapa 75): sem título/subtítulo — o card começa
 * direto pelas métricas (investimento/resultados/custo por resultado/meta),
 * seguido do diagnóstico, de "Resultados por canal" (Etapa "Meta entra no
 * card principal": substitui o antigo card "Performance do mês", removido —
 * meta/comparação migraram pro card principal via `MonthlyKpiSummary`,
 * detalhamento por canal virou este bloco de responsabilidade única) e do
 * histórico do mês, recolhido por padrão. Nenhum cálculo financeiro ou de
 * performance muda — os 4 KPIs e o diagnóstico só consomem valores já
 * calculados pela página; nunca recomputados aqui.
 *
 * Etapa "Visão Geral: decisão em 5 segundos": o sub-bloco entre os KPIs e
 * "Resultados por canal" deixou de ser a "Evolução diária de resultados"
 * (gráfico de 7 barras, granularidade de investigação) e virou "Meta
 * mensal" (`MonthlyGoalProgress`) — quanto já foi feito no mês, qual a
 * meta, que % isso representa e se o ritmo está adequado. A granularidade
 * diária não foi removida do produto: continua disponível, com mais
 * profundidade, no Analytics (`AnalyticsTrendChart`) — só deixou de
 * competir com a decisão rápida que esta tela precisa responder. Evolui o
 * card já existente (pedido explícito do usuário: nunca um card novo).
 *
 * Refinamento visual (Etapa "Grid e hierarquia da página do cliente"): o
 * seletor "Consolidado | Meta Ads | Google Ads" (`channelSwitch`, montado
 * pela página — este componente nunca conhece `VisaoGeralChannelSwitch`)
 * passou a viver DENTRO da borda deste card, alinhado à direita no topo —
 * antes ficava solto num `<div>` acima do card, lido como um elemento
 * desconectado das métricas que ele controla. Puramente posicional: nenhuma
 * prop, href ou lógica de seleção mudou, só onde o slot é renderizado.
 */
export function AccountFollowUpPanel({
  channelSwitch,
  monthLabel,
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  dailyResultSeries,
  targetResultCount,
  expectedResultsToDate,
  channelBreakdown,
  configureObjectiveHref,
  historyRows,
  hasMoreHistory,
  historyHref,
  buildReviewDetailHref,
}: {
  /** Seletor de canal — `undefined`/`null` quando a tela que usa este card
   * não tem esse conceito (nunca fabricado aqui). */
  channelSwitch?: ReactNode;
  monthLabel: string;
  /** Investimento realizado do mês selecionado — já calculado pela camada
   * financeira (`sumActualSpendForMonth`), nunca recomputado aqui. */
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
  /** Série dos últimos 7 dias já resolvida (`buildDailyResultSeries`) — só
   * `undefined` quando `performanceGoal` também é `null` (nada a evoluir). */
  dailyResultSeries?: DailyResultSeries;
  /** Meta de QUANTIDADE de resultado vigente pro mês selecionado — `null` =
   * sem meta configurada (nunca mostra "X/undefined"). */
  targetResultCount?: number | null;
  /** `computeMonthlyExpectedToDateByCalendar` aplicado a `targetResultCount`
   * — mesma lógica temporal já usada pro investimento. */
  expectedResultsToDate?: number | null;
  /** Resultado por canal do mês, só os canais com pelo menos 1 registro —
   * `ResultsByChannel` só renderiza algo com dado em mais de 1 canal. */
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
  configureObjectiveHref: string;
  historyRows: ClientHistoryRow[];
  hasMoreHistory: boolean;
  historyHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
}) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      {channelSwitch && <div className="mb-2 flex justify-end">{channelSwitch}</div>}
      <MonthlyKpiSummary
        monthActual={monthActual}
        performanceGoal={performanceGoal}
        performanceSummary={performanceSummary}
        targetCostPerResult={targetCostPerResult}
        configureObjectiveHref={configureObjectiveHref}
      />

      {performanceGoal && targetResultCount != null && targetResultCount > 0 && expectedResultsToDate != null && (
        <MonthlyGoalProgress
          goal={performanceGoal}
          monthResultCount={performanceSummary?.resultCount ?? 0}
          targetResultCount={targetResultCount}
          expectedToDate={expectedResultsToDate}
          series={dailyResultSeries}
        />
      )}

      {performanceGoal && <ResultsByChannel goal={performanceGoal} channelBreakdown={channelBreakdown} />}

      <CollapsibleAccountHistory
        monthLabel={monthLabel}
        historyRows={historyRows}
        hasMoreHistory={hasMoreHistory}
        historyHref={historyHref}
        buildReviewDetailHref={buildReviewDetailHref}
      />
    </div>
  );
}
