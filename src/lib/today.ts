/**
 * Fuso da agência — não necessariamente o do servidor (a Vercel roda em
 * UTC), mas é o que importa pra decidir em que dia civil estamos.
 */
export const APP_TIMEZONE = "America/Sao_Paulo";

const todayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE });

/** Data de hoje (YYYY-MM-DD) no fuso da agência. */
export function todayDateString(now: Date = new Date()): string {
  return todayFormatter.format(now);
}

/** "Hoje" à meia-noite UTC do dia civil no fuso da agência — comparável
 * diretamente com colunas `date`/`due_date` (sem fuso) do Postgres. */
export function todayUTC(now: Date = new Date()): Date {
  return new Date(`${todayDateString(now)}T00:00:00Z`);
}
