function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function listDatesInclusive(firstDay: string, lastDay: string): string[] {
  const start = parseDateUTC(firstDay);
  const end = parseDateUTC(lastDay);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(toDateString(d));
  }
  return dates;
}

/** Distribui um total (em centavos) igualmente entre `count` posições,
 * jogando a sobra do arredondamento na última — mesma convenção usada em
 * spend-chart-data.ts pro gasto manual, aqui reaplicada pro planejado. */
function distributeCentsEqually(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? baseCents + remainderCents : baseCents,
  );
}

export interface MonthlyBudgetSprintInput {
  sprintId: string;
  startDate: string;
  endDate: string;
}

export type MonthlyBudgetScenario = "aumento" | "reducao_normal" | "reducao_abaixo_consolidado";

export interface MonthlyBudgetRedistributionInput {
  /** Todas as sprints do cliente que caem no mês em questão, ordenadas por start_date. */
  sprints: MonthlyBudgetSprintInput[];
  /** Alocação diária vigente (R$) pra cada dia do mês — vem do backfill ou de uma alteração anterior. */
  currentAllocations: Map<string, number>;
  monthRange: { firstDay: string; lastDay: string };
  /** Data de referência (hoje, no fuso da agência) usada como corte consolidado/futuro.
   * Para meses futuros (sem período consolidado), passar uma data anterior ao início do mês. */
  effectiveDate: string;
  newBudget: number;
}

export interface MonthlyBudgetSprintPreview {
  sprintId: string;
  previousPlannedSpend: number;
  newPlannedSpend: number;
}

export interface MonthlyBudgetRedistributionResult {
  effectiveDate: string;
  previousMonthlyTotal: number;
  consolidatedAmount: number;
  previousFutureAmount: number;
  futureBudgetAvailable: number;
  resultingTotal: number;
  isBelowConsolidated: boolean;
  scenario: MonthlyBudgetScenario;
  /** Alocação diária (R$) resultante pra todo o mês — dias <= effectiveDate ficam
   * idênticos aos de currentAllocations; só dias futuros mudam. */
  allocationsByDate: Map<string, number>;
  sprintPreviews: MonthlyBudgetSprintPreview[];
}

/**
 * Calcula a redistribuição do orçamento mensal entre as sprints do mês: a
 * parte já consolidada (dias <= effectiveDate) nunca muda; só o saldo futuro
 * é recalculado, distribuído em centavos exatos igualmente entre os dias
 * futuros do mês (sobra no último dia futuro). Se o novo orçamento for menor
 * que o já consolidado, o futuro vira zero e o total do mês fica acima do
 * novo orçamento (excedente histórico) — não é bloqueado, só sinalizado.
 * Função pura: não lê nem escreve no banco, só decide os números.
 */
export function computeMonthlyBudgetRedistribution(
  input: MonthlyBudgetRedistributionInput,
): MonthlyBudgetRedistributionResult {
  const { sprints, currentAllocations, monthRange, effectiveDate, newBudget } = input;
  const allDates = listDatesInclusive(monthRange.firstDay, monthRange.lastDay);

  const consolidatedDates = allDates.filter((date) => date <= effectiveDate);
  const futureDates = allDates.filter((date) => date > effectiveDate);

  const sumAllocations = (dates: string[]) =>
    dates.reduce((sum, date) => sum + (currentAllocations.get(date) ?? 0), 0);

  const previousMonthlyTotal = sumAllocations(allDates);
  const consolidatedAmount = sumAllocations(consolidatedDates);
  const previousFutureAmount = sumAllocations(futureDates);

  const futureBudgetAvailableRaw = newBudget - consolidatedAmount;
  const isBelowConsolidated = futureBudgetAvailableRaw < 0;
  const futureBudgetAvailable = isBelowConsolidated ? 0 : futureBudgetAvailableRaw;

  const allocationsByDate = new Map<string, number>();
  for (const date of consolidatedDates) {
    allocationsByDate.set(date, currentAllocations.get(date) ?? 0);
  }

  const futureCents = Math.round(futureBudgetAvailable * 100);
  const perDayCents = distributeCentsEqually(futureCents, futureDates.length);
  futureDates.forEach((date, index) => {
    allocationsByDate.set(date, (perDayCents[index] ?? 0) / 100);
  });

  const resultingTotal = consolidatedAmount + futureBudgetAvailable;

  const scenario: MonthlyBudgetScenario = isBelowConsolidated
    ? "reducao_abaixo_consolidado"
    : newBudget >= previousMonthlyTotal
      ? "aumento"
      : "reducao_normal";

  const sprintPreviews: MonthlyBudgetSprintPreview[] = sprints.map((sprint) => {
    const sprintDates = allDates.filter((date) => date >= sprint.startDate && date <= sprint.endDate);
    return {
      sprintId: sprint.sprintId,
      previousPlannedSpend: sumAllocations(sprintDates),
      newPlannedSpend: sprintDates.reduce((sum, date) => sum + (allocationsByDate.get(date) ?? 0), 0),
    };
  });

  return {
    effectiveDate,
    previousMonthlyTotal,
    consolidatedAmount,
    previousFutureAmount,
    futureBudgetAvailable,
    resultingTotal,
    isBelowConsolidated,
    scenario,
    allocationsByDate,
    sprintPreviews,
  };
}

function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

export const CLOSED_MONTH_MESSAGE = "Mês encerrado. O orçamento histórico não pode ser alterado por este fluxo.";

/**
 * Data de efeito (corte consolidado/futuro) pra uma alteração de orçamento:
 * hoje, no fuso da agência, quando o mês editado é o corrente; um dia antes
 * do primeiro dia do mês quando é um mês futuro (assim o consolidado já sai
 * zero, sem precisar de caso especial na redistribuição); mês já encerrado
 * (último dia < hoje) não tem data de efeito — bloqueado por este fluxo.
 */
export function resolveBudgetEffectiveDate(
  monthRange: { firstDay: string; lastDay: string },
  todayStr: string,
): { effectiveDate: string | null; isClosedMonth: boolean } {
  if (monthRange.lastDay < todayStr) {
    return { effectiveDate: null, isClosedMonth: true };
  }
  if (monthRange.firstDay > todayStr) {
    return { effectiveDate: addDays(monthRange.firstDay, -1), isClosedMonth: false };
  }
  return { effectiveDate: todayStr, isClosedMonth: false };
}

/**
 * Gera a alocação diária de backfill pra uma sprint existente que ainda não
 * tem `sprint_planned_allocations`: distribui o `planned_spend` atual dela
 * igualmente entre os dias do período, em centavos exatos (sobra no último
 * dia) — reconstrução técnica, nunca cria histórico de alteração e nunca
 * muda o total da sprint.
 */
export function computeSprintAllocationBackfill(sprint: {
  startDate: string;
  endDate: string;
  plannedSpend: number;
}): { date: string; amount: number }[] {
  const dates = listDatesInclusive(sprint.startDate, sprint.endDate);
  const totalCents = Math.round(sprint.plannedSpend * 100);
  const perDayCents = distributeCentsEqually(totalCents, dates.length);
  return dates.map((date, index) => ({ date, amount: (perDayCents[index] ?? 0) / 100 }));
}
