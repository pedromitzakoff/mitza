import { daysBetweenInclusive, type ManualSpendByMonthRow, type SpendSource } from "./sprint-financials";
import { sprintCrossesMonthBoundary } from "./sprint-week";

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
 *
 * Etapa 50: sprint manual que atravessa a fronteira do mês distribui só a
 * PARCELA daquele mês (`manualSpendByMonth`) pelos dias daquele mês — nunca
 * mais o total bruto da sprint inteira pelos dias das duas meses juntos
 * (isso inflaria o mês errado). Sprint manual que não atravessa mês
 * continua exatamente como sempre: `manual_actual_spend` inteiro pelos dias
 * dela, já que ela é inteiramente deste mês.
 */
export function computeCumulativeSpendSeries(
  sprints: {
    id: string;
    start_date: string;
    end_date: string;
    spend_source?: SpendSource;
    manual_actual_spend?: number | null;
  }[],
  dailySpend: { date: string; spend: number }[],
  dailyPlanned: { date: string; planned_amount: number }[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
  manualSpendByMonth: ManualSpendByMonthRow[] = [],
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
    const crossesMonth = sprintCrossesMonthBoundary(sprint.start_date, sprint.end_date);
    const manualValue = crossesMonth
      ? (manualSpendByMonth.find(
          (m) => m.sprintId === sprint.id && m.monthStart === `${monthRange.firstDay.slice(0, 7)}-01`,
        )?.amount ?? 0)
      : (sprint.manual_actual_spend ?? 0);

    // Sprint que atravessa mês: distribui só pelos dias que caem NESTE mês
    // (interseção sprint×mês); sprint de um mês só: pelos dias dela inteira.
    const rangeStart = crossesMonth
      ? sprint.start_date > monthRange.firstDay
        ? sprint.start_date
        : monthRange.firstDay
      : sprint.start_date;
    const rangeEnd = crossesMonth
      ? sprint.end_date < monthRange.lastDay
        ? sprint.end_date
        : monthRange.lastDay
      : sprint.end_date;

    const start = parseDateUTC(rangeStart);
    const end = parseDateUTC(rangeEnd);
    const effectiveEnd = today < end ? today : end;

    if (effectiveEnd < start) continue; // sprint (ou sua parcela do mês) futura: nada decorrido ainda

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
