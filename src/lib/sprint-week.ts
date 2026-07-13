/**
 * Etapa 50: sprint operacional = semana real do calendário (segunda a
 * domingo) — nunca mais um bloco fixo de dias do mês (1-7, 8-14...). Uma
 * sprint nunca atravessa a fronteira do mês: quando a semana cruzaria a
 * virada, ela é cortada no último dia do mês e uma nova sprint começa no
 * dia 1 do mês seguinte (regra única em `compute_month_sprint_periods`,
 * gerada por `ensure_client_sprints` — ver
 * supabase/sprint-calendar-reconciliation.sql).
 */

function parseDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

const shortMonthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function shortMonth(date: Date): string {
  return shortMonthFormatter.format(date).replace(/\.$/, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Rótulo de período de uma sprint — identidade principal em toda a
 * interface, no lugar de "Sprint N": "13–19 jul" no caso comum (semana
 * inteira dentro de um mês), "27–31 jul" quando ela foi cortada no fim do
 * mês (mais curta que 7 dias, mas ainda dentro de um mês só). O formato
 * nunca mostra o ano, mesma convenção usada nos exemplos do pedido.
 */
export function formatSprintPeriodLabel(startDate: string, endDate: string): string {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  const startDay = pad2(start.getUTCDate());
  const endDay = pad2(end.getUTCDate());
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();

  if (sameMonth) {
    return `${startDay}–${endDay} ${shortMonth(end)}`;
  }
  return `${startDay} ${shortMonth(start)} – ${endDay} ${shortMonth(end)}`;
}
