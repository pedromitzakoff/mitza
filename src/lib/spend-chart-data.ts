import { daysBetweenInclusive, type SpendSource } from "./sprint-financials";

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
 * Planejado acumulado x gasto real acumulado, dia a dia, do início ao fim do
 * mês. actualCumulative fica null a partir de amanhã (ainda não temos dado
 * real pra esses dias).
 *
 * O planejado vem direto de `sprint_planned_allocations` (Etapa 38) — dia a
 * dia, não mais uma taxa fixa por sprint. É isso que garante que o gráfico
 * preserva a história: dias já consolidados (passado) nunca mudam depois de
 * uma alteração de orçamento, só os dias futuros à data de efeito é que
 * refletem a redistribuição nova. `plannedByDate` sem entrada pra um dia
 * conta como R$ 0 planejado nesse dia (sprint sem orçamento configurado).
 *
 * Sprints com spend_source "manual" não têm distribuição diária real — o
 * valor manual é um número agregado só. O valor é distribuído igualmente
 * entre os dias já decorridos da sprint (start_date até min(hoje,
 * end_date) — sprint em andamento só distribui até hoje; sprint encerrada
 * distribui por todo o período), nunca pela data em que o usuário editou o
 * valor: reeditar um gasto de uma sprint passada recalcula a distribuição
 * inteira sobre as datas originais da sprint, não cria gasto na data da
 * edição. Eventual sobra de centavos do arredondamento vai pro último dia
 * decorrido, garantindo que a soma bata exatamente com o valor informado.
 * Os dias de daily_spend dentro do período de uma sprint manual são
 * ignorados aqui pra não contar o gasto duas vezes (uma pela sync do Meta,
 * outra pelo valor manual).
 */
export function computeCumulativeSpendSeries(
  sprints: {
    start_date: string;
    end_date: string;
    spend_source?: SpendSource;
    manual_actual_spend?: number | null;
  }[],
  dailySpend: { date: string; spend: number }[],
  dailyPlanned: { date: string; planned_amount: number }[],
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
    const start = parseDateUTC(sprint.start_date);
    const end = parseDateUTC(sprint.end_date);
    const effectiveEnd = today < end ? today : end;

    if (effectiveEnd < start) continue; // sprint futura: nada decorrido ainda

    const elapsedDays = daysBetweenInclusive(start, effectiveEnd);
    const totalCents = Math.round(manualValue * 100);
    const baseCents = Math.floor(totalCents / elapsedDays);
    const remainderCents = totalCents - baseCents * elapsedDays;

    let dayIndex = 0;
    for (let d = new Date(start); d <= effectiveEnd; d.setUTCDate(d.getUTCDate() + 1), dayIndex++) {
      const dateStr = toDateString(d);
      const isLastElapsedDay = dayIndex === elapsedDays - 1;
      const dayCents = baseCents + (isLastElapsedDay ? remainderCents : 0);
      spendByDate.set(dateStr, (spendByDate.get(dateStr) ?? 0) + dayCents / 100);
    }
  }

  const plannedByDate = new Map<string, number>();
  for (const row of dailyPlanned) {
    plannedByDate.set(row.date, (plannedByDate.get(row.date) ?? 0) + row.planned_amount);
  }

  const points: CumulativeSpendPoint[] = [];
  let plannedCumulative = 0;
  let actualCumulative = 0;

  const start = parseDateUTC(monthRange.firstDay);
  const end = parseDateUTC(monthRange.lastDay);

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = toDateString(d);
    plannedCumulative += plannedByDate.get(dateStr) ?? 0;

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
