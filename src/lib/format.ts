const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const dayMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

export function formatDateRange(startDate: string, endDate: string): string {
  const start = dayMonthFormatter.format(new Date(`${startDate}T00:00:00Z`));
  const end = dayMonthFormatter.format(new Date(`${endDate}T00:00:00Z`));
  return `${start} – ${end}`;
}

const fullDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Data por extenso em pt-BR (ex.: "quinta-feira, 09 de julho de 2026"). */
export function formatFullDate(date: Date): string {
  return fullDateFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}
