/**
 * Etapa 50: sprint operacional = semana real do calendário (segunda a
 * domingo), podendo atravessar mês/ano — nunca mais um bloco fixo de dias
 * do mês (1-7, 8-14...). Este arquivo centraliza tudo que depende só de
 * datas (não de dinheiro): limites da semana, rótulo de período e
 * interseção genérica entre dois intervalos de data. Cálculo financeiro
 * (planejado/realizado/status por período) fica em sprint-financials.ts,
 * que usa as funções daqui.
 */

const DAY_MS = 86_400_000;

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateString(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** 1 (segunda) .. 7 (domingo), igual ISO — `Date.getUTCDay()` usa 0=domingo. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Limites (segunda a domingo) da semana operacional que contém `date`. */
export function getOperationalWeekBounds(date: Date): { startDate: string; endDate: string } {
  const monday = new Date(date.getTime() - (isoWeekday(date) - 1) * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return { startDate: toDateString(monday), endDate: toDateString(sunday) };
}

const shortMonthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function shortMonth(date: Date): string {
  return shortMonthFormatter.format(date).replace(/\.$/, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Rótulo de período de uma sprint/semana — identidade principal em toda a
 * interface, no lugar de "Sprint N": "13–19 jul" quando cabe no mesmo mês,
 * "27 jul – 02 ago" quando atravessa mês (ou ano — o rótulo nunca mostra o
 * ano, mesma convenção usada nos exemplos do pedido).
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

/** Interseção entre dois intervalos de data [aStart,aEnd] e [bStart,bEnd]
 * (strings YYYY-MM-DD, inclusivas) — null se não há sobreposição. Usada pra
 * "quantos dias da sprint caem neste mês", entre outros. */
export function intersectDateRanges(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): { start: string; end: string } | null {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (start > end) return null;
  return { start, end };
}

/** true se [aStart,aEnd] sobrepõe [bStart,bEnd] (inclusivo dos dois lados). */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/** true se a sprint atravessa a fronteira de um mês (start/end em meses
 * civis diferentes) — usado pra decidir se a UI precisa do campo de gasto
 * manual dividido por mês, ou se basta o campo único de sempre. */
export function sprintCrossesMonthBoundary(startDate: string, endDate: string): boolean {
  return startDate.slice(0, 7) !== endDate.slice(0, 7);
}

/** Primeiro dia do mês civil (YYYY-MM-01) de uma data YYYY-MM-DD — mesma
 * convenção de "month_start" usada em sprint_manual_spend_by_month e
 * monthly_reports. */
export function monthStartOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}
