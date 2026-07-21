import type { ClientOperationalState } from "@/lib/client-operational-state";

/**
 * Camada de agregação da agência sobre o domínio novo (Etapa "Consolidação
 * da Arquitetura — Fase A"). Substituta pretendida de `lib/agency-metrics.ts`
 * (que opera sobre o motor legado, `OperationClientCard` de
 * `operation-data.ts`) — mas ainda não usada por nenhuma tela: a Visão Geral
 * continua em `agency-metrics.ts` até migrar pra `ClientOperationalState`
 * numa PR futura. Esta Fase A só cria a fundação.
 *
 * Deliberadamente NÃO inclui uma agregação de "ritmo financeiro"
 * (dentro/acima/abaixo do esperado — `computeSpendRhythmCounts` no legado):
 * ritmo financeiro (`FinancialPace`/`SpendStatus`, ±20% fixo) e a dimensão de
 * investimento do Motor de Saúde (15/30/50% escalonado) são vocabulários
 * diferentes por decisão explícita (Prioridade 4 da Etapa) — não devem ser
 * confundidos nem substituídos um pelo outro. Portar "ritmo" pra este
 * domínio é decisão de uma PR futura, não desta.
 *
 * Também não inclui nada equivalente a `computeSprintOpsSummary` (execução
 * de sprint/tarefas por baldes) — esse dado não existe em
 * `ClientOperationalState` (que carrega só `overdueTasksCount`, não a lista
 * de tarefas nem execução por sprint); portar isso exigiria decisão de
 * produto sobre se "atividade"/"execução operacional" entra no Motor de
 * Saúde como dimensão nova (Prioridade "Activity" da Etapa, deixada em
 * aberto).
 */

export interface HealthPortfolioCounts {
  saudavel: number;
  em_acompanhamento: number;
  em_risco: number;
  acao_necessaria: number;
}

/** Distribuição da carteira por `healthStatus` — nunca uma severidade nova,
 * só contagem sobre o que o motor já classificou. */
export function computeHealthPortfolioCounts(cards: ClientOperationalState[]): HealthPortfolioCounts {
  const counts: HealthPortfolioCounts = { saudavel: 0, em_acompanhamento: 0, em_risco: 0, acao_necessaria: 0 };
  for (const card of cards) counts[card.evaluation.healthStatus]++;
  return counts;
}

export interface HealthFinancialSummary {
  planned: number;
  actual: number;
  /** Clientes sem planejamento de investimento definido no mês (dimensão
   * `investment.planned === null`) — nunca contribuem `0` fabricado à soma
   * de `planned`, só ficam de fora e contam aqui. */
  withoutPlan: number;
}

/** Soma planejado/realizado de investimento de todos os clientes com plano
 * definido — mesmo princípio de `agency-metrics.ts`'s `computeFinancialSummary`
 * (nunca média de percentuais, cliente sem meta não distorce o agregado),
 * porém lendo da dimensão `investment` do Motor de Saúde em vez do card
 * legado. */
export function computeHealthFinancialSummary(cards: ClientOperationalState[]): HealthFinancialSummary {
  let planned = 0;
  let actual = 0;
  let withoutPlan = 0;
  for (const card of cards) {
    const investment = card.evaluation.dimensions.investment;
    if (investment.planned === null) {
      withoutPlan++;
      continue;
    }
    planned += investment.planned;
    actual += investment.actual;
  }
  return { planned, actual, withoutPlan };
}

export interface HealthResultsMetric {
  count: number;
  clientsWithData: number;
  costPerResult: number | null;
}

export interface HealthResultsSummary {
  leads: HealthResultsMetric;
  sales: HealthResultsMetric;
}

function summarizeGoal(cards: ClientOperationalState[], goal: "leads" | "sales"): HealthResultsMetric {
  const withData = cards.filter(
    (c) => c.performanceGoal === goal && c.evaluation.dimensions.results.hasPerformanceData,
  );
  const count = withData.reduce((sum, c) => sum + c.evaluation.dimensions.results.actual, 0);
  const spend = withData.reduce((sum, c) => sum + c.evaluation.dimensions.investment.actual, 0);
  return { count, clientsWithData: withData.length, costPerResult: count > 0 ? spend / count : null };
}

/** Resultado consolidado da agência (leads/vendas/custo por resultado) —
 * mesmo princípio de `agency-metrics.ts`'s `computeAgencyResultsSummary`:
 * custo médio é sempre investimento somado ÷ resultado somado, nunca média
 * de custos já calculados por cliente. */
export function computeHealthResultsSummary(cards: ClientOperationalState[]): HealthResultsSummary {
  return { leads: summarizeGoal(cards, "leads"), sales: summarizeGoal(cards, "sales") };
}

export interface HealthManagerSummaryRow {
  managerId: string;
  managerName: string;
  totalClients: number;
  portfolio: HealthPortfolioCounts;
  withPendingTasks: number;
  needingReview: number;
}

function needsReview(card: ClientOperationalState): boolean {
  const review = card.evaluation.dimensions.review;
  return review.enabled && review.status !== "nenhum";
}

/** Uma linha por gestor — agrupa por `managerId` (cada cliente tem no máximo
 * um gestor principal neste domínio, diferente do legado que suportava
 * vários via `client_managers`). */
export function computeHealthManagerSummary(
  managers: { id: string; name: string }[],
  cards: ClientOperationalState[],
): HealthManagerSummaryRow[] {
  return managers.map((manager) => {
    const managerCards = cards.filter((c) => c.managerId === manager.id);
    let withPendingTasks = 0;
    let needingReviewCount = 0;
    for (const card of managerCards) {
      if (card.overdueTasksCount > 0) withPendingTasks++;
      if (needsReview(card)) needingReviewCount++;
    }
    return {
      managerId: manager.id,
      managerName: manager.name,
      totalClients: managerCards.length,
      portfolio: computeHealthPortfolioCounts(managerCards),
      withPendingTasks,
      needingReview: needingReviewCount,
    };
  });
}
