import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
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
 */
export function AccountFollowUpPanel({
  monthLabel,
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  channelBreakdown,
  configureObjectiveHref,
  historyRows,
  hasMoreHistory,
  historyHref,
  buildReviewDetailHref,
}: {
  monthLabel: string;
  /** Investimento realizado do mês selecionado — já calculado pela camada
   * financeira (`sumActualSpendForMonth`), nunca recomputado aqui. */
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
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
    <div className="rounded-lg border border-border bg-card p-3">
      <MonthlyKpiSummary
        monthActual={monthActual}
        performanceGoal={performanceGoal}
        performanceSummary={performanceSummary}
        targetCostPerResult={targetCostPerResult}
        configureObjectiveHref={configureObjectiveHref}
      />

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
