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

const dayMonthYearFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** Data completa (DD/MM/AAAA) — usada onde o ano importa (ex.: início de
 * contrato em Configurações > Clientes), diferente de `formatShortDate`. */
export function formatDateWithYear(value: string): string {
  return dayMonthYearFormatter.format(new Date(`${value}T00:00:00Z`));
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
 * Data + dia da semana em 3 letras maiúsculas, sempre no mesmo formato em
 * qualquer largura de tela (ex.: "07/07 · TER") — largura previsível, pra
 * manter as datas alinhadas verticalmente numa lista de tarefas. Etapa 52:
 * substitui o formato anterior por extenso ("Terça-feira · 07/07"), que
 * ocupava espaço desproporcional numa linha densa de tarefa.
 */
export function formatCompactTaskDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const dayMonth = dayMonthFormatter.format(date);
  const weekday = weekdayShortFormatter.format(date).replace(/\.$/, "").toUpperCase();
  return `${dayMonth} · ${weekday}`;
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

const dateTimeWithYearFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Data + hora com ano, no formato "13/07/2026 às 14:32" — usado onde o
 * momento precisa ficar registrado de forma inequívoca fora do contexto do
 * mês corrente (ex.: "Enviada em ... por ..." da Atualização para o
 * Cliente), diferente de `formatDateTime` (sem ano, pra listas do mês). */
export function formatDateTimeWithYear(value: string): string {
  const parts = dateTimeWithYearFormatter.formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
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

/**
 * Tempo de relacionamento com a agência a partir de `contract_start_date`
 * (data civil, sem hora — por isso parseada como UTC, igual ao resto deste
 * arquivo). Anos/meses calculados de calendário (não dias/30), pra "12/06"
 * até "12/07" dar exatamente "1 mês", não uma aproximação. Nunca mostra
 * "0 meses": abaixo de um mês vira contagem em dias.
 */
export function formatRelationshipDuration(contractStartDate: string | null, today: Date): string {
  if (!contractStartDate) return "Início não configurado";

  const start = new Date(`${contractStartDate}T00:00:00Z`);
  if (start > today) return "Início não configurado";

  let years = today.getUTCFullYear() - start.getUTCFullYear();
  let months = today.getUTCMonth() - start.getUTCMonth();
  let days = today.getUTCDate() - start.getUTCDate();

  if (days < 0) {
    months -= 1;
    const lastDayOfPrevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
    days += lastDayOfPrevMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years === 0 && months === 0) {
    const totalDays = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
    return `Cliente há ${totalDays} dia${totalDays !== 1 ? "s" : ""}`;
  }
  if (years === 0) {
    return `Cliente há ${months} ${months === 1 ? "mês" : "meses"}`;
  }
  if (months === 0) {
    return `Cliente há ${years} ${years === 1 ? "ano" : "anos"}`;
  }
  return `Cliente há ${years} ${years === 1 ? "ano" : "anos"} e ${months} ${months === 1 ? "mês" : "meses"}`;
}

/**
 * "Tempo ativo" da tabela de Configurações > Clientes — sempre em meses
 * completos (nunca dobra pra anos, ao contrário de `formatRelationshipDuration`
 * acima), pra ficar compacto numa coluna de tabela. Meses de calendário, não
 * dias/30 — reaproveita o mesmo cálculo de mês completo da função acima, só
 * sem o desdobramento em anos. Data de início no futuro (ou ausente) vira
 * "—", nunca um número negativo.
 */
export function formatActiveMonths(contractStartDate: string | null, today: Date): string {
  if (!contractStartDate) return "—";

  const start = new Date(`${contractStartDate}T00:00:00Z`);
  if (start > today) return "—";

  let months = (today.getUTCFullYear() - start.getUTCFullYear()) * 12 + (today.getUTCMonth() - start.getUTCMonth());
  if (today.getUTCDate() < start.getUTCDate()) {
    months -= 1;
  }

  if (months <= 0) return "< 1 mês";
  return `${months} ${months === 1 ? "mês" : "meses"}`;
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
