import { monthRangeFromParam, currentMonthRange } from "@/lib/sprint-financials";
import { formatMonthLabel, formatShortDate, formatDateWithYear } from "@/lib/format";

/**
 * KOFF Analytics — "Seletor global de período" (pedido explícito do
 * usuário: substituir o seletor de mês por um seletor de intervalo de
 * datas, inspirado no Gerenciador de Anúncios da Meta). Núcleo puro —
 * nenhuma consulta, nenhum React — pra ser reaproveitado por QUALQUER tela
 * (Dashboard, Campanhas, Anúncios, link compartilhado), nunca uma segunda
 * implementação por tela/dispositivo.
 *
 * Decisão de arquitetura (auditoria prévia, ver relatório apresentado ao
 * usuário): existem DOIS conceitos de "período" na plataforma, que este
 * módulo NUNCA confunde:
 *
 * 1. `range` (intervalo CONSULTADO) — o que o usuário escolheu ver:
 *    Hoje/Ontem/Últimos 7/30 dias/Este mês/Mês passado/Personalizado.
 *    Rege TUDO que é "o que aconteceu nesse período": Investimento/
 *    Resultado/Custo, indicadores Meta Ads, evolução, Campanhas/Anúncios.
 *    Nunca inclui dias futuros (`resolvePeriod` sempre recorta no "hoje"
 *    da agência — `lib/today.ts`).
 *
 * 2. `monthParam` (MÊS DE REFERÊNCIA) — o mês cujo orçamento/meta
 *    planejados continuam sendo mostrados (`monthly_budget_changes`,
 *    sprints, `canEditBudgetInline`) — ESTRUTURA 100% INTOCADA (pedido
 *    explícito: "não alterar essa estrutura"). Resolvido como "o mês que
 *    contém o início do intervalo selecionado" — sempre bem definido,
 *    nunca ambíguo, nunca criado por aproximação.
 *
 * `isMonthAligned` é o único sinal que `cockpit-view-data.ts` precisa pra
 * decidir se a edição inline do orçamento/meta faz sentido agora: só
 * verdadeiro quando o usuário está olhando "Este mês"/"Mês passado"/um
 * link antigo `?month=` — nunca com Hoje/Ontem/Últimos 7/Últimos 30/um
 * intervalo personalizado, onde editar "a meta do mês" enquanto se olha
 * pra uma janela de poucos dias seria ambíguo (seção 6 do pedido).
 */

export type PeriodShortcut = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth" | "custom";

export interface DateRange {
  firstDay: string;
  lastDay: string;
}

export interface ResolvedPeriod {
  /** Atalho ativo — só usado pra destacar a opção certa no seletor e pra
   * escolher o rótulo do botão (`formatPeriodLabel`). Nunca usado sozinho
   * pra decidir dados: `range`/`monthParam` já vêm prontos. */
  shortcut: PeriodShortcut;
  /** Intervalo efetivamente consultado (inclusive nas duas pontas),
   * nunca com dias futuros. */
  range: DateRange;
  /** Mês de referência (YYYY-MM) pro orçamento/metas — ver nota acima. */
  monthParam: string;
  /** `true` = edição de orçamento/meta inline continua disponível (mesma
   * regra de sempre, inalterada); `false` = o período escolhido não é "um
   * mês inteiro", edição fica indisponível (ver seção 6 do pedido). */
  isMonthAligned: boolean;
}

const PERIOD_SHORTCUTS: PeriodShortcut[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "custom"];

export function isPeriodShortcut(value: unknown): value is PeriodShortcut {
  return typeof value === "string" && (PERIOD_SHORTCUTS as string[]).includes(value);
}

function isValidDateString(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseYMD(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m: m - 1, d };
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Desloca uma data (YYYY-MM-DD) por `deltaDays` dias de calendário —
 * sempre em UTC puro (a data já chega como dia civil, sem hora/fuso —
 * mesma convenção de `shiftMonthParam`/`sprint-financials.ts`). */
export function shiftDays(value: string, deltaDays: number): string {
  const { y, m, d } = parseYMD(value);
  return ymd(new Date(Date.UTC(y, m, d + deltaDays)));
}

export function startOfMonth(value: string): string {
  const { y, m } = parseYMD(value);
  return ymd(new Date(Date.UTC(y, m, 1)));
}

export function endOfMonth(value: string): string {
  const { y, m } = parseYMD(value);
  return ymd(new Date(Date.UTC(y, m + 1, 0)));
}

/** Resolve os 6 atalhos fixos (seção 2 do pedido) contra o "hoje" da
 * agência — nunca o fuso do navegador. "Este mês" para em hoje (nunca
 * estende pro resto do mês, que ainda não aconteceu); "Mês passado"
 * continua o mês cheio (já é inteiramente passado, por definição). */
export function resolveShortcutRange(shortcut: Exclude<PeriodShortcut, "custom">, todayStr: string): DateRange {
  switch (shortcut) {
    case "today":
      return { firstDay: todayStr, lastDay: todayStr };
    case "yesterday": {
      const y = shiftDays(todayStr, -1);
      return { firstDay: y, lastDay: y };
    }
    case "last7":
      return { firstDay: shiftDays(todayStr, -6), lastDay: todayStr };
    case "last30":
      return { firstDay: shiftDays(todayStr, -29), lastDay: todayStr };
    case "thisMonth":
      return { firstDay: startOfMonth(todayStr), lastDay: todayStr };
    case "lastMonth": {
      const anchor = shiftDays(startOfMonth(todayStr), -1);
      return { firstDay: startOfMonth(anchor), lastDay: endOfMonth(anchor) };
    }
  }
}

/**
 * Resolução única do período efetivo — mesma função pra agência e link
 * compartilhado, mesma função pro Dashboard/Campanhas/Anúncios.
 *
 * Ordem de prioridade (nunca ambígua):
 * 1. `period` (atalho fixo) + `start`/`end` quando `period==="custom"` —
 *    novo seletor, sempre explícito.
 * 2. `month` (`?month=YYYY-MM`) — link antigo, comportamento BYTE-A-BYTE
 *    igual a antes desta etapa (mês cheio, inclusive dias futuros —
 *    nunca recortado em hoje, pra nunca mudar o que um link já enviado
 *    mostrava).
 * 3. Nenhum parâmetro — mês corrente, igual sempre foi o default.
 */
export function resolvePeriod(params: { period?: string; start?: string; end?: string; month?: string }, today: Date): ResolvedPeriod {
  const todayStr = ymd(today);

  if (params.period && params.period !== "custom" && isPeriodShortcut(params.period)) {
    const range = resolveShortcutRange(params.period as Exclude<PeriodShortcut, "custom">, todayStr);
    return {
      shortcut: params.period,
      range,
      monthParam: range.firstDay.slice(0, 7),
      isMonthAligned: params.period === "thisMonth" || params.period === "lastMonth",
    };
  }

  if (params.period === "custom" && isValidDateString(params.start) && isValidDateString(params.end) && params.start <= params.end) {
    const clampedEnd = params.end > todayStr ? todayStr : params.end;
    const range = { firstDay: params.start, lastDay: clampedEnd < params.start ? params.start : clampedEnd };
    return { shortcut: "custom", range, monthParam: range.firstDay.slice(0, 7), isMonthAligned: false };
  }

  // Link antigo (`?month=`) ou ausência total de parâmetro — mesmo
  // cálculo de sempre (`monthRangeFromParam`), zero mudança de
  // comportamento. `shortcut` só reflete se o mês resolvido é o mês
  // corrente de verdade (pra destacar "Este mês" no seletor) — nunca
  // um mês passado/futuro marcado como "Este mês" por engano.
  const monthRange = monthRangeFromParam(params.month, today);
  const isActualCurrentMonth = monthRange.firstDay === currentMonthRange(today).firstDay;
  return {
    shortcut: isActualCurrentMonth ? "thisMonth" : "custom",
    range: monthRange,
    monthParam: monthRange.firstDay.slice(0, 7),
    isMonthAligned: true,
  };
}

/** Rótulo do botão — exemplos do pedido: "Novembro de 2026", "Hoje",
 * "Últimos 7 dias", "05/11 – 12/11/2026". */
export function formatPeriodLabel(resolved: ResolvedPeriod): string {
  const { shortcut, range } = resolved;
  if (shortcut === "today") return "Hoje";
  if (shortcut === "yesterday") return "Ontem";
  if (shortcut === "last7") return "Últimos 7 dias";
  if (shortcut === "last30") return "Últimos 30 dias";
  if (shortcut === "thisMonth" || shortcut === "lastMonth") return formatMonthLabel(range.firstDay);

  // "custom" — se o intervalo bate exatamente com um mês cheio (link
  // antigo `?month=` pra mês passado/futuro, ou um recorte manual que
  // calhou de ser o mês inteiro), mostra o nome do mês — nunca a faixa de
  // datas pra esse caso, mais legível.
  if (range.firstDay === startOfMonth(range.firstDay) && range.lastDay === endOfMonth(range.firstDay)) {
    return formatMonthLabel(range.firstDay);
  }
  if (range.firstDay === range.lastDay) return formatShortDate(range.firstDay);
  return `${formatShortDate(range.firstDay)} – ${formatDateWithYear(range.lastDay)}`;
}

/** Monta o href preservando TODOS os outros parâmetros da URL atual
 * (filtro/modo/canal/etc.) — corrige a limitação que a troca de MÊS
 * sempre teve (`buildCockpitMonthHref` nunca preservou filtro/modo); a
 * troca de PERÍODO, a partir desta etapa, preserva tudo. Nunca grava mais
 * `?month=` — o novo formato (`period`/`start`/`end`) é o único escrito
 * daqui pra frente (links antigos continuam lidos, nunca mais gerados). */
export function buildPeriodHref(basePath: string, currentSearch: string, shortcut: PeriodShortcut, range?: DateRange): string {
  const params = new URLSearchParams(currentSearch);
  params.delete("month");
  params.set("period", shortcut);
  if (shortcut === "custom" && range) {
    params.set("start", range.firstDay);
    params.set("end", range.lastDay);
  } else {
    params.delete("start");
    params.delete("end");
  }
  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}
