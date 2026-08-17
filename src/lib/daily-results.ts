import type { PerformanceGoal } from "./performance-goals";
import type { ChannelScope, TrafficChannel } from "./traffic-channels";
import { listDatesInclusive } from "./monthly-budget";

/**
 * Camada de EVOLUÇÃO DIÁRIA de resultados (Visão Geral do cliente) — pura,
 * sem nenhuma chamada a banco. Reaproveita `getDailyPerformanceRowsForPeriod`/
 * `getDailySpendRowsForPeriod` já existentes (`lib/performance-queries.ts`,
 * construídas pro Analytics) como ÚNICA fonte de granularidade diária —
 * nunca uma segunda tabela/coluna/snapshot.
 *
 * Granularidade diária de RESULTADO só existe pra cliente com Stract ativo
 * (`daily_performance`); cliente só-manual (`performance_records`) não tem
 * coluna de data nenhuma — mesma limitação real já assumida pelo Analytics
 * (`buildAnalyticsTrend`, `trend.result = null`), nunca uma aproximação nova
 * aqui.
 */

/** Uma linha de `daily_performance` já buscada (`DailyPerformanceRow`,
 * `lib/performance-queries.ts`) — só os campos que esta camada precisa. */
export interface DailyResultRawRow {
  date: string;
  channel: TrafficChannel;
  resultType: PerformanceGoal;
  resultCount: number;
}

/** Uma linha de `daily_spend` já buscada (`DailySpendRow`) — usada só como
 * sinal de "esse dia foi sincronizado", nunca como valor exibido aqui. */
export interface DailySpendRawRow {
  date: string;
  channel: TrafficChannel;
}

export interface DailyResultPoint {
  date: string;
  resultCount: number;
}

/**
 * `unavailable` = não é possível afirmar a série com confiança (cliente sem
 * integração Stract ativa, OU pelo menos 1 dos 7 dias sem nenhum sinal de
 * sincronização — nunca uma mistura de dias reais com dias fabricados).
 * `available.points` sempre tem exatamente os dias de `windowDates`, na
 * mesma ordem — nenhum dia omitido, mesmo quando o valor real é 0.
 */
export type DailyResultSeries = { kind: "unavailable" } | { kind: "available"; points: DailyResultPoint[] };

/** Últimos `days` dias corridos terminando em `todayStr` (inclusive) —
 * mesma convenção de data civil (`YYYY-MM-DD`) de `lib/today.ts`, nenhuma
 * segunda regra de fuso horário. Reaproveita `listDatesInclusive`
 * (`lib/monthly-budget.ts`), a mesma função que já gera a lista de dias de
 * um mês inteiro pra ritmo/esperado até hoje. */
export function lastNDaysEndingToday(todayStr: string, days: number): string[] {
  const end = new Date(`${todayStr}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return listDatesInclusive(start.toISOString().slice(0, 10), todayStr);
}

/**
 * Série diária pro escopo pedido (Consolidado soma todos os canais, um
 * canal específico filtra só ele — mesmo filtro de `aggregatePerformanceResults`,
 * nunca um segundo cálculo de consolidação). Um dia sem linha de resultado
 * só vira `0` (nunca omitido) quando há uma linha de `daily_spend` no MESMO
 * escopo pra aquele dia — sinal de que o pipeline sincronizou aquele dia;
 * sem esse sinal, o dia é desconhecido e a série inteira cai pra
 * `unavailable` (nunca fabrica uma "janela de zeros").
 */
export function buildDailyResultSeries(input: {
  windowDates: string[];
  /** `getClientIdsWithActiveImportSource` pra este cliente — `false` já
   * decide `unavailable` sem olhar mais nada (mesmo gate do Analytics). */
  hasActiveIntegration: boolean;
  goal: PerformanceGoal;
  scope: ChannelScope;
  performanceRows: DailyResultRawRow[];
  spendRows: DailySpendRawRow[];
}): DailyResultSeries {
  const { windowDates, hasActiveIntegration, goal, scope, performanceRows, spendRows } = input;
  if (!hasActiveIntegration) return { kind: "unavailable" };

  const matchesScope = (channel: TrafficChannel) => scope === "consolidated" || channel === scope;

  const resultCountByDate = new Map<string, number>();
  for (const row of performanceRows) {
    if (row.resultType !== goal || !matchesScope(row.channel)) continue;
    resultCountByDate.set(row.date, (resultCountByDate.get(row.date) ?? 0) + row.resultCount);
  }

  const syncedDates = new Set<string>();
  for (const row of spendRows) {
    if (matchesScope(row.channel)) syncedDates.add(row.date);
  }

  const points: DailyResultPoint[] = [];
  for (const date of windowDates) {
    if (resultCountByDate.has(date)) {
      points.push({ date, resultCount: resultCountByDate.get(date)! });
      continue;
    }
    if (syncedDates.has(date)) {
      points.push({ date, resultCount: 0 });
      continue;
    }
    return { kind: "unavailable" };
  }

  return { kind: "available", points };
}

export interface DailyResultStats {
  today: number;
  yesterday: number;
  average7d: number;
}

/** Hoje/ontem/média — sempre os últimos 2 pontos + a média de todos, nunca
 * uma segunda busca por data: `points` já vem na ordem cronológica de
 * `windowDates` (`buildDailyResultSeries`), então o último ponto é sempre
 * hoje por construção. */
export function computeDailyResultStats(points: DailyResultPoint[]): DailyResultStats {
  const today = points[points.length - 1].resultCount;
  const yesterday = points[points.length - 2].resultCount;
  const average7d = points.reduce((sum, p) => sum + p.resultCount, 0) / points.length;
  return { today, yesterday, average7d };
}
