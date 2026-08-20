/**
 * Aritmética de data civil (`YYYY-MM-DD`) pro motor de Conquistas — mesma
 * convenção de `lib/today.ts`/`lib/monthly-budget.ts` (meia-noite UTC do
 * dia civil, nunca fuso cru): datas são strings, nunca `Date` cruzando o
 * motor pra fora deste arquivo. Nenhum cálculo de "que dia é hoje" mora
 * aqui — isso continua só em `lib/today.ts`.
 */

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `n` dias antes/depois de `date` (`n` negativo = antes). */
export function addDays(date: string, n: number): string {
  const d = parseDateUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

/** Lista de datas entre `from` e `to`, inclusive, ordem crescente. */
export function listDatesInclusive(from: string, to: string): string[] {
  const start = parseDateUTC(from);
  const end = parseDateUTC(to);
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(toDateString(d));
  }
  return dates;
}

/** "YYYY-MM" de uma data civil. */
export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}

/** Primeiro dia (`YYYY-MM-01`) do mês de uma data civil ou de um "YYYY-MM". */
export function firstDayOfMonth(yearMonthOrDate: string): string {
  return `${yearMonthOrDate.slice(0, 7)}-01`;
}

/** Último dia civil do mês de uma data civil ou de um "YYYY-MM" — calendário
 * correto (28/29/30/31), nunca hardcoded. */
export function lastDayOfMonth(yearMonthOrDate: string): string {
  const first = parseDateUTC(firstDayOfMonth(yearMonthOrDate));
  const nextMonthFirst = new Date(first);
  nextMonthFirst.setUTCMonth(nextMonthFirst.getUTCMonth() + 1);
  nextMonthFirst.setUTCDate(nextMonthFirst.getUTCDate() - 1);
  return toDateString(nextMonthFirst);
}

/** "YYYY-MM" do mês anterior ao informado. */
export function previousYearMonth(yearMonthOrDate: string): string {
  const first = parseDateUTC(firstDayOfMonth(yearMonthOrDate));
  first.setUTCMonth(first.getUTCMonth() - 1);
  return toDateString(first).slice(0, 7);
}

/** `true` quando `date` é o último dia civil do próprio mês — usado pra
 * saber se um mês acabou de fechar (ontem foi o último dia do mês
 * anterior). */
export function isLastDayOfMonth(date: string): boolean {
  return lastDayOfMonth(date) === date;
}

/** Quantidade de dias decorridos do mês de `date`, contando do dia 1 até
 * `date` inclusive (nunca o mês inteiro quando ele ainda está em
 * andamento). */
export function daysElapsedInMonth(date: string): number {
  return listDatesInclusive(firstDayOfMonth(date), date).length;
}

/** Últimos `days` dias civis FECHADOS terminando ontem, a partir de
 * `todayStr` (a data de hoje já resolvida por `lib/today.ts` — este
 * arquivo nunca decide sozinho "que dia é hoje", só faz aritmética a
 * partir do que já foi resolvido). Nunca inclui `todayStr` (hoje ainda
 * está em andamento). Ordem cronológica crescente (mais antigo primeiro),
 * a mesma ordem exigida pelo backfill de Conquistas
 * (`scripts/backfill-achievements.ts`) pra recordes/streaks/milestones
 * progressivos fazerem sentido. */
export function lastNClosedDaysEndingYesterday(days: number, todayStr: string): string[] {
  const yesterday = addDays(todayStr, -1);
  const start = addDays(yesterday, -(days - 1));
  return listDatesInclusive(start, yesterday);
}
