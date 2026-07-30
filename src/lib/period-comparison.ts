/**
 * Comparação de período — período anterior de mesma duração + variação
 * percentual segura. Deliberadamente um arquivo PRÓPRIO, sem depender de
 * `lib/analytics.ts` — pedido explícito do usuário: essa comparação vai ser
 * usada em vários lugares no futuro (Analytics, Reports, Visão Geral), então
 * nasce como utilitário genérico, nunca uma lógica exclusiva do Hero do
 * Analytics.
 */

export interface PeriodRange {
  start: string;
  end: string;
}

function daysInclusive(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

/** Período imediatamente anterior, com a MESMA duração em dias — ex.: um
 * período de 01/07 a 30/07 (30 dias) compara com 01/06 a 30/06 (30 dias
 * terminando em 30/06, véspera do início do período atual), nunca o mês
 * corrido anterior por padrão (a duração real do período atual é que manda,
 * inclusive pra presets "últimos 7 dias"/"últimos 30 dias"/personalizado). */
export function previousEquivalentPeriod(period: PeriodRange): PeriodRange {
  const durationDays = daysInclusive(period.start, period.end);

  const previousEnd = new Date(`${period.start}T00:00:00Z`);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);

  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - (durationDays - 1));

  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

/** Variação percentual de `current` em relação a `previous` — `null` sempre
 * que não há uma base anterior confiável pra comparar (`previous` ausente,
 * zero ou negativo): nunca `Infinity`, nunca uma variação fabricada a partir
 * de uma base que não existe. Positivo = cresceu; negativo = caiu. */
export function computePercentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
