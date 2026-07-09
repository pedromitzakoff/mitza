function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface CumulativeSpendPoint {
  date: string;
  plannedCumulative: number;
  /** null pros dias que ainda não chegaram (sem gasto real pra acumular). */
  actualCumulative: number | null;
}

/**
 * Planejado acumulado (o ritmo esperado, espalhado uniformemente pelos dias
 * de cada sprint) x gasto real acumulado (soma de daily_spend), dia a dia,
 * do início ao fim do mês. actualCumulative fica null a partir de amanhã
 * (ainda não temos dado real pra esses dias).
 */
export function computeCumulativeSpendSeries(
  sprints: { start_date: string; end_date: string; planned_spend: number }[],
  dailySpend: { date: string; spend: number }[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): CumulativeSpendPoint[] {
  const spendByDate = new Map<string, number>();
  for (const row of dailySpend) {
    spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + row.spend);
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
