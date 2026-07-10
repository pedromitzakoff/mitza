import type { OperationClientCard } from "@/app/operation/operation-data";
import { computeMonthProjectionForRange, type MonthProjection } from "./client-metrics";
import { formatCurrency } from "./format";

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

export interface FinancialSummary {
  planned: number;
  actual: number;
  /** % realizado sobre o planejado, ou null se ninguém no recorte tem meta. */
  pct: number | null;
  projection: MonthProjection;
  semMeta: number;
}

/**
 * Soma planejado/realizado de TODOS os clientes filtrados (nunca uma média
 * de percentuais por cliente) — assim clientes sem meta (planejado = 0) não
 * distorcem o percentual agregado, só reduzem o denominador corretamente.
 */
export function computeFinancialSummary(
  cards: OperationClientCard[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): FinancialSummary {
  const planned = cards.reduce((sum, c) => sum + c.monthPlanned, 0);
  const actual = cards.reduce((sum, c) => sum + c.monthActual, 0);
  const pct = planned > 0 ? (actual / planned) * 100 : null;
  const projection = computeMonthProjectionForRange(planned, actual, monthRange, today);
  const semMeta = cards.filter((c) => !c.hasMonthGoal).length;
  return { planned, actual, pct, projection, semMeta };
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

/** Texto dinâmico abaixo do gráfico consolidado — sempre a partir do
 * status/projeção já calculados, nunca um texto solto. */
export function buildRitmoSummaryText(financial: FinancialSummary, isFutureMonth: boolean): string {
  if (isFutureMonth) return "Mês futuro — ainda sem dados de investimento.";
  if (financial.planned <= 0) {
    return "Nenhum cliente filtrado tem meta de investimento configurada neste mês.";
  }

  const { projectedSpend, projectedPct, status } = financial.projection;
  const diff = projectedSpend - financial.planned;

  if (status === "dentro") {
    return `No ritmo para atingir ${Math.round(projectedPct ?? 0)}% do investimento planejado.`;
  }
  if (status === "acima") {
    return `Projeção ${formatCurrency(diff)} acima do planejado.`;
  }
  return `Projeção ${formatCurrency(Math.abs(diff))} abaixo do planejado.`;
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
