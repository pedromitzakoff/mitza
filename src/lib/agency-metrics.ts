import type { OperationClientCard } from "@/app/operation/operation-data";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { HealthResultsMetric, HealthResultsSummary } from "@/lib/agency-health-aggregation";

/**
 * Agregações do dashboard da agência — tudo derivado dos cards já montados
 * por `buildOperationClientCard` (nenhuma regra nova, só soma/contagem).
 */
export interface PortfolioCounts {
  ativos: number;
  saudaveis: number;
  atencao: number;
  criticos: number;
  inativos: number;
}

export function computePortfolioCounts(cards: OperationClientCard[]): PortfolioCounts {
  return {
    ativos: cards.filter((c) => c.activityStatus === "ativo").length,
    saudaveis: cards.filter((c) => c.accountHealth === "saudavel").length,
    atencao: cards.filter((c) => c.accountHealth === "atencao").length,
    criticos: cards.filter((c) => c.accountHealth === "critico").length,
    inativos: cards.filter((c) => c.activityStatus === "inativo").length,
  };
}

export interface SpendRhythmCounts {
  total: number;
  dentro: number;
  abaixo: number;
  acima: number;
}

/** Distribuição por ritmo de investimento do mês — reaproveita `monthStatus`
 * (já classificado por classifySpendStatus, SPEND_STATUS_MARGIN central,
 * ±20%) sem inventar threshold novo. "sem_meta" entra só no total. */
export function computeSpendRhythmCounts(cards: OperationClientCard[]): SpendRhythmCounts {
  return {
    total: cards.length,
    dentro: cards.filter((c) => c.monthStatus === "dentro").length,
    abaixo: cards.filter((c) => c.monthStatus === "abaixo").length,
    acima: cards.filter((c) => c.monthStatus === "acima").length,
  };
}

export interface FinancialSummary {
  planned: number;
  /** Investimento REALIZADO total da agência — soma de TODOS os clientes do
   * recorte, independente de `hasMonthGoal` (Etapa "Separação Realizado ×
   * Ritmo", AJUSTE 1). Um cliente sem planejamento mensal continua com a
   * conta de anúncios rodando de verdade — excluí-lo daqui subestimaria o
   * investimento real da agência sem nenhuma base semântica. Nunca usar este
   * campo como numerador de `pct` (ver `actualForPacing`). */
  actual: number;
  /** Realizado só dos clientes COM meta — a única base comparável ao
   * `planned` (que também só soma quem tem meta). Numerador de `pct`; nunca
   * exposto como "o Realizado" isolado (isso é `actual`), só como o termo
   * interno do ritmo. `actual === actualForPacing` sempre que `semMeta` é 0
   * (nenhum cliente sem meta no recorte). */
  actualForPacing: number;
  /** % realizado sobre o planejado (`actualForPacing / planned`), ou null se
   * ninguém no recorte tem meta. NUNCA `actual / planned` — misturaria
   * investimento de clientes sem meta num percentual cujo denominador não os
   * contém. */
  pct: number | null;
  /** Soma do esperado até hoje (proporcional às sprints do mês) de todos os
   * clientes filtrados — mesma conta de `computeSprintExpectedToDate`. */
  expectedToDate: number;
  semMeta: number;
}

/**
 * Soma planejado/realizado/esperado de TODOS os clientes filtrados (nunca
 * uma média de percentuais por cliente) — assim clientes sem meta
 * (planejado = 0) não distorcem o percentual agregado, só reduzem o
 * denominador corretamente.
 *
 * AJUSTE 1 (correção da Etapa 68/seção 14): "Investimento realizado da
 * agência" e "Ritmo de investimento" são dois conceitos diferentes, cada um
 * com sua própria base de clientes — nunca a mesma soma reaproveitada pras
 * duas coisas. `actual` (realizado total) soma TODOS os clientes do recorte,
 * COM ou SEM meta — um cliente sem orçamento mensal vigente não pode
 * desaparecer do investimento real da agência, a conta de anúncios continua
 * rodando de verdade mesmo sem plano configurado no sistema. `planned` e
 * `actualForPacing` (o realizado usado SÓ pra calcular `pct`) continuam
 * escopados a quem tem meta (`hasMonthGoal`) — nunca misturar investimento de
 * quem não tem meta no numerador de uma porcentagem cujo denominador não os
 * contém (senão o ritmo mostraria, por exemplo, 100% quando o correto é
 * 80%). `semMeta` continua contando esses clientes à parte, nunca escondidos,
 * só fora da agregação de ritmo.
 */
export function computeFinancialSummary(cards: OperationClientCard[]): FinancialSummary {
  const withGoal = cards.filter((c) => c.hasMonthGoal);
  const planned = withGoal.reduce((sum, c) => sum + c.monthPlanned, 0);
  const actualForPacing = withGoal.reduce((sum, c) => sum + c.monthActual, 0);
  const actual = cards.reduce((sum, c) => sum + c.monthActual, 0);
  const pct = planned > 0 ? (actualForPacing / planned) * 100 : null;
  const expectedToDate = withGoal.reduce((sum, c) => sum + c.monthExpectedToDate, 0);
  const semMeta = cards.filter((c) => !c.hasMonthGoal).length;
  return { planned, actual, actualForPacing, pct, expectedToDate, semMeta };
}

/**
 * Fase 1 "Confiabilidade dos Dados" — Bug confirmado: os cards "Leads"/
 * "Vendas" da Visão Geral (`computeHealthResultsSummary`, sobre
 * `ClientOperationalState[]`) sempre somam TODOS os canais do cliente,
 * mesmo quando o filtro de plataforma (Meta/Google/TikTok) está ativo —
 * `ClientOperationalState` não tem nenhuma dimensão por canal. Esta função
 * usa o ingrediente por canal que já existe (Etapa 3, `OperationClientCard.
 * monthPerformanceSummaryByChannel`/`monthActualByChannel`, já calculado com
 * a MESMA `resolvePerformanceSummaryForGoal` central) — nunca uma segunda
 * lógica de custo-por-resultado. Mesmo formato de retorno
 * (`HealthResultsSummary`) e mesma regra de soma de
 * `agency-health-aggregation.ts`'s `summarizeGoal` (custo = investimento
 * somado ÷ resultado somado, nunca média de custos por cliente) — só a
 * fonte do dado muda (por canal, não consolidada).
 */
function summarizeGoalByChannel(cards: OperationClientCard[], goal: PerformanceGoal, channel: TrafficChannel): HealthResultsMetric {
  const withData = cards.filter(
    (c) => c.performanceGoal === goal && (c.monthPerformanceSummaryByChannel[channel]?.hasAnyRecord ?? false),
  );
  const count = withData.reduce((sum, c) => sum + (c.monthPerformanceSummaryByChannel[channel]?.resultCount ?? 0), 0);
  const spend = withData.reduce((sum, c) => sum + (c.monthActualByChannel[channel] ?? 0), 0);
  return { count, clientsWithData: withData.length, costPerResult: count > 0 ? spend / count : null };
}

/** Equivalente a `computeHealthResultsSummary` (mesmo shape de retorno),
 * mas escopado a UM canal — usado pela Visão Geral quando o filtro de
 * plataforma não é "Consolidado". `cards` já deve vir filtrado a quem usa
 * o canal (mesmo critério de `clientUsesChannel` já usado pro resto da
 * página) — esta função não filtra por conta própria. */
export function computeAgencyResultsByChannel(cards: OperationClientCard[], channel: TrafficChannel): HealthResultsSummary {
  return { leads: summarizeGoalByChannel(cards, "leads", channel), sales: summarizeGoalByChannel(cards, "sales", channel) };
}

export interface AgencyPeriodTotals {
  investment: number;
  leadsCount: number;
  leadsCostPerResult: number | null;
  salesCount: number;
  salesCostPerResult: number | null;
}

/**
 * Totais REALIZADOS da agência num período arbitrário (não necessariamente
 * um mês calendário) — Etapa "Revisão da Visão Geral": alimenta SÓ a
 * comparação "Evolução no período" contra o período anterior
 * (`lib/period-comparison.ts`), nunca os KPIs absolutos do período atual
 * (esses continuam vindo de `computeFinancialSummary`/
 * `computeHealthResultsSummary`, sobre cards completos). Mesmas regras de
 * sempre, só que sobre dado bruto (soma direta de `daily_spend`/registros de
 * performance) em vez de `OperationClientCard`/`ClientOperationalState`,
 * porque montar o card completo (sprint, orçamento, saúde) pra um segundo
 * período só pra tirar uma comparação dobraria o carregamento da página:
 *
 *   - investimento = soma direta de `daily_spend` dos clientes do escopo,
 *     sem depender de plano/meta configurados (mesma fonte usada em
 *     qualquer outro lugar do produto);
 *   - leads/vendas = soma do resultado dos clientes cujo OBJETIVO PRINCIPAL
 *     é aquele (`primaryGoalByClientId` = `clients.performance_goal`, nunca
 *     um objetivo secundário — `performanceRows` já deve vir filtrada por
 *     `filterRowsToPrimaryGoal`, `lib/client-plan.ts`); custo por resultado
 *     = investimento SÓ desses clientes ÷ resultado somado (nunca média de
 *     custos já calculados por cliente) — mesmo princípio de
 *     `agency-health-aggregation.ts`'s `summarizeGoal` ("clientsWithData" =
 *     tem ao menos 1 registro de performance no período), adaptado pra
 *     trabalhar sobre linhas brutas multi-cliente em vez de
 *     `ClientOperationalState[]`.
 */
export function computeAgencyPeriodTotals(input: {
  /** Escopo pro qual o investimento é somado — mesmo recorte de clientes já
   * usado por quem chamou `computeFinancialSummary` pro período atual
   * (mês/carteira/cliente + filtros de recorte), pra "Evolução no período"
   * comparar exatamente o mesmo conjunto de clientes do KPI absoluto. */
  investmentClientIds: Set<string>;
  /** Escopo pra leads/vendas — mesmo recorte já usado por
   * `computeHealthResultsSummary` pro período atual (mês/carteira/cliente,
   * sem os filtros de recorte). */
  resultsClientIds: Set<string>;
  /** Soma de `daily_spend.spend` por cliente no período anterior (todos os
   * canais, mesma soma "investimento" de sempre). */
  spendByClientId: Map<string, number>;
  /** Linhas de performance do período anterior, já filtradas por
   * `filterRowsToPrimaryGoal` (nunca um objetivo secundário contaminando a
   * soma). */
  performanceRows: { client_id: string; result_count: number }[];
  primaryGoalByClientId: Map<string, PerformanceGoal | null>;
}): AgencyPeriodTotals {
  const { investmentClientIds, resultsClientIds, spendByClientId, performanceRows, primaryGoalByClientId } = input;

  let investment = 0;
  for (const clientId of investmentClientIds) investment += spendByClientId.get(clientId) ?? 0;

  function summarizeGoal(goal: PerformanceGoal): { count: number; costPerResult: number | null } {
    const clientIdsWithData = new Set<string>();
    let count = 0;
    for (const row of performanceRows) {
      if (!resultsClientIds.has(row.client_id)) continue;
      if (primaryGoalByClientId.get(row.client_id) !== goal) continue;
      count += row.result_count;
      clientIdsWithData.add(row.client_id);
    }
    let spend = 0;
    for (const clientId of clientIdsWithData) spend += spendByClientId.get(clientId) ?? 0;
    return { count, costPerResult: count > 0 ? spend / count : null };
  }

  const leads = summarizeGoal("leads");
  const sales = summarizeGoal("sales");

  return {
    investment,
    leadsCount: leads.count,
    leadsCostPerResult: leads.costPerResult,
    salesCount: sales.count,
    salesCostPerResult: sales.costPerResult,
  };
}

export interface SprintOpsSummary {
  emAndamento: number;
  emDia: number;
  atencao: number;
  criticas: number;
  semExecucao: number;
  /** % de tarefas concluídas sobre o total esperado no mês, ou null sem tarefas. */
  taxaExecucao: number | null;
  atrasadas: number;
  paraHoje: number;
}

/**
 * Distribuição em 4 baldes (em dia / atenção / crítica / sem execução) sem
 * inventar uma severidade nova pra sprint: "sem execução" já vem do alerta
 * de execução existente; entre as demais, reaproveita a saúde da conta
 * (accountHealth) já calculada — a mesma que colore o card do cliente.
 */
export function computeSprintOpsSummary(
  cards: OperationClientCard[],
  todayStr: string,
): SprintOpsSummary {
  const withSprint = cards.filter((c) => c.sprint !== null);
  const semExecucao = withSprint.filter((c) => c.sprintFilterBucket === "sem_execucao").length;
  const remaining = withSprint.filter((c) => c.sprintFilterBucket !== "sem_execucao");
  const criticas = remaining.filter((c) => c.accountHealth === "critico").length;
  const atencao = remaining.filter((c) => c.accountHealth === "atencao").length;
  const emDia = remaining.filter((c) => c.accountHealth === "saudavel").length;

  const totalDone = cards.reduce((sum, c) => sum + c.taskCounts.done, 0);
  const totalTasks = cards.reduce((sum, c) => sum + c.taskCounts.total, 0);
  const taxaExecucao = totalTasks > 0 ? (totalDone / totalTasks) * 100 : null;

  const atrasadas = cards.reduce((sum, c) => sum + c.taskCounts.overdue, 0);
  const paraHoje = cards.reduce(
    (sum, c) => sum + c.todayAndOverdueTasks.filter((t) => t.due_date === todayStr).length,
    0,
  );

  return {
    emAndamento: withSprint.length,
    emDia,
    atencao,
    criticas,
    semExecucao,
    taxaExecucao,
    atrasadas,
    paraHoje,
  };
}

export interface ManagerSummaryRow {
  id: string;
  name: string;
  totalClients: number;
  portfolio: PortfolioCounts;
  atrasadas: number;
  paraHoje: number;
  semExecucao: number;
  taxaExecucao: number | null;
}

/** Uma linha por gestor, cada card contado em cada gestor a que está
 * vinculado (many-to-many em client_managers). */
export function computeManagerSummary(
  managers: { id: string; name: string }[],
  cards: OperationClientCard[],
  todayStr: string,
): ManagerSummaryRow[] {
  return managers.map((manager) => {
    const managerCards = cards.filter((c) => c.managerIds.includes(manager.id));
    const sprintOps = computeSprintOpsSummary(managerCards, todayStr);
    return {
      id: manager.id,
      name: manager.name,
      totalClients: managerCards.length,
      portfolio: computePortfolioCounts(managerCards),
      atrasadas: sprintOps.atrasadas,
      paraHoje: sprintOps.paraHoje,
      semExecucao: sprintOps.semExecucao,
      taxaExecucao: sprintOps.taxaExecucao,
    };
  });
}
