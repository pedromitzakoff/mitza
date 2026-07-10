import type { SpendSource } from "./sprint-financials";

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function clampDateString(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

export interface CumulativeSpendPoint {
  date: string;
  plannedCumulative: number;
  /** null pros dias que ainda não chegaram (sem gasto real pra acumular). */
  actualCumulative: number | null;
}

/**
 * Planejado acumulado (o ritmo esperado, espalhado uniformemente pelos dias
 * de cada sprint) x gasto real acumulado, dia a dia, do início ao fim do
 * mês. actualCumulative fica null a partir de amanhã (ainda não temos dado
 * real pra esses dias).
 *
 * Sprints com spend_source "manual" não têm distribuição diária real — o
 * valor manual é um número agregado só. Em vez de inventar uma distribuição
 * ao longo da sprint, o valor inteiro entra de uma vez no dia da última
 * edição manual (manual_spend_updated_at, ou o fim da sprint se esse dado
 * não existir) e permanece acumulado dali em diante. Os dias de daily_spend
 * dentro do período de uma sprint manual são ignorados aqui pra não contar
 * o gasto duas vezes (uma pela sync do Meta, outra pelo valor manual).
 */
export function computeCumulativeSpendSeries(
  sprints: {
    start_date: string;
    end_date: string;
    planned_spend: number;
    spend_source?: SpendSource;
    manual_actual_spend?: number | null;
    manual_spend_updated_at?: string | null;
  }[],
  dailySpend: { date: string; spend: number }[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): CumulativeSpendPoint[] {
  const manualSprints = sprints.filter((s) => s.spend_source === "manual");
  const isInsideManualSprint = (date: string) =>
    manualSprints.some((s) => date >= s.start_date && date <= s.end_date);

  const spendByDate = new Map<string, number>();
  for (const row of dailySpend) {
    if (isInsideManualSprint(row.date)) continue;
    spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + row.spend);
  }

  for (const sprint of manualSprints) {
    const manualValue = sprint.manual_actual_spend ?? 0;
    const anchorRaw = sprint.manual_spend_updated_at
      ? sprint.manual_spend_updated_at.slice(0, 10)
      : sprint.end_date;
    const anchor = clampDateString(anchorRaw, monthRange.firstDay, monthRange.lastDay);
    spendByDate.set(anchor, (spendByDate.get(anchor) ?? 0) + manualValue);
  }

  const dailyPlannedRate = new Map<string, number>();
  for (const sprint of sprints) {
    const start = parseDateUTC(sprint.start_date);
    const end = parseDateUTC(sprint.end_date);
    const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    const rate = totalDays > 0 ? sprint.planned_spend / totalDays : 0;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      dailyPlannedRate.set(toDateString(d), rate);
    }
  }

  const points: CumulativeSpendPoint[] = [];
  let plannedCumulative = 0;
  let actualCumulative = 0;

  const start = parseDateUTC(monthRange.firstDay);
  const end = parseDateUTC(monthRange.lastDay);

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = toDateString(d);
    plannedCumulative += dailyPlannedRate.get(dateStr) ?? 0;

    const isFuture = d > today;
    if (!isFuture) {
      actualCumulative += spendByDate.get(dateStr) ?? 0;
    }

    points.push({
      date: dateStr,
      plannedCumulative,
      actualCumulative: isFuture ? null : actualCumulative,
    });
  }

  return points;
}
