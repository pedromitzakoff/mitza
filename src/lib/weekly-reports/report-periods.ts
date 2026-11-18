import { shiftDays } from "@/lib/date-range";
import type { WeeklyReportPeriodKind } from "@/lib/weekly-reports/report-types";

/**
 * Aba "Reports" (pedido, seção 1) — cálculo dos dois períodos fixos da
 * semana, puro (sem Supabase, sem `Date.now()` implícito — `today` é sempre
 * passado por quem chama). Toda aritmética é em dias civis (`shiftDays`,
 * `@/lib/date-range`), nunca `Date` cruzando fuso — mesma disciplina do
 * resto da plataforma (ver `lib/today.ts`). Virada de mês/ano nunca precisa
 * de caso especial: subtrair dias de uma string `YYYY-MM-DD` via UTC puro
 * já atravessa o limite corretamente.
 *
 * "No fuso de relatório já usado pelo cliente" (pedido, seção 1): a
 * plataforma tem um único fuso pra toda a agência (`APP_TIMEZONE`,
 * `lib/today.ts`, "America/Sao_Paulo") — não existe fuso por conta/cliente
 * em lugar nenhum do sistema (mesma constatação/decisão já tomada e
 * confirmada com o usuário na Etapa "Alertas"). `today` aqui é sempre
 * `todayDateString()` (já nesse fuso) — nenhum fuso novo introduzido.
 */

/** 0 = domingo .. 6 = sábado, pela MESMA convenção de `Date.UTC` — `value`
 * é sempre uma data civil (`YYYY-MM-DD`), nunca um instante. */
function weekdayOf(value: string): number {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

/** A data mais recente <= `today` que cai no dia da semana `targetWeekday`
 * (0-6) — `today` mesmo, se ele já for esse dia. Nunca olha pra frente: o
 * período de um report é sempre sobre dias já passados (pedido: "gere os
 * reports após a sincronização da manhã", nunca um período futuro). */
export function findMostRecentWeekday(today: string, targetWeekday: number): string {
  let cursor = today;
  while (weekdayOf(cursor) !== targetWeekday) {
    cursor = shiftDays(cursor, -1);
  }
  return cursor;
}

const MONDAY = 1;
const FRIDAY = 5;

export interface ReportPeriodRange {
  periodStart: string;
  periodEnd: string;
}

/** Report de segunda-feira (pedido): sexta-feira anterior até domingo,
 * inclusive — `mondayDate` é a própria segunda (nunca "hoje", quem chama já
 * resolveu via `findMostRecentWeekday`). */
export function buildMondayReportPeriod(mondayDate: string): ReportPeriodRange {
  return { periodStart: shiftDays(mondayDate, -3), periodEnd: shiftDays(mondayDate, -1) };
}

/** Report de sexta-feira (pedido): segunda a quinta da mesma semana,
 * inclusive. */
export function buildFridayReportPeriod(fridayDate: string): ReportPeriodRange {
  return { periodStart: shiftDays(fridayDate, -4), periodEnd: shiftDays(fridayDate, -1) };
}

export interface ResolvedReportPeriod extends ReportPeriodRange {
  periodKind: WeeklyReportPeriodKind;
}

/**
 * Os DOIS períodos "em aberto" relativos a `today` — o lote de segunda MAIS
 * recente e o lote de sexta MAIS recente, cada um já com seu intervalo
 * calculado. Rodar isto em QUALQUER dia da semana (não só segunda/sexta)
 * devolve sempre os mesmos 2 períodos até a próxima virada — é assim que o
 * orquestrador consegue reprocessar (pedido: "inclusive se o job rodar de
 * novo") sem precisar saber em que dia da semana está: o cron roda numa
 * cadência fixa (mesma de `evaluate-alerts`) e esta função sempre aponta
 * pro período certo, nunca duplicando nem pulando um lote.
 */
export function resolveCurrentReportPeriods(today: string): ResolvedReportPeriod[] {
  const monday = findMostRecentWeekday(today, MONDAY);
  const friday = findMostRecentWeekday(today, FRIDAY);

  return [
    { periodKind: "segunda", ...buildMondayReportPeriod(monday) },
    { periodKind: "sexta", ...buildFridayReportPeriod(friday) },
  ];
}
