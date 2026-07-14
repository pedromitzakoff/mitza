import type { OperationClientCard } from "@/app/operation/operation-data";

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
 * (já classificado por classifySpendStatus, mesma margem ±10% de sempre)
 * sem inventar threshold novo. "sem_meta" entra só no total. */
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
  actual: number;
  /** % realizado sobre o planejado, ou null se ninguém no recorte tem meta. */
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
 * Etapa 68, seção 14: cliente sem orçamento mensal vigente (`!hasMonthGoal`)
 * nunca entra nestas somas — nem no planejado (já contribuiria 0), nem no
 * REALIZADO consolidado, nem no esperado, nem no % realizado. Sem esse
 * filtro, um cliente sem meta configurada mas com gasto real já sincronizado
 * (a conta de anúncios continua rodando mesmo sem orçamento definido no
 * sistema) infla o "Realizado" consolidado sem nenhuma base de comparação —
 * exatamente o cenário que a seção 14 pede pra excluir. `semMeta` continua
 * contando esses clientes à parte, nunca escondidos, só fora da agregação de
 * ritmo.
 */
export function computeFinancialSummary(cards: OperationClientCard[]): FinancialSummary {
  const withGoal = cards.filter((c) => c.hasMonthGoal);
  const planned = withGoal.reduce((sum, c) => sum + c.monthPlanned, 0);
  const actual = withGoal.reduce((sum, c) => sum + c.monthActual, 0);
  const pct = planned > 0 ? (actual / planned) * 100 : null;
  const expectedToDate = withGoal.reduce((sum, c) => sum + c.monthExpectedToDate, 0);
  const semMeta = cards.filter((c) => !c.hasMonthGoal).length;
  return { planned, actual, pct, expectedToDate, semMeta };
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
