import { APP_TIMEZONE, todayDateString } from "./today";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Percentual com 2 casas decimais (ex.: "45,16%") — Etapa 68: o "% esperado
 * hoje" e o "% realizado" precisam de precisão decimal (o avanço de
 * calendário quase nunca cai num número redondo — dia 15 de 31 é 48,39%,
 * não 48%), diferente de outros percentuais do sistema que continuam
 * arredondados pro inteiro mais próximo (`Math.round`). `value` já em escala
 * 0–100 (não uma fração 0–1). */
export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`;
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

const dayShortMonthFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Dia + mês abreviado, sem ano, sem ponto (ex.: "21 ago") — mesmo padrão
 * de `formatSprintPeriodLabel` (lib/sprint-week.ts), extraído aqui pra ser
 * reaproveitado por qualquer tela (Etapa "Horizonte de Planejamento": rótulo
 * "Período de planejamento"/badge "Evento · até 21 ago"). */
export function formatDayShortMonth(value: string): string {
  return dayShortMonthFormatter.format(new Date(`${value}T00:00:00Z`)).replace(/\.$/, "");
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

/** Dia/mês por extenso, sem dia da semana e sem ano (ex.: "08 de agosto") —
 * usado no módulo de Pendências (prazo futuro/passado, fora de hoje). */
export function formatDayMonthLong(value: string): string {
  return dayMonthLongFormatter.format(new Date(`${value}T00:00:00Z`));
}

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

/** BUG CORRIGIDO (revisão de horários): faltava `timeZone` aqui — sem ele, o
 * Intl.DateTimeFormat usa o fuso do processo Node.js (UTC na Vercel), não o
 * fuso do usuário, fazendo qualquer timestamptz exibido por `formatDateTime`
 * aparecer com o horário errado (ex.: um evento às 11:00 BRT virava 14:00 na
 * tela). Mesmo bug que `timeOnlyFormatter`, abaixo, já corrigia — só não
 * tinha sido replicado aqui. `APP_TIMEZONE` é o único fuso usado em toda a
 * plataforma (todos os usuários são Brasil hoje). */
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

/** Data + hora no fuso do usuário (`APP_TIMEZONE`) — função utilitária única
 * pra qualquer timestamptz exibido com hora (Reports, Timeline, Otimizações,
 * Execuções recorrentes etc.). Nunca formatar hora manualmente fora daqui. */
export function formatDateTime(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/** Sem `timeZone` explícito, o Intl.DateTimeFormat usa o fuso do ambiente
 * de execução — em Server Components isso é o fuso do processo Node.js
 * (UTC na Vercel), não o do usuário, o que exibia horários 3h adiantados
 * em relação ao fuso da agência. `APP_TIMEZONE` é o mesmo token já usado
 * pelos outros formatters de hora deste arquivo. */
const timeOnlyFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIMEZONE });

/** Só o horário ("15:55"), no fuso da agência, a partir de um INSTANTE real
 * (timestamptz) — usado quando o dia civil já é mostrado separadamente por
 * outro campo (ex.: "dados até 17/08" + "capturados às 15:55" da última
 * captura de `daily_spend`) e repetir a data também no horário seria
 * redundante. */
export function formatTimeOnly(value: string): string {
  return timeOnlyFormatter.format(new Date(value));
}

/** Diferença em dias civis no fuso da agência (`APP_TIMEZONE`) entre `value`
 * e `today` — nunca `getUTCFullYear/Month/Date()` direto num timestamptz
 * (achado real: um sync às 17:37 no fuso da agência, entre 21h e 23h59
 * UTC-3... na verdade qualquer horário da noite BRT vira o dia seguinte em
 * UTC, fazendo "hoje" aparecer como "ontem" — `date.getUTCDate()` lia o dia
 * civil em UTC, não no fuso da agência). `todayDateString` converte os dois
 * lados (eventos e a referência "hoje") pro mesmo dia civil antes de
 * comparar, então funciona corretamente não importa a hora do dia nem se
 * quem chama passou `todayUTC()` ou um `new Date()` cru. */
function diffCalendarDaysInAppTimezone(value: string, today: Date): number {
  const eventDay = todayDateString(new Date(value));
  const referenceDay = todayDateString(today);
  return Math.round((Date.parse(`${referenceDay}T00:00:00Z`) - Date.parse(`${eventDay}T00:00:00Z`)) / 86_400_000);
}

/** "Hoje, 14:03" / "Ontem, 09:10" / "12/07, 09:10" — reaproveita a mesma
 * regra de dia relativo de `formatLastOptimizationLabel` (monthly-reports.ts),
 * só que com o horário junto (Etapa 62, seção 3 do pedido: "Última análise"
 * precisa mostrar hora quando relevante, não só o dia).
 *
 * IMPORTANTE (bug real já encontrado em produção): `today` precisa ser um
 * INSTANTE real — sempre `new Date()`, NUNCA `todayUTC()` (`lib/today.ts`).
 * `todayUTC()` já é meia-noite civil truncada pelo fuso; `today` aqui passa
 * de novo por `todayDateString`/`APP_TIMEZONE` dentro de
 * `diffCalendarDaysInAppTimezone` — passar `todayUTC()` reconverte um valor
 * já convertido, empurra a referência um dia pra trás, e faz uma
 * sincronização de ONTEM aparecer rotulada como "Hoje" (parecendo, inclusive,
 * estar no futuro em relação ao horário real). */
export function formatRelativeDateTime(value: string, today: Date): string {
  const date = new Date(value);
  const diffDays = diffCalendarDaysInAppTimezone(value, today);
  const time = timeOnlyFormatter.format(date);
  if (diffDays <= 0) return `Hoje, ${time}`;
  if (diffDays === 1) return `Ontem, ${time}`;
  if (diffDays < 7) return `Há ${diffDays} dias, ${time}`;
  return `${formatDateTime(value)}`;
}

/** "Hoje, 14:03" / "Ontem, 09:10" / "12/07 às 09:10" — mesma regra de dia
 * relativo de `formatRelativeDateTime`, mas SEM o estágio intermediário
 * "Há N dias": a partir de anteontem já mostra a data real (Etapa "Ajuste
 * hoje/ontem no card da Operação" — o gestor quer saber a data exata, não
 * uma contagem relativa, sempre com o horário junto). Só este formatter
 * muda; `formatRelativeDateTime` continua igual em todo o resto da
 * plataforma (Última análise/Última atualização da performance na página
 * do cliente, notas do Workspace).
 *
 * IMPORTANTE: mesma regra de `formatRelativeDateTime` acima — `today`
 * precisa ser sempre `new Date()`, nunca `todayUTC()`. */
export function formatRelativeShortDateTime(value: string, today: Date): string {
  const date = new Date(value);
  const diffDays = diffCalendarDaysInAppTimezone(value, today);
  if (diffDays <= 0) return `Hoje, ${timeOnlyFormatter.format(date)}`;
  if (diffDays === 1) return `Ontem, ${timeOnlyFormatter.format(date)}`;
  return formatDateTime(value);
}

/** Mesmo bug de `dateTimeFormatter` (faltava `timeZone`) — corrigido junto. */
const dateTimeWithYearFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
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

const shortDateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

/** "DD/MM às HH:mm" no fuso da agência — usado pra "última atualização" de
 * um valor (gasto manual editado, sincronização do Meta), onde o momento
 * real importa mais que o dia civil; por isso `timeZone` explícito
 * (`APP_TIMEZONE`), diferente das datas "civis" deste arquivo que já vêm
 * corretas sem hora (`timeZone: "UTC"` só evita reconverter um dia que já é
 * o certo). */
export function formatShortDateTime(value: string): string {
  const parts = shortDateTimeFormatter.formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

/** "DD/MM" no fuso da agência, a partir de um INSTANTE real (timestamptz) —
 * irmã de `formatShortDateTime` sem a hora, pra "Alterado em DD/MM por
 * Fulano" (histórico de orçamento). Nunca usar pra data civil já correta
 * (`due_date`/`month`/`effective_date` etc. seguem usando `formatShortDate`,
 * que assume UTC e não reconverte fuso de um dia que já está certo). */
export function formatShortDateFromInstant(value: string): string {
  const parts = shortDateTimeFormatter.formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}`;
}

const dateWithYearFromInstantFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});

/** "DD/MM/AAAA" no fuso do usuário, a partir de um INSTANTE real (timestamptz)
 * — irmã de `formatShortDateFromInstant`, mas com ano (ex.: "excluído em").
 * BUG CORRIGIDO (revisão de horários): substitui usos de
 * `new Date(...).toLocaleDateString("pt-BR")` sem `timeZone`, que podia
 * mostrar o dia civil errado perto da meia-noite (mesma classe de bug de
 * `formatDateTime`, ver comentário acima). */
export function formatDateFromInstant(value: string): string {
  return dateWithYearFromInstantFormatter.format(new Date(value));
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
const agencyWeekdayShortFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: APP_TIMEZONE });
const agencyDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: APP_TIMEZONE,
});
const agencyDateShortFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: APP_TIMEZONE,
});
const agencyTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
});

/** "ter." → "Ter", "jul." → "Jul" — o Intl pt-BR sempre devolve a forma
 * curta com ponto final; a Sidebar (relógio do rodapé) quer só a palavra. */
function capitalizeNoDot(value: string): string {
  return capitalize(value.replace(/\.$/, ""));
}

/**
 * Dia da semana + data + horário no fuso da agência — ao contrário das
 * outras funções deste arquivo (que formatam datas civis já corretas com
 * timeZone "UTC"), esta recebe um instante real (`new Date()`) e por isso
 * converte de verdade pro fuso America/Sao_Paulo. Usada no relógio da
 * Sidebar (rodapé, Etapa Global UX Refinement 1.0 — antes vivia na Top Bar,
 * removida nesta etapa): `weekday`/`date` completos alimentam o tooltip da
 * Sidebar recolhida; `weekdayShort`/`dateShort` alimentam o texto discreto
 * da Sidebar expandida ("Ter • 14 Jul • 16:42").
 */
export function formatAgencyDateTime(
  date: Date,
): { weekday: string; weekdayShort: string; date: string; dateShort: string; time: string } {
  return {
    weekday: capitalize(agencyWeekdayFormatter.format(date)),
    weekdayShort: capitalizeNoDot(agencyWeekdayShortFormatter.format(date)),
    date: agencyDateFormatter.format(date),
    dateShort: capitalizeNoDot(agencyDateShortFormatter.format(date)),
    time: agencyTimeFormatter.format(date),
  };
}
