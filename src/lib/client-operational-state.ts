import {
  DIMENSION_PRIORITY_ORDER,
  DIMENSION_SEVERITY_RANK,
  type AccountHealthEvaluation,
  type DimensionSeverity,
  type HealthStatus,
} from "@/lib/account-health-engine";
import type { ClientChannelState } from "@/lib/client-channel-breakdown";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { evaluateCpaDiagnostic, evaluateInvestmentDiagnostic, type ClientDiagnostics } from "@/lib/metric-diagnostics";

/**
 * Domínio neutro do estado operacional do cliente (Etapa "Consolidação da
 * Arquitetura — Fase A"). Promovido pra cá a partir de `operation-triage.ts`
 * (onde se chamava `OperationClientCard` — nome hoje também usado, com um
 * shape completamente diferente, por `app/operation/operation-data.ts`,
 * o motor legado). Este arquivo não pertence a nenhuma tela: é o lugar pra
 * onde a Visão Geral e os Relatórios devem migrar quando saírem do motor
 * legado (`client-priority.ts`/`operation-data.ts`), numa PR futura — esta
 * Fase A só cria a fundação, não migra nenhuma tela.
 *
 * Hoje o único consumidor é a Operação (`operation-triage.ts`/
 * `operation-triage-data.ts`/`operation-client-card.tsx`), sem nenhuma
 * mudança de comportamento em relação à versão anterior — só o tipo e a
 * ordenação mudaram de endereço.
 */
export interface ClientOperationalState {
  clientId: string;
  clientName: string;
  managerId: string | null;
  managerName: string | null;
  avatarUrl: string | null;
  performanceGoal: PerformanceGoal | null;
  evaluation: AccountHealthEvaluation;
  overdueTasksCount: number;
  /** Nº de tarefas ABERTAS (pendente + atrasado, não só atrasado) —
   * diferente de `overdueTasksCount` (só atrasado). Alimenta
   * `diagnostics.pendencias`, ver metric-diagnostics.ts. */
  openTasksCount: number;
  /** `daily_spend.synced_at` mais recente do cliente (qualquer canal) —
   * alimenta o indicador "Atualizado hoje/ontem/há N dias". `null` = nunca
   * sincronizado. */
  lastDataSyncAt: string | null;
  /** Etapa "Novo Conceito de Monitoramento Operacional" — os eixos do
   * Motor de Diagnóstico Único (CPA, Investimento, Pendências, Atividade),
   * computados uma única vez aqui e consumidos por qualquer tela (nunca
   * recalculados no componente). `atividade` combina a atividade
   * operacional real (`client_last_operational_activity`) com
   * `account_reviews` (ver client-operational-state-data.ts) — a parte de
   * `account_reviews` é um placeholder deliberado até a estrutura real de
   * Otimizações substituir essa fonte. */
  diagnostics: ClientDiagnostics;
}

const DIMENSION_PRIORITY_RANK: Record<keyof AccountHealthEvaluation["dimensions"], number> = Object.fromEntries(
  DIMENSION_PRIORITY_ORDER.map((key, index) => [key, index]),
) as Record<keyof AccountHealthEvaluation["dimensions"], number>;

function primaryDimensionSeverity(evaluation: AccountHealthEvaluation): DimensionSeverity {
  return evaluation.primaryDimension ? evaluation.dimensions[evaluation.primaryDimension].status : "nenhum";
}

const HEALTH_STATUS_SEVERITY_RANK: Record<HealthStatus, number> = {
  acao_necessaria: 0,
  em_risco: 1,
  em_acompanhamento: 2,
  saudavel: 3,
};

/**
 * Ordenação canônica de `ClientOperationalState[]` — critério: healthStatus
 * (mais severo primeiro, comparado diretamente, sem passar por nenhuma
 * "banda" intermediária) → severidade da dimensão principal → prioridade do
 * motivo (`DIMENSION_PRIORITY_ORDER`) → nome. Idêntico, em resultado, ao
 * antigo `sortOperationClientCards` (que comparava via `OperationTriageBand`,
 * uma tradução 1:1 de `healthStatus` — comparar o status direto produz a
 * mesma ordem, sem a indireção).
 *
 * Esta é a implementação de referência que substitui, para quem migrar pra
 * este domínio, os três sorters que coexistiam (`client-priority.ts` da
 * Visão Geral, `account-priority.ts` das Sprints, e o antigo
 * `sortOperationClientCards` só da Operação). Os dois primeiros continuam
 * em uso — não foram alterados nesta etapa — até suas telas migrarem pra
 * este domínio numa PR futura.
 */
export function sortClientOperationalStates(cards: ClientOperationalState[]): ClientOperationalState[] {
  return [...cards].sort((a, b) => {
    const healthDiff = HEALTH_STATUS_SEVERITY_RANK[a.evaluation.healthStatus] - HEALTH_STATUS_SEVERITY_RANK[b.evaluation.healthStatus];
    if (healthDiff !== 0) return healthDiff;

    const severityDiff =
      DIMENSION_SEVERITY_RANK[primaryDimensionSeverity(b.evaluation)] -
      DIMENSION_SEVERITY_RANK[primaryDimensionSeverity(a.evaluation)];
    if (severityDiff !== 0) return severityDiff;

    const aPriority = a.evaluation.primaryDimension
      ? DIMENSION_PRIORITY_RANK[a.evaluation.primaryDimension]
      : DIMENSION_PRIORITY_ORDER.length;
    const bPriority = b.evaluation.primaryDimension
      ? DIMENSION_PRIORITY_RANK[b.evaluation.primaryDimension]
      : DIMENSION_PRIORITY_ORDER.length;
    const priorityDiff = aPriority - bPriority;
    if (priorityDiff !== 0) return priorityDiff;

    return a.clientName.localeCompare(b.clientName);
  });
}

/**
 * Diagnóstico do Motor Único recortado por canal (Etapa "Visão Geral + Reports
 * no Core") — mesmo espírito de `evaluateClientChannelHealth` (que este
 * substitui na Visão Geral), mas chamando `evaluateInvestmentDiagnostic`/
 * `evaluateCpaDiagnostic` em vez de reimplementar qualquer regra: nenhuma
 * severidade nova, só os mesmos dois cálculos do Core com os valores do
 * canal (`ClientChannelState`, `client-channel-breakdown.ts`) no lugar dos
 * valores consolidados. Planejamento e Pendências são fatos de nível de
 * CONTA, não de canal — vêm de `state.diagnostics` sem reavaliação.
 *
 * Investimento esperado (prorrateado) não existe por canal neste modelo de
 * dados (só o Consolidado tem orçamento planejado — mesma decisão já
 * registrada em `evaluateClientChannelHealth`) — por isso `expectedToDate`
 * entra sempre `null`, e o Core já trata isso como "sem base de comparação"
 * (`tone: "normal"`), nunca um "0 esperado" fabricado. Meta de custo
 * (`targetCostPerResult`) é fato de conta, não de canal — o chamador deve
 * passar o mesmo valor vigente já resolvido pro cliente.
 */
export function evaluateClientChannelDiagnostics(
  state: ClientOperationalState,
  channelState: ClientChannelState,
  targetCostPerResult: number | null,
): ClientDiagnostics {
  return {
    planejamento: state.diagnostics.planejamento,
    pendencias: state.diagnostics.pendencias,
    atividade: state.diagnostics.atividade,
    investment: evaluateInvestmentDiagnostic(channelState.investmentActual, null),
    cpa: evaluateCpaDiagnostic(channelState.performanceSummary?.costPerResult ?? null, targetCostPerResult),
  };
}
