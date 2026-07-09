import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";

export interface SprintFinancials {
  sprintId: string;
  startDate: string;
  endDate: string;
  plannedSpend: number;
  actualSpend: number;
  expectedToDate: number;
  status: SpendStatus;
  progressPct: number;
}

function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Calcula o financeiro de uma sprint: gasto esperado até hoje (proporcional
 * aos dias já passados dentro da sprint), status (dentro/acima/abaixo) e %
 * de progresso da barra (gasto / planejado).
 */
export function computeSprintFinancials(
  sprint: { id: string; start_date: string; end_date: string; planned_spend: number },
  actualSpend: number,
  today: Date = new Date(),
): SprintFinancials {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);
  const totalDays = daysBetweenInclusive(start, end);

  const daysPassed =
    today < start ? 0 : today > end ? totalDays : daysBetweenInclusive(start, today);

  const expectedToDate = (sprint.planned_spend * daysPassed) / totalDays;
  const status = classifySpendStatus(actualSpend, expectedToDate);
  const progressPct = sprint.planned_spend > 0 ? (actualSpend / sprint.planned_spend) * 100 : 0;

  return {
    sprintId: sprint.id,
    startDate: sprint.start_date,
    endDate: sprint.end_date,
    plannedSpend: sprint.planned_spend,
    actualSpend,
    expectedToDate,
    status,
    progressPct,
  };
}

/** Intervalo (YYYY-MM-DD) do mês corrente, usado pra filtrar sprints e daily_spend. */
export function currentMonthRange(today = new Date()): { firstDay: string; lastDay: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  return {
    firstDay: firstDay.toISOString().slice(0, 10),
    lastDay: lastDay.toISOString().slice(0, 10),
  };
}
