import { APP_TIMEZONE } from "./today";

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

/** Data curta (DD/MM), pra colunas densas de tabela. */
export function formatShortDate(value: string): string {
  return dayMonthFormatter.format(new Date(`${value}T00:00:00Z`));
}

const weekdayLongFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const weekdayShortFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const dayMonthLongFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Dia da semana + data (DD/MM), em duas variantes — longa ("Segunda-feira
 * · 13/07") pra telas maiores e curta ("Seg · 13/07") pra telas pequenas.
 * Reutilizada em qualquer lugar que mostre uma data operacional (prazo de
 * tarefa, datas da sprint etc.), pra nunca hardcodar dia da semana.
 */
export function formatWeekdayAndDate(value: string): { long: string; short: string } {
  const date = new Date(`${value}T00:00:00Z`);
  const dayMonth = dayMonthFormatter.format(date);
  const weekdayLong = capitalize(weekdayLongFormatter.format(date));
  const weekdayShort = capitalize(weekdayShortFormatter.format(date).replace(/\.$/, ""));

  return {
    long: `${weekdayLong} · ${dayMonth}`,
    short: `${weekdayShort} · ${dayMonth}`,
  };
}

/** Dia da semana + dia/mês por extenso, sem ano (ex.: "Quinta-feira · 09 de
 * julho") — usado no bloco de destaque de "hoje" dentro da sprint atual. */
export function formatWeekdayAndDayMonth(date: Date): string {
  const weekday = capitalize(weekdayLongFormatter.format(date));
  const dayMonth = dayMonthLongFormatter.format(date);
  return `${weekday} · ${dayMonth}`;
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

const monthYearFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Rótulo do mês selecionado no dashboard da agência (ex.: "Julho de 2026"). */
export function formatMonthLabel(firstDayOfMonth: string): string {
  const [month, year] = monthYearFormatter.format(new Date(`${firstDayOfMonth}T00:00:00Z`)).split(" de ");
  return `${capitalize(month)} de ${year}`;
}

const agencyWeekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: APP_TIMEZONE });
const agencyDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});
const agencyTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

/**
 * Dia da semana + data + horário no fuso da agência — ao contrário das
 * outras funções deste arquivo (que formatam datas civis já corretas com
 * timeZone "UTC"), esta recebe um instante real (`new Date()`) e por isso
 * converte de verdade pro fuso America/Sao_Paulo. Usada na Top Bar global.
 */
export function formatAgencyDateTime(date: Date): { weekday: string; date: string; time: string } {
  return {
    weekday: capitalize(agencyWeekdayFormatter.format(date)),
    date: agencyDateFormatter.format(date),
    time: agencyTimeFormatter.format(date),
  };
}
