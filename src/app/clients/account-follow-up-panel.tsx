import type { OperationalTrackingRow, MonthlyOccurrenceSummary } from "@/lib/operational-tracking";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
import { AccountActivitySummary } from "./account-activity-summary";
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
 * cliente. Absorve reuniões e entregas de criativo (que antes viviam num
 * bloco separado, "Rotina do cliente", removido da interface — os dados,
 * tabela e lógica de `tasks`/`computeOperationalTracking` continuam
 * exatamente os mesmos, só a apresentação muda). "Cadência" e "Intervalo
 * atual" foram removidos da interface por pedido explícito — continuam
 * existindo por baixo, intactos, só não são mais exibidos aqui.
 *
 * Etapa 62: o bloco agora respeita o mês selecionado na página inteira
 * (`isCurrentMonth`). No mês atual, última análise/otimização e próxima
 * reunião/entrega são sempre o dado GLOBAL mais recente (nunca só do mês)
 * — é assim que já funcionava. Num mês anterior, os mesmos indicadores
 * passam a ser escopados ao mês selecionado (Etapa 8): sem "próxima" (não
 * existe "próxima" num mês fechado), só o resultado objetivo do que
 * aconteceu. O histórico (antes só de análises, sempre as 2 mais recentes)
 * virou um histórico unificado (análises + otimizações + reuniões +
 * entregas) escopado ao mês selecionado, no máximo 5 linhas, com "Ver
 * todos de {mês}" pro resto (Etapa 9) — reaproveita `operational_events`
 * (nenhuma tabela nova, ver `lib/client-operational-history.ts`).
 *
 * Refinamento visual (Etapa 75): sem título/subtítulo — o card começa
 * direto pelas métricas (investimento/resultados/custo por resultado),
 * seguidas do resumo operacional (otimização/reunião/entrega) e do
 * histórico do mês, recolhido por padrão. A ação "+ Registrar otimização"
 * que ficava aqui em cima foi removida por ser redundante com a mesma ação
 * já existente em "Otimizações", dentro de cada sprint — nenhuma
 * funcionalidade foi perdida, só o atalho duplicado no topo da página.
 * Nenhum cálculo financeiro ou de performance mudou — os 3 KPIs só
 * consomem `monthActual`/`monthPerformanceSummary` já calculados pela
 * página; nunca recomputados aqui (`MonthlyKpiSummary` é puramente
 * apresentacional).
 */
export function AccountFollowUpPanel({
  monthLabel,
  isCurrentMonth,
  monthActual,
  performanceGoal,
  performanceSummary,
  configureObjectiveHref,
  lastOptimization,
  tracking,
  monthlySummary,
  historyRows,
  hasMoreHistory,
  historyHref,
  buildReviewDetailHref,
  clientId,
  returnTo,
}: {
  monthLabel: string;
  isCurrentMonth: boolean;
  /** Investimento realizado do mês selecionado — já calculado pela camada
   * financeira (`sumActualSpendForMonth`), nunca recomputado aqui. */
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  performanceSummary: PerformanceSummary | null;
  configureObjectiveHref: string;
  lastOptimization: LastOptimizationInfo | null;
  tracking: Record<"reuniao" | "entrega_criativo", OperationalTrackingRow>;
  monthlySummary: Record<"reuniao" | "entrega_criativo", MonthlyOccurrenceSummary>;
  historyRows: ClientHistoryRow[];
  hasMoreHistory: boolean;
  historyHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
  clientId: string;
  returnTo: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <MonthlyKpiSummary
        monthActual={monthActual}
        performanceGoal={performanceGoal}
        performanceSummary={performanceSummary}
        configureObjectiveHref={configureObjectiveHref}
      />

      <div className="mt-3 border-t border-border pt-2.5">
        <AccountActivitySummary
          monthLabel={monthLabel}
          isCurrentMonth={isCurrentMonth}
          lastOptimization={lastOptimization}
          tracking={tracking}
          monthlySummary={monthlySummary}
          clientId={clientId}
          returnTo={returnTo}
        />
      </div>

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
