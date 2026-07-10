function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Quantos dias úteis (seg-sex) existem estritamente depois de `from` até
 * `to`, inclusive. Se `from` e `to` são o mesmo dia, retorna 0 — "hoje" não
 * conta como dia útil decorrido. Fins de semana nunca incrementam a
 * contagem, mesmo que estejam dentro do intervalo.
 */
export function businessDaysSince(from: Date, to: Date): number {
  let count = 0;
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor <= end) {
    if (!isWeekend(cursor)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}
