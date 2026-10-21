/**
 * KOFF Analytics — Etapa 1.8: a fila de triagem da Operação (ordenação,
 * contagem, filtros, baldes de prioridade) foi removida por completo junto
 * com o módulo Operação. O único trecho deste arquivo com um consumidor
 * analítico real — a resolução do intervalo do mês a partir do parâmetro de
 * período — foi preservado abaixo, usado por
 * `lib/client-operational-state-data.ts` (pipeline do Cockpit).
 */

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** `{firstDay, lastDay}` do mês de um parâmetro `YYYY-MM-01`. */
export function monthRangeFromOperationParam(monthParam: string): { firstDay: string; lastDay: string } {
  const [year, month] = monthParam.split("-").map(Number);
  const lastDay = daysInMonth(year, month);
  return { firstDay: monthParam, lastDay: `${monthParam.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}
