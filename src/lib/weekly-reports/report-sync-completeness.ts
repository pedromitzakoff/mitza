/**
 * Aba "Reports" (pedido, seção 1: "se faltar sincronizar parte do período,
 * exiba o card em Aguardando dados... diferencie ausência de dados de zero
 * resultados confirmado"). Mesmo sinal de "dia sincronizado" usado no resto
 * da plataforma (`buildDailyResultSeries`, `lib/daily-results.ts`): a
 * PRESENÇA de uma linha em `daily_spend` naquele dia, não o valor — um dia
 * com gasto zero mas já sincronizado tem linha (`spend: 0`); um dia ainda
 * não processado não tem linha nenhuma. Reaproveitado aqui, nunca uma 2ª
 * definição de "sincronizado".
 */
export function isPeriodFullySynced(periodDates: readonly string[], syncedDates: ReadonlySet<string>): boolean {
  return periodDates.every((date) => syncedDates.has(date));
}
