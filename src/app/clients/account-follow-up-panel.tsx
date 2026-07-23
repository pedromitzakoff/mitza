import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
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
 * direto pelas métricas (investimento/resultados/custo por resultado),
 * seguido do histórico do mês, recolhido por padrão. Nenhum cálculo
 * financeiro ou de performance mudou — os 3 KPIs só consomem
 * `monthActual`/`monthPerformanceSummary` já calculados pela página; nunca
 * recomputados aqui (`MonthlyKpiSummary` é puramente apresentacional).
 */
export function AccountFollowUpPanel({
  monthLabel,
  monthActual,
  performanceGoal,
  performanceSummary,
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
        configureObjectiveHref={configureObjectiveHref}
      />

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
