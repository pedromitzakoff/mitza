import type { HealthStatus } from "@/lib/account-health-engine";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import type { ClientChannelState } from "@/lib/client-channel-breakdown";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { SpendStatus } from "@/lib/spend-status";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Camada de projeção da Visão Geral (Etapa "Consolidação da Arquitetura —
 * Fase B") — transforma `ClientOperationalState` (+ o recorte por canal de
 * `client-channel-breakdown.ts`) no shape que os componentes desta tela já
 * esperavam. Nenhuma função aqui recalcula severidade, prioridade ou motivo
 * — só lê os valores já resolvidos pelo Motor de Saúde e reformata o shape.
 *
 * Duas exceções deliberadas, ambas fora do domínio de saúde do cliente:
 * `monthStatus` (Ritmo financeiro/`FinancialPace`, Prioridade 4 — mantido no
 * motor legado de propósito, nunca substituído pela dimensão de investimento
 * do Motor de Saúde) e `sprintPeriodLabel` ("Sprint atual", um conceito de
 * ciclo de sprint que não existe neste domínio). Os dois continuam vindo do
 * card legado (`operation-data.ts`), passados como parâmetro — o resto do
 * card legado nunca é lido aqui.
 */

/** Só os 3 campos que `ClientObjectiveTable` de fato lê de um resumo de
 * performance — nunca o `PerformanceSummary` inteiro (`comparison`,
 * `latestSource` etc. não são usados nesta tabela). Um `PerformanceSummary`
 * real (de `client-channel-breakdown.ts`) é estruturalmente compatível —
 * atribuído direto, nunca reconstruído campo a campo. */
export interface ObjectivePerformanceCell {
  hasAnyRecord: boolean;
  resultCount: number;
  costPerResult: number | null;
}

export interface ClientObjectiveTableRow {
  clientId: string;
  clientName: string;
  performanceGoal: PerformanceGoal | null;
  monthActual: number;
  monthActualByChannel: Partial<Record<TrafficChannel, number>>;
  monthStatus: SpendStatus;
  monthPerformanceSummary: ObjectivePerformanceCell | null;
  monthPerformanceSummaryByChannel: Partial<Record<TrafficChannel, ObjectivePerformanceCell | null>>;
  targetCostPerResult: number | null;
  sprintPeriodLabel: string | null;
  clientUsesChannel: Partial<Record<TrafficChannel, boolean>>;
}

/**
 * Constrói UMA linha da tabela por objetivo — `state` fornece
 * identidade/investimento/resultado/custo (consolidado); `channelBreakdown`
 * fornece o recorte por canal (Prioridade 5, `client-channel-breakdown.ts`);
 * `legacyMonthStatus`/`legacySprintPeriodLabel` são as duas exceções
 * documentadas acima.
 */
export function buildClientObjectiveRow(
  state: ClientOperationalState,
  legacyMonthStatus: SpendStatus,
  legacySprintPeriodLabel: string | null,
  channelBreakdown: ClientChannelState[],
): ClientObjectiveTableRow {
  const { investment, results, cost } = state.evaluation.dimensions;

  const monthActualByChannel: Partial<Record<TrafficChannel, number>> = {};
  const monthPerformanceSummaryByChannel: Partial<Record<TrafficChannel, ObjectivePerformanceCell | null>> = {};
  const clientUsesChannel: Partial<Record<TrafficChannel, boolean>> = {};
  for (const channelState of channelBreakdown) {
    monthActualByChannel[channelState.channel] = channelState.investmentActual;
    monthPerformanceSummaryByChannel[channelState.channel] = channelState.performanceSummary;
    clientUsesChannel[channelState.channel] = true;
  }

  return {
    clientId: state.clientId,
    clientName: state.clientName,
    performanceGoal: state.performanceGoal,
    monthActual: investment.actual,
    monthActualByChannel,
    monthStatus: legacyMonthStatus,
    monthPerformanceSummary: state.performanceGoal
      ? { hasAnyRecord: results.hasPerformanceData, resultCount: results.actual, costPerResult: cost.actual }
      : null,
    monthPerformanceSummaryByChannel,
    targetCostPerResult: cost.planned,
    sprintPeriodLabel: legacySprintPeriodLabel,
    clientUsesChannel,
  };
}

export interface OverviewPriorityItem {
  clientId: string;
  clientName: string;
  healthStatus: HealthStatus;
  primaryReason: string;
  actionHref: string;
}

/** Uma linha de "Prioridades de hoje" — motivo sempre vem de
 * `evaluation.primaryReason` (Prioridade 1: nunca reconstruído/analisado
 * localmente). Quem chama já deve ter filtrado `healthStatus !== "saudavel"`
 * e restringido ao recorte de filtros ativo — esta função só transforma o
 * shape de UM cliente já elegível. */
export function buildOverviewPriorityItem(state: ClientOperationalState): OverviewPriorityItem {
  return {
    clientId: state.clientId,
    clientName: state.clientName,
    healthStatus: state.evaluation.healthStatus,
    primaryReason: state.evaluation.primaryReason,
    actionHref: `/clients/${state.clientId}`,
  };
}
