import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { todayUTC } from "@/lib/today";

export type SprintTemporalStatus = "futura" | "atual" | "concluida";

/** Origem do gasto real de uma sprint: "meta_api" é o padrão (soma de
 * daily_spend, como sempre foi); "manual" é um valor digitado à mão
 * enquanto a sync do Meta não é a fonte de teste. */
export type SpendSource = "manual" | "meta_api";

export interface SprintFinancials {
  sprintId: string;
  startDate: string;
  endDate: string;
  plannedSpend: number;
  actualSpend: number;
  expectedToDate: number;
  status: SpendStatus;
  progressPct: number;
  temporalStatus: SprintTemporalStatus;
  spendSource: SpendSource;
}

/**
 * Decide qual valor de gasto real vale pra uma sprint: se a origem
 * configurada é "manual" e existe um valor manual salvo, esse valor manda —
 * a sync do Meta continua rodando e gravando em daily_spend normalmente,
 * mas essa função é o único lugar que decide se ela deve "aparecer" ou não.
 * Fora daqui (Sprints, Visão Geral, /clients), nada muda: essas telas nunca
 * chamam esta função e continuam com a soma de daily_spend de sempre.
 */
export function resolveSprintActualSpend(
  sprint: { spend_source: SpendSource; manual_actual_spend: number | null },
  metaSpendSum: number,
): number {
  if (sprint.spend_source === "manual" && sprint.manual_actual_spend !== null) {
    return sprint.manual_actual_spend;
  }
  return metaSpendSum;
}

/** Fonte única do gasto real de UMA sprint: soma o daily_spend do período
 * dela e resolve manual x meta_api. Todo lugar que precisa do gasto real de
 * uma sprint (mensal consolidado, cartão da sprint, gráfico) passa por
 * aqui — nunca duplica o filtro+soma de daily_spend por conta própria. */
export function computeSprintEffectiveSpend(
  sprint: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  },
  dailySpend: { date: string; spend: number }[],
): number {
  const metaSpendSum = dailySpend
    .filter((d) => d.date >= sprint.start_date && d.date <= sprint.end_date)
    .reduce((sum, d) => sum + d.spend, 0);
  return resolveSprintActualSpend(sprint, metaSpendSum);
}

/** Soma o gasto real efetivo de várias sprints — usado pra consolidar o
 * gasto realizado do mês (soma do effective_spend de cada sprint do mês,
 * nunca a soma direta de daily_spend). */
export function sumEffectiveSpend(
  sprints: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[],
  dailySpend: { date: string; spend: number }[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintEffectiveSpend(sprint, dailySpend), 0);
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
  today: Date = todayUTC(),
  spendSource: SpendSource = "meta_api",
): SprintFinancials {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);
  const totalDays = daysBetweenInclusive(start, end);

  const daysPassed =
    today < start ? 0 : today > end ? totalDays : daysBetweenInclusive(start, today);

  const expectedToDate = (sprint.planned_spend * daysPassed) / totalDays;
  const status = classifySpendStatus(actualSpend, expectedToDate, sprint.planned_spend);
  const progressPct = sprint.planned_spend > 0 ? (actualSpend / sprint.planned_spend) * 100 : 0;
  const temporalStatus: SprintTemporalStatus =
    today < start ? "futura" : today > end ? "concluida" : "atual";

  return {
    sprintId: sprint.id,
    startDate: sprint.start_date,
    endDate: sprint.end_date,
    plannedSpend: sprint.planned_spend,
    actualSpend,
    expectedToDate,
    status,
    progressPct,
    temporalStatus,
    spendSource,
  };
}

/** Intervalo (YYYY-MM-DD) do mês corrente, usado pra filtrar sprints e daily_spend. */
export function currentMonthRange(today: Date = todayUTC()): { firstDay: string; lastDay: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  return {
    firstDay: firstDay.toISOString().slice(0, 10),
    lastDay: lastDay.toISOString().slice(0, 10),
  };
}

/** Lê o mês selecionado (`?month=YYYY-MM`) da URL, ou usa o mês corrente se
 * ausente/inválido — mesmo parsing reutilizado por Operação e pela Visão
 * Geral, pra nunca duplicar essa regra. */
export function monthRangeFromParam(
  monthParam: string | undefined,
  today: Date = todayUTC(),
): { firstDay: string; lastDay: string } {
  if (monthParam) {
    const [yearStr, monthStr] = monthParam.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
      const firstDay = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(year, month + 1, 0));
      return { firstDay: firstDay.toISOString().slice(0, 10), lastDay: lastDay.toISOString().slice(0, 10) };
    }
  }
  return currentMonthRange(today);
}
