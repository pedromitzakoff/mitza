import { formatDayShortMonth } from "@/lib/format";

/**
 * Etapa "Padronização Global dos Seletores de Período" (Fase 1) — núcleo
 * PURO (sem React, sem DOM) do componente canônico `PeriodRangeSelector`
 * (`components/ui/period-range-selector.tsx`). Concentrado aqui de propósito:
 * toda a matemática de calendário/rótulo é testável via
 * `scripts/test-date-range-picker.ts` sem precisar renderizar nada — mesmo
 * padrão do resto do projeto (nenhum teste de componente/DOM em lugar
 * nenhum, só lógica pura).
 *
 * Datas sempre como string `YYYY-MM-DD` (nunca `Date` cru trafegando entre
 * camadas) — comparação lexicográfica de string já é comparação
 * cronológica correta nesse formato, mesmo padrão usado em todo o projeto
 * (`resolveAnalyticsPeriod`, `isValidCustomRange`). Toda conversão pra
 * `Date` usa sempre `T00:00:00Z` + `timeZone: "UTC"` na formatação — o
 * mesmo idioma seguro contra off-by-one já usado em `lib/format.ts`/
 * `lib/analytics.ts`; o timezone civil do usuário NUNCA entra nessa
 * matemática (evita o dia mudar sozinho perto da meia-noite local).
 */

export interface DateRangeDraft {
  start: string | null;
  end: string | null;
}

/** Consolidação da checagem "fim >= início", antes reimplementada em 3
 * lugares (`report-period-nav.ts`, `client-report-wizard.tsx`,
 * `analytics.ts`) — única fonte de verdade agora. `report-period-nav.ts`
 * passou a delegar pra esta função; os outros dois pontos ficam como estão
 * (fora do escopo desta rodada). */
export function isValidDateRange(start: string, end: string): boolean {
  return Boolean(start) && Boolean(end) && end >= start;
}

/**
 * Resolve o clique do usuário no calendário — regra intuitiva de 2 cliques
 * (padrão Meta Ads/Google Flights): sem seleção ativa (ou já com um
 * intervalo completo), o clique COMEÇA uma seleção nova. Com um início já
 * marcado e sem fim, um clique numa data igual/posterior COMPLETA o
 * intervalo; um clique numa data ANTERIOR ao início reinicia a seleção a
 * partir dessa data nova (nunca inverte/troca silenciosamente início e fim
 * — reiniciar é o comportamento menos surpreendente).
 */
export function resolveRangeClick(draft: DateRangeDraft, clicked: string): DateRangeDraft {
  if (!draft.start || draft.end) {
    return { start: clicked, end: null };
  }
  if (clicked < draft.start) {
    return { start: clicked, end: null };
  }
  return { start: draft.start, end: clicked };
}

export interface CalendarDayCell {
  date: string;
  /** `false` = dia de preenchimento do mês anterior/seguinte, mostrado
   * esmaecido só pra completar a grade de semanas — nunca clicável fora do
   * mês corrente do calendário (evita "pular" de mês sem querer). */
  inMonth: boolean;
}

/** Grade de semanas (sempre múltiplo de 7 dias, começando no domingo) pro
 * mês `monthIndex` (0-based) de `year` — inclui dias do mês anterior/
 * seguinte só pra completar a primeira/última semana. Matemática via
 * `Date.UTC` (mesmo idioma de `lib/analytics.ts`'s `monthRange`), nunca
 * `Date` local — o dia da semana de "1º do mês" não pode depender do
 * timezone de quem está rodando o código. */
export function buildCalendarWeeks(year: number, monthIndex: number): CalendarDayCell[][] {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const startWeekday = firstOfMonth.getUTCDay(); // 0 = domingo
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - startWeekday;
    const cellDate = new Date(Date.UTC(year, monthIndex, 1 + dayOffset));
    cells.push({
      date: cellDate.toISOString().slice(0, 10),
      inMonth: dayOffset >= 0 && dayOffset < daysInMonth,
    });
  }

  const weeks: CalendarDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export interface CalendarMonth {
  year: number;
  /** 0-based (0 = janeiro), mesma convenção de `Date.UTC`. */
  monthIndex: number;
}

/** Navega `delta` meses a partir de `{year, monthIndex}` — lida com virada
 * de ano (dezembro→janeiro e vice-versa) via `Date.UTC`, nunca aritmética
 * manual de "if monthIndex === 0". */
export function shiftCalendarMonth({ year, monthIndex }: CalendarMonth, delta: number): CalendarMonth {
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth() };
}

export function calendarMonthFromDateString(value: string): CalendarMonth {
  const date = new Date(`${value}T00:00:00Z`);
  return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth() };
}

/** Usado só pela navegação por seta do teclado dentro da grade do
 * calendário (`PeriodRangeSelector`) — desloca `days` dias corridos a
 * partir de `value`, sempre via `Date.UTC`. */
export function addDaysToDateString(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Domingo a sábado, 3 letras minúsculas — cabeçalho fixo de qualquer
 * calendário renderizado por `PeriodRangeSelector`. */
export const WEEKDAY_SHORT_LABELS_PT_BR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/**
 * Rótulo compacto do seletor fechado (ex.: "Este mês · 01–05 set",
 * "Últimos 7 dias · 30 de ago – 05 de set", ou "01 de set 2026 – 05 de set
 * 2026" quando o período cruza pra um ano diferente do atual). Reaproveita
 * `formatDayShortMonth` (`lib/format.ts`) pra "DD mon" — nunca uma segunda
 * formatação de mês (o exato texto de `formatDayShortMonth` pode variar
 * entre versões de ICU/Node, ex. "05 set" vs "05 de set" — este helper nunca
 * assume um formato fixo, só usa a função como está). Ano só aparece quando
 * pelo menos uma das datas está fora do ano corrente (`todayYear`) — evita
 * repetir "2026" em todo período recente, mesmo padrão compacto do Meta
 * Ads; dentro do mesmo mês, os dois dias dividem um único nome de mês
 * ("01–05 set"), nunca "01 set – 05 set".
 */
export function formatCompactPeriodLabel(input: { start: string; end: string; presetLabel: string | null; todayYear: number }): string {
  const { start, end, presetLabel, todayYear } = input;
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const needsYear = startYear !== todayYear || endYear !== todayYear;

  let rangeLabel: string;
  if (start === end) {
    const label = formatDayShortMonth(start);
    rangeLabel = needsYear ? `${label} ${endYear}` : label;
  } else if (startYear === endYear && start.slice(0, 7) === end.slice(0, 7)) {
    // Mesmo mês e ano: dias combinados, um único nome de mês ("01–05 set").
    // `.pop()` (não índice fixo) porque `formatDayShortMonth` pode devolver
    // "05 set" ou "05 de set" dependendo da versão/ICU do Node em produção
    // — o nome do mês é sempre o ÚLTIMO token, nunca o segundo.
    const startDay = start.slice(8, 10);
    const endDay = end.slice(8, 10);
    const monthName = formatDayShortMonth(end).split(" ").pop();
    const combined = `${startDay}–${endDay} ${monthName}`;
    rangeLabel = needsYear ? `${combined} ${endYear}` : combined;
  } else if (startYear === endYear) {
    // Mesmo ano, meses diferentes: cada data com seu mês, ano só no fim.
    const combined = `${formatDayShortMonth(start)} – ${formatDayShortMonth(end)}`;
    rangeLabel = needsYear ? `${combined} ${endYear}` : combined;
  } else {
    // Anos diferentes: ambíguo sem o ano nas duas pontas.
    rangeLabel = `${formatDayShortMonth(start)} ${startYear} – ${formatDayShortMonth(end)} ${endYear}`;
  }

  return presetLabel ? `${presetLabel} · ${rangeLabel}` : rangeLabel;
}
