import { safeDivide, computeRoas } from "@/lib/performance";
import { DAILY_ELIGIBILITY_POLICY, type WindowSamplePolicy } from "@/lib/achievement-thresholds";

/**
 * Núcleo puro de "isso é confiável o suficiente pra virar Conquista?" —
 * sem I/O, sem saber de banco. `achievement-metrics.ts` monta os
 * `ClientDailyPoint[]` a partir de `daily_spend`/`daily_performance`; este
 * arquivo só decide, a partir deles, se uma janela ou um dia específico
 * pode sustentar uma conquista.
 *
 * `dataPresent` é o único jeito de saber "esse dia foi sincronizado" —
 * mesma convenção já usada e validada em `daily-results.ts`
 * (`buildDailyResultSeries`): um dia sem NENHUMA linha de `daily_spend` é
 * desconhecido (nunca um `0` fabricado); um dia com linha de `daily_spend`
 * mas sem linha de `daily_performance` é um `0` real de resultado (o
 * pipeline rodou, só não houve resultado).
 */
export interface ClientDailyPoint {
  date: string; // YYYY-MM-DD
  dataPresent: boolean;
  spend: number;
  resultCount: number;
  /** `null` = objetivo do cliente não rastreia receita (não é "sales", ou
   * "sales" sem coluna de valor configurada) — nunca `0` fabricado. */
  revenue: number | null;
}

export function dailyCpa(point: ClientDailyPoint): number | null {
  if (!point.dataPresent) return null;
  return safeDivide(point.spend, point.resultCount);
}

export function dailyRoas(point: ClientDailyPoint): number | null {
  if (!point.dataPresent || point.revenue === null) return null;
  return computeRoas(point.revenue, point.spend);
}

// ---------------------------------------------------------------------------
// Amostra de JANELA AGREGADA (Recordes/Metas/Evolução/Escala)
// ---------------------------------------------------------------------------

export interface WindowAggregate {
  spend: number;
  resultCount: number;
  /** `null` só quando NENHUM dia da janela tiver `revenue` não-nulo. */
  revenue: number | null;
  daysWithData: number;
  windowLength: number;
  cpa: number | null;
  roas: number | null;
}

/** Soma pura de uma janela de pontos diários — dias sem `dataPresent` não
 * contam em nada (nem em `daysWithData`, nem nas somas), exatamente como um
 * dia "não existe" pra fins de agregação, distinto de "existe e é zero". */
export function aggregateWindow(points: ClientDailyPoint[]): WindowAggregate {
  const present = points.filter((p) => p.dataPresent);
  const spend = present.reduce((sum, p) => sum + p.spend, 0);
  const resultCount = present.reduce((sum, p) => sum + p.resultCount, 0);
  const revenueDays = present.filter((p) => p.revenue !== null);
  const revenue = revenueDays.length > 0 ? revenueDays.reduce((sum, p) => sum + (p.revenue ?? 0), 0) : null;

  return {
    spend,
    resultCount,
    revenue,
    daysWithData: present.length,
    windowLength: points.length,
    cpa: safeDivide(spend, resultCount),
    roas: computeRoas(revenue, spend),
  };
}

export function windowSampleIsValid(agg: WindowAggregate, policy: WindowSamplePolicy): boolean {
  if (agg.resultCount < policy.minResultCount) return false;
  if (agg.spend < policy.minSpend) return false;
  if (policy.minDaysWithData !== undefined && agg.daysWithData < policy.minDaysWithData) return false;
  if (policy.minDaysCoveragePct !== undefined) {
    if (agg.windowLength === 0) return false;
    if (agg.daysWithData / agg.windowLength < policy.minDaysCoveragePct) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Amostra de DIA — classificador de 4 estados pra streak (Consistência/
// Recuperação). "Consecutivo" passa a significar dias de MÍDIA consecutivos
// elegíveis, nunca dias de calendário consecutivos (determinação de
// aprovação nº4).
// ---------------------------------------------------------------------------

/** `dentro` conta (+1 na sequência); `fora` quebra; `neutro` (sync
 * confiável, mas sem mídia relevante naquele dia) não conta nem quebra — a
 * sequência pula; `invalido` (sem sync confiável, sem meta configurada, ou
 * escopo planejado×realizado não comparável naquele mês) quebra, porque
 * dado não confiável nunca pode sustentar uma continuidade. */
export type StreakDayState = "dentro" | "fora" | "neutro" | "invalido";

export function classifyStreakDay(input: {
  point: ClientDailyPoint;
  /** Resolvido uma vez por mês (`resolveCostScopeComparability`/
   * `resolveChannelScopeComparison`, `channel-metrics.ts`) — um dia não tem
   * escopo próprio, quem tem é o mês do plano em que ele cai. */
  scopeComparable: boolean;
  target: number | null;
  metricValue: (point: ClientDailyPoint) => number | null;
  isWithinTarget: (value: number, target: number) => boolean;
}): StreakDayState {
  const { point, scopeComparable, target, metricValue, isWithinTarget } = input;

  if (!point.dataPresent) return "invalido";
  if (!scopeComparable) return "invalido";
  if (target === null) return "invalido";
  if (point.spend < DAILY_ELIGIBILITY_POLICY.minSpend) return "neutro";
  if (point.resultCount < DAILY_ELIGIBILITY_POLICY.minResultCount) return "neutro";

  const value = metricValue(point);
  if (value === null) return "neutro";

  return isWithinTarget(value, target) ? "dentro" : "fora";
}

export interface StreakScanResult {
  /** Dias de mídia elegíveis contados na sequência ATUAL (terminando no
   * último dia de `days`), pulando neutros. */
  currentLength: number;
  /** Data (mais antiga) do primeiro dia "dentro" da sequência atual — `null`
   * se `currentLength === 0`. Base da idempotency_key: uma sequência com o
   * mesmo início nunca gera uma segunda conquista do mesmo patamar. */
  streakStartDate: string | null;
}

/** Varre `days` (ordem cronológica crescente, terminando no dia avaliado)
 * de trás pra frente, contando dias "dentro" e pulando "neutro", parando no
 * primeiro "fora"/"invalido". Nenhum estado persistido — recomputado do
 * zero a cada avaliação (arquitetura aprovada), por isso é sempre seguro
 * rodar de novo. */
export function scanBackwardStreak(days: { date: string; state: StreakDayState }[]): StreakScanResult {
  let length = 0;
  let startDate: string | null = null;

  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (day.state === "neutro") continue;
    if (day.state === "dentro") {
      length++;
      startDate = day.date;
      continue;
    }
    break;
  }

  return { currentLength: length, streakStartDate: startDate };
}

/** Recuperação: sequência "ruim" (estado oposto ao alvo) imediatamente
 * anterior a uma sequência "boa" que já confirmou — nunca uma oscilação de
 * 1 dia (determinação de aprovação nº4 aplicada à seção 9 da Auditoria).
 * Varre de trás pra frente: primeiro conta os dias "dentro" mais recentes
 * (confirmação), depois exige que os dias imediatamente anteriores a essa
 * confirmação formem uma sequência "fora" de tamanho mínimo. */
export interface RecoveryScanResult {
  recovered: boolean;
  confirmationDays: number;
  badStreakDays: number;
  /** Data em que a confirmação atingiu EXATAMENTE o mínimo exigido — base
   * de `occurredOnDate` (a recuperação "aconteceu" nesse dia, não em todo
   * dia subsequente que ela se mantém confirmada). */
  confirmedOnDate: string | null;
  /** Data em que o período ruim começou — só informativo (metadata). */
  badStreakStartDate: string | null;
}

export function scanBackwardRecovery(
  days: { date: string; state: StreakDayState }[],
  minBadStreakDays: number,
  minConfirmationDays: number,
): RecoveryScanResult {
  const notFound: RecoveryScanResult = {
    recovered: false,
    confirmationDays: 0,
    badStreakDays: 0,
    confirmedOnDate: null,
    badStreakStartDate: null,
  };

  let i = days.length - 1;
  // Datas dos dias "dentro" contados, da mais recente pra mais antiga.
  const confirmationDatesDesc: string[] = [];

  while (i >= 0 && days[i].state === "neutro") i--;
  while (i >= 0 && days[i].state === "dentro") {
    confirmationDatesDesc.push(days[i].date);
    i--;
    while (i >= 0 && days[i].state === "neutro") i--;
  }

  const confirmationDays = confirmationDatesDesc.length;
  if (confirmationDays < minConfirmationDays) return notFound;

  let badStreakDays = 0;
  let badStreakStartDate: string | null = null;
  while (i >= 0 && days[i].state === "fora") {
    badStreakDays++;
    badStreakStartDate = days[i].date;
    i--;
    while (i >= 0 && days[i].state === "neutro") i--;
  }

  if (badStreakDays < minBadStreakDays) return notFound;

  return {
    recovered: true,
    confirmationDays,
    badStreakDays,
    // O dia em que a confirmação cruzou o mínimo — contando da mais antiga
    // pra mais recente, é o (minConfirmationDays)-ésimo dia "dentro". Como
    // `confirmationDatesDesc` está ordenado da mais recente pra mais
    // antiga, esse dia fica no índice `confirmationDays - minConfirmationDays`
    // (ex.: 5 dias de confirmação, mínimo 3 — o 3º dia contando do início
    // é o 3º-mais-antigo, índice 5-3=2 na lista invertida).
    confirmedOnDate: confirmationDatesDesc[confirmationDays - minConfirmationDays],
    badStreakStartDate,
  };
}
