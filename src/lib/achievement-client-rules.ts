import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency, formatPercent } from "@/lib/format";
import {
  aggregateWindow,
  classifyStreakDay,
  dailyCpa,
  scanBackwardRecovery,
  scanBackwardStreak,
  windowSampleIsValid,
  type ClientDailyPoint,
  type StreakDayState,
} from "@/lib/achievement-sample";
import { addDays, daysElapsedInMonth, firstDayOfMonth, isLastDayOfMonth, lastDayOfMonth, listDatesInclusive, yearMonthOf } from "@/lib/achievement-dates";
import {
  CONSISTENCY_STREAK_THRESHOLDS,
  EVOLUTION_CPA_IMPROVEMENT_PCT,
  EVOLUTION_ROAS_GROWTH_PCT,
  MONTHLY_GOAL_MIN_DATA_COVERAGE_PCT,
  MONTHLY_GOAL_MIN_TARGET_RESULT_COUNT,
  MONTHLY_GOAL_MULTIPLIERS,
  RECOVERY_MIN_BAD_STREAK_DAYS,
  RECOVERY_MIN_CONFIRMATION_DAYS,
  SCALE_MAX_CPA_DETERIORATION_PCT,
  SCALE_MIN_INVESTMENT_GROWTH_PCT,
  STREAK_LOOKBACK_DAYS,
  WINDOW_SAMPLE_POLICY,
} from "@/lib/achievement-thresholds";
import type { AchievementCandidate } from "@/lib/achievement-types";

/**
 * As 12 regras de Cliente da V1 — cada função é pura (sem I/O), recebe o
 * contexto já resolvido (`ClientAchievementContext`, montado por
 * `achievement-metrics.ts`) e devolve no máximo 1 candidato. V1 = escopo
 * Consolidado apenas (Auditoria, seção 8 / determinação de aprovação
 * "Consolidado primeiro").
 *
 * Regra geral de anti-spam (Auditoria, seção 29): toda regra de "limiar
 * cruzado" (Metas/Consistência/Evolução/Escala/Recuperação) só emite um
 * candidato no dia em que o patamar É CRUZADO — nunca em todo dia
 * subsequente que ele continua verdadeiro. Isso é garantido de duas formas
 * complementares: (1) a `windowKey` do candidato é determinística por
 * ocorrência (ex.: início da sequência, mês, janela de comparação), então
 * tentativas repetidas do MESMO cruzamento colidem na idempotency_key e são
 * descartadas pelo banco; (2) pra regras cuja janela desliza todo dia
 * (Evolução/Escala), a própria regra só retorna candidato quando a condição
 * era falsa (ou amostra inválida) no dia anterior e passa a ser verdadeira
 * hoje — nunca floodando um patamar sustentado por semanas.
 */

export interface ClientMonthlyGoalInfo {
  /** Meta de CPA consolidada resolvida pra este mês (`resolveClientMonthlyPlan`
   * + `safeDivide`) — `null` = cliente sem meta configurada pra este mês. */
  targetCostPerResult: number | null;
  targetResultCount: number | null;
  /** `resolveCostScopeComparability` pra este mês — `false` invalida
   * qualquer regra relativa a meta nesse mês inteiro (determinação de
   * aprovação nº3, aplicada também a escopo, não só a frescor). */
  scopeComparable: boolean;
}

export interface ClientAchievementContext {
  clientId: string;
  clientName: string;
  /** Dia fechado sendo avaliado — "ontem" no cron diário, uma data
   * histórica arbitrária no backfill (Etapa "Backfill 30 dias") — nunca
   * "hoje" em nenhum dos dois casos. */
  yesterday: string;
  performanceGoal: PerformanceGoal | null;
  tracksRevenue: boolean;
  /** Ordenados por data crescente, cobrindo do início do histórico
   * disponível até `yesterday`, sem buracos na SEQUÊNCIA de datas (todo dia
   * do intervalo tem uma entrada — `dataPresent: false` é o "buraco",
   * nunca a ausência do próprio dia no array). */
  dailyPoints: ClientDailyPoint[];
  /** Só os meses efetivamente necessários pras regras de meta (mês
   * corrente + anterior) — resolvido sob demanda por `achievement-metrics.ts`,
   * nunca todo o histórico. */
  goalByMonth: Map<string, ClientMonthlyGoalInfo>;
}

function pointsMap(ctx: ClientAchievementContext): Map<string, ClientDailyPoint> {
  return new Map(ctx.dailyPoints.map((p) => [p.date, p]));
}

/** Últimos `length` dias terminando em `endDate` (inclusive), na ordem em
 * que existirem no contexto — dias fora do intervalo carregado (mais
 * antigos que o início do histórico buscado) simplesmente não entram no
 * array, o que já reduz `daysWithData`/`windowLength` corretamente. */
function windowPointsEndingAt(map: Map<string, ClientDailyPoint>, endDate: string, length: number): ClientDailyPoint[] {
  const points: ClientDailyPoint[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const point = map.get(addDays(endDate, -i));
    if (point) points.push(point);
  }
  return points;
}

function monthGoal(ctx: ClientAchievementContext, date: string): ClientMonthlyGoalInfo | null {
  return ctx.goalByMonth.get(yearMonthOf(date)) ?? null;
}

// ---------------------------------------------------------------------------
// RECORDES — todos como janela de 7 dias corrida ("melhor semana"), nunca
// um único dia isolado: um recorde é permanente/compartilhável, a amostra
// de um dia sozinho é frágil demais pra isso (mesmo quando passa no piso
// diário de streak). "Menor CPA histórico"/"Maior ROAS histórico" da V1
// aprovada são, portanto, o melhor CPA/ROAS de qualquer janela de 7 dias
// desde o início do histórico — refinamento feito na implementação, ver
// relatório final.
// ---------------------------------------------------------------------------

interface RollingWindowResult {
  endDate: string;
  value: number;
  agg: ReturnType<typeof aggregateWindow>;
}

/** Todas as janelas de `windowSize` dias com amostra válida, terminando em
 * cada data possível do histórico carregado (nunca além do que foi
 * buscado). */
function rollingValidWindows(
  map: Map<string, ClientDailyPoint>,
  allDatesAsc: string[],
  windowSize: number,
  valueOf: (agg: ReturnType<typeof aggregateWindow>) => number | null,
): RollingWindowResult[] {
  const results: RollingWindowResult[] = [];
  for (const endDate of allDatesAsc) {
    const points = windowPointsEndingAt(map, endDate, windowSize);
    if (points.length < windowSize) continue; // janela incompleta (fora do histórico carregado)
    const agg = aggregateWindow(points);
    if (!windowSampleIsValid(agg, WINDOW_SAMPLE_POLICY.week)) continue;
    const value = valueOf(agg);
    if (value === null) continue;
    results.push({ endDate, value, agg });
  }
  return results;
}

function bestRollingWeekRecord(
  ctx: ClientAchievementContext,
  type: string,
  family: "recordes",
  metricLabel: "cpa" | "roas" | "result_count",
  valueOf: (agg: ReturnType<typeof aggregateWindow>) => number | null,
  better: (candidate: number, best: number) => boolean,
  formatValue: (value: number) => string,
  headline: string,
  detailOf: (formatted: string) => string,
): AchievementCandidate | null {
  const map = pointsMap(ctx);
  const allDates = ctx.dailyPoints.map((p) => p.date);
  const windows = rollingValidWindows(map, allDates, 7, valueOf);
  if (windows.length === 0) return null;

  const candidateWindow = windows.find((w) => w.endDate === ctx.yesterday);
  if (!candidateWindow) return null; // janela de ontem não passou na amostra — nada a fazer hoje

  const priorWindows = windows.filter((w) => w.endDate !== ctx.yesterday && w.endDate < ctx.yesterday);
  if (priorWindows.length === 0) return null; // sem baseline anterior real — primeira janela válida não é "recorde" (seção 30)

  const bestPrior = priorWindows.reduce((best, w) => (better(w.value, best.value) ? w : best));
  if (!better(candidateWindow.value, bestPrior.value)) return null;

  const formatted = formatValue(candidateWindow.value);
  const startDate = addDays(candidateWindow.endDate, -6);

  return {
    type,
    scope: "client",
    family,
    severity: "record",
    occurredOnDate: candidateWindow.endDate,
    windowKey: `week_record:${candidateWindow.endDate}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: metricLabel === "result_count" ? "result_count" : metricLabel,
      actual: candidateWindow.value,
      unit: metricLabel === "cpa" ? "currency" : metricLabel === "roas" ? "ratio" : "count",
      windowStart: startDate,
      windowEnd: candidateWindow.endDate,
      windowLabel: "7 dias",
      comparisonActual: bestPrior.value,
      sampleResultCount: candidateWindow.agg.resultCount,
      sampleSpend: candidateWindow.agg.spend,
    },
    headline,
    detail: detailOf(formatted),
  };
}

export function ruleRecordBestCpaWeek(ctx: ClientAchievementContext): AchievementCandidate | null {
  return bestRollingWeekRecord(
    ctx,
    "client_record_best_cpa_week",
    "recordes",
    "cpa",
    (agg) => agg.cpa,
    (candidate, best) => candidate < best,
    (v) => formatCurrency(v),
    `${ctx.clientName} teve a melhor semana de CPA da história`,
    (f) => `CPA de ${f} na semana`,
  );
}

export function ruleRecordBestRoasWeek(ctx: ClientAchievementContext): AchievementCandidate | null {
  if (!ctx.tracksRevenue) return null;
  return bestRollingWeekRecord(
    ctx,
    "client_record_best_roas_week",
    "recordes",
    "roas",
    (agg) => agg.roas,
    (candidate, best) => candidate > best,
    (v) => `${v.toFixed(2)}x`,
    `${ctx.clientName} teve a melhor semana de ROAS da história`,
    (f) => `ROAS de ${f} na semana`,
  );
}

export function ruleRecordBestResultsWeek(ctx: ClientAchievementContext): AchievementCandidate | null {
  return bestRollingWeekRecord(
    ctx,
    "client_record_best_results_week",
    "recordes",
    "result_count",
    (agg) => agg.resultCount,
    (candidate, best) => candidate > best,
    (v) => `${v}`,
    `${ctx.clientName} teve a melhor semana de resultados da história`,
    (f) => `${f} resultados na semana`,
  );
}

/** A. Recorde de mês FECHADO — só avaliado quando `yesterday` é o último
 * dia civil do mês (o mês que acabou de fechar). Compara o total do mês
 * que fechou contra o melhor mês fechado ANTERIOR — nunca contra um mês em
 * andamento (determinação de aprovação nº2). */
export function ruleRecordBestMonthClosed(ctx: ClientAchievementContext): AchievementCandidate | null {
  if (!isLastDayOfMonth(ctx.yesterday)) return null;

  const map = pointsMap(ctx);
  const closedMonth = yearMonthOf(ctx.yesterday);
  const closedPoints = windowPointsEndingAt(map, ctx.yesterday, daysInMonthOf(ctx.yesterday));
  const closedAgg = aggregateWindow(closedPoints);
  if (!windowSampleIsValid(closedAgg, WINDOW_SAMPLE_POLICY.month)) return null;

  // Todos os meses fechados anteriores presentes no histórico carregado.
  const priorMonths = distinctMonthsBefore(ctx.dailyPoints, closedMonth);
  const priorTotals = priorMonths
    .map((ym) => {
      const points = pointsForMonth(map, ym);
      const agg = aggregateWindow(points);
      return { yearMonth: ym, agg };
    })
    .filter(({ agg }) => windowSampleIsValid(agg, WINDOW_SAMPLE_POLICY.month));

  if (priorTotals.length === 0) return null; // sem baseline real (seção 30)

  const best = priorTotals.reduce((b, m) => (m.agg.resultCount > b.agg.resultCount ? m : b));
  if (closedAgg.resultCount <= best.agg.resultCount) return null;

  return {
    type: "client_record_best_month_closed",
    scope: "client",
    family: "recordes",
    severity: "record",
    occurredOnDate: ctx.yesterday,
    windowKey: `month_closed_record:${closedMonth}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "result_count",
      actual: closedAgg.resultCount,
      unit: "count",
      windowStart: firstDayOfMonth(closedMonth),
      windowEnd: ctx.yesterday,
      windowLabel: "mês",
      comparisonActual: best.agg.resultCount,
      sampleResultCount: closedAgg.resultCount,
      sampleSpend: closedAgg.spend,
    },
    headline: `${ctx.clientName} teve o melhor mês da história`,
    detail: `${closedAgg.resultCount} resultados no mês, superando o recorde anterior de ${best.agg.resultCount}`,
  };
}

/** B. Recorde de RITMO mensal em andamento — o mês corrente (parcial, até
 * ontem) já superou o melhor mês FECHADO de toda a história. Só dispara no
 * primeiro dia em que a virada acontece (windowKey por mês corrente, nunca
 * por dia). */
export function ruleRecordCurrentMonthPaceBeatsHistory(ctx: ClientAchievementContext): AchievementCandidate | null {
  const currentMonth = yearMonthOf(ctx.yesterday);
  if (isLastDayOfMonth(ctx.yesterday)) return null; // esse é o caso A, não B

  const map = pointsMap(ctx);
  const elapsedDays = daysElapsedInMonth(ctx.yesterday);
  const currentPoints = windowPointsEndingAt(map, ctx.yesterday, elapsedDays);
  const currentAgg = aggregateWindow(currentPoints);

  // Cobertura de dias decorridos (não o mês inteiro — ele ainda não acabou).
  const coveragePolicy = { ...WINDOW_SAMPLE_POLICY.month, minDaysCoveragePct: MONTHLY_GOAL_MIN_DATA_COVERAGE_PCT };
  if (!windowSampleIsValid(currentAgg, coveragePolicy)) return null;

  const priorMonths = distinctMonthsBefore(ctx.dailyPoints, currentMonth);
  const priorTotals = priorMonths
    .map((ym) => aggregateWindow(pointsForMonth(map, ym)))
    .filter((agg) => windowSampleIsValid(agg, WINDOW_SAMPLE_POLICY.month));

  if (priorTotals.length === 0) return null;

  const bestClosed = priorTotals.reduce((b, agg) => (agg.resultCount > b.resultCount ? agg : b));
  if (currentAgg.resultCount <= bestClosed.resultCount) return null;

  // Só dispara no primeiro dia em que a virada acontece: se ONTEM já tivesse
  // ultrapassado o recorde, não é novidade hoje.
  if (elapsedDays > 1) {
    const previousDayPoints = windowPointsEndingAt(map, addDays(ctx.yesterday, -1), elapsedDays - 1);
    const previousDayAgg = aggregateWindow(previousDayPoints);
    if (windowSampleIsValid(previousDayAgg, coveragePolicy) && previousDayAgg.resultCount > bestClosed.resultCount) return null;
  }

  const daysRemaining = listDaysRemainingInMonth(ctx.yesterday);

  return {
    type: "client_record_current_month_pace_beats_history",
    scope: "client",
    family: "recordes",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `month_pace_record:${currentMonth}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "result_count",
      actual: currentAgg.resultCount,
      unit: "count",
      windowStart: firstDayOfMonth(currentMonth),
      windowEnd: ctx.yesterday,
      windowLabel: "mês em andamento",
      comparisonActual: bestClosed.resultCount,
      sampleResultCount: currentAgg.resultCount,
      sampleSpend: currentAgg.spend,
    },
    headline: `Novo recorde mensal em andamento`,
    detail: `Com ${daysRemaining} dias restantes, ${ctx.clientName} já superou seu maior volume mensal de resultados (recorde anterior: ${bestClosed.resultCount})`,
  };
}

function daysInMonthOf(date: string): number {
  return listDatesInclusive(firstDayOfMonth(date), lastDayOfMonth(date)).length;
}

function pointsForMonth(map: Map<string, ClientDailyPoint>, yearMonth: string): ClientDailyPoint[] {
  const from = firstDayOfMonth(yearMonth);
  const to = lastDayOfMonth(yearMonth);
  return listDatesInclusive(from, to)
    .map((d) => map.get(d))
    .filter((p): p is ClientDailyPoint => p !== undefined);
}

function distinctMonthsBefore(points: ClientDailyPoint[], beforeYearMonth: string): string[] {
  const months = new Set(points.map((p) => yearMonthOf(p.date)).filter((ym) => ym < beforeYearMonth));
  return Array.from(months).sort();
}

function listDaysRemainingInMonth(date: string): number {
  return listDatesInclusive(addDays(date, 1), lastDayOfMonth(date)).length;
}

// ---------------------------------------------------------------------------
// METAS — mês corrente, até ontem, contra `target_result_count` consolidado
// do mês (`monthly_budget_changes`). Amostra própria (o alvo já embute o
// volume, ver `achievement-thresholds.ts`).
// ---------------------------------------------------------------------------

export function ruleGoalMonthlyResultReached(ctx: ClientAchievementContext): AchievementCandidate | null {
  const goal = monthGoal(ctx, ctx.yesterday);
  if (!goal || goal.targetResultCount === null || !goal.scopeComparable) return null;
  if (goal.targetResultCount < MONTHLY_GOAL_MIN_TARGET_RESULT_COUNT) return null;

  const map = pointsMap(ctx);
  const currentMonth = yearMonthOf(ctx.yesterday);
  const elapsedDays = daysElapsedInMonth(ctx.yesterday);
  const currentAgg = aggregateWindow(windowPointsEndingAt(map, ctx.yesterday, elapsedDays));

  if (currentAgg.windowLength === 0) return null;
  if (currentAgg.daysWithData / currentAgg.windowLength < MONTHLY_GOAL_MIN_DATA_COVERAGE_PCT) return null;

  const achievedRatioToday = currentAgg.resultCount / goal.targetResultCount;
  const thresholdToday = MONTHLY_GOAL_MULTIPLIERS.find((m) => achievedRatioToday >= m);
  if (!thresholdToday) return null;

  // Anti-spam: só emite quando o patamar (o MAIOR já atingido) muda em
  // relação a ontem — senão o mesmo patamar tentaria se registrar todo dia
  // (inofensivo pra idempotência, mas evitável sem custo).
  if (elapsedDays > 1) {
    const prevAgg = aggregateWindow(windowPointsEndingAt(map, addDays(ctx.yesterday, -1), elapsedDays - 1));
    if (prevAgg.windowLength > 0 && prevAgg.daysWithData / prevAgg.windowLength >= MONTHLY_GOAL_MIN_DATA_COVERAGE_PCT) {
      const achievedRatioYesterday = prevAgg.resultCount / goal.targetResultCount;
      const thresholdYesterday = MONTHLY_GOAL_MULTIPLIERS.find((m) => achievedRatioYesterday >= m);
      if (thresholdYesterday === thresholdToday) return null;
    }
  }

  return {
    type: "client_goal_monthly_result_reached",
    scope: "client",
    family: "metas",
    severity: thresholdToday >= 1.25 ? "highlight" : "milestone",
    occurredOnDate: ctx.yesterday,
    windowKey: `goal_monthly:${currentMonth}:${thresholdToday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "result_count",
      actual: currentAgg.resultCount,
      unit: "count",
      target: goal.targetResultCount,
      windowStart: firstDayOfMonth(currentMonth),
      windowEnd: ctx.yesterday,
      windowLabel: "mês",
    },
    headline: thresholdToday > 1 ? `${ctx.clientName} superou a meta mensal` : `${ctx.clientName} atingiu a meta mensal`,
    detail:
      thresholdToday > 1
        ? `${currentAgg.resultCount} resultados — ${formatPercent((thresholdToday - 1) * 100)} acima da meta de ${goal.targetResultCount}`
        : `${currentAgg.resultCount} resultados, meta de ${goal.targetResultCount} atingida`,
  };
}

// ---------------------------------------------------------------------------
// CONSISTÊNCIA — só CPA-abaixo-da-meta (ROAS cortado da V1: sem meta de
// ROAS no banco, ver Auditoria seção 3). "Dias de mídia consecutivos
// elegíveis", nunca dias de calendário (determinação de aprovação nº4).
// ---------------------------------------------------------------------------

function buildCpaStreakDays(ctx: ClientAchievementContext): { date: string; state: StreakDayState }[] {
  const map = pointsMap(ctx);
  const startDate = addDays(ctx.yesterday, -(STREAK_LOOKBACK_DAYS - 1));
  const dates = listDatesInclusive(startDate, ctx.yesterday);

  return dates.map((date) => {
    const point = map.get(date);
    const goal = monthGoal(ctx, date);
    if (!point) return { date, state: "invalido" as StreakDayState };
    return {
      date,
      state: classifyStreakDay({
        point,
        scopeComparable: goal?.scopeComparable ?? false,
        target: goal?.targetCostPerResult ?? null,
        metricValue: dailyCpa,
        isWithinTarget: (value, target) => value <= target,
      }),
    };
  });
}

export function ruleConsistencyCpaBelowTarget(ctx: ClientAchievementContext): AchievementCandidate | null {
  const days = buildCpaStreakDays(ctx);
  const { currentLength, streakStartDate } = scanBackwardStreak(days);
  if (!streakStartDate) return null;

  const threshold = CONSISTENCY_STREAK_THRESHOLDS.find((t) => currentLength >= t);
  if (!threshold) return null;

  // Só emite no dia em que o patamar É atingido — no dia anterior a
  // sequência precisa ainda não ter alcançado esse mesmo patamar.
  const yesterdayLength = currentLength - 1;
  if (yesterdayLength >= threshold) return null;

  const goal = monthGoal(ctx, ctx.yesterday);
  const point = pointsMap(ctx).get(ctx.yesterday);
  const cpaToday = point ? dailyCpa(point) : null;

  return {
    type: "client_consistency_cpa_below_target",
    scope: "client",
    family: "consistencia",
    severity: threshold >= 14 ? "highlight" : "milestone",
    occurredOnDate: ctx.yesterday,
    windowKey: `consistency_cpa:${streakStartDate}:${threshold}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "cpa",
      actual: cpaToday ?? 0,
      unit: "currency",
      target: goal?.targetCostPerResult ?? null,
      windowStart: streakStartDate,
      windowEnd: ctx.yesterday,
      streakDays: threshold,
    },
    headline: `${ctx.clientName} completou ${threshold} dias de mídia consecutivos abaixo da meta de CPA`,
    detail:
      cpaToday !== null && goal?.targetCostPerResult
        ? `CPA de ${formatCurrency(cpaToday)} · Meta ${formatCurrency(goal.targetCostPerResult)}`
        : `${threshold} dias consecutivos dentro da meta de CPA`,
  };
}

// ---------------------------------------------------------------------------
// EVOLUÇÃO — 7 dias vs 7 dias anteriores, as duas pernas validam amostra
// independentemente (determinação de aprovação nº1). Detector de
// "cruzamento": só emite quando a condição passa a valer hoje mas não valia
// ontem (evita floodar um patamar sustentado por semanas).
// ---------------------------------------------------------------------------

function evolutionCpaImprovedAsOf(ctx: ClientAchievementContext, asOfDate: string): { passes: boolean; currentCpa: number | null; previousCpa: number | null } {
  const map = pointsMap(ctx);
  const current = aggregateWindow(windowPointsEndingAt(map, asOfDate, 7));
  const previous = aggregateWindow(windowPointsEndingAt(map, addDays(asOfDate, -7), 7));
  if (!windowSampleIsValid(current, WINDOW_SAMPLE_POLICY.d7) || !windowSampleIsValid(previous, WINDOW_SAMPLE_POLICY.d7)) {
    return { passes: false, currentCpa: current.cpa, previousCpa: previous.cpa };
  }
  if (current.cpa === null || previous.cpa === null || previous.cpa === 0) {
    return { passes: false, currentCpa: current.cpa, previousCpa: previous.cpa };
  }
  const improvementPct = (previous.cpa - current.cpa) / previous.cpa;
  return { passes: improvementPct >= EVOLUTION_CPA_IMPROVEMENT_PCT, currentCpa: current.cpa, previousCpa: previous.cpa };
}

export function ruleEvolutionCpaImproved(ctx: ClientAchievementContext): AchievementCandidate | null {
  const today = evolutionCpaImprovedAsOf(ctx, ctx.yesterday);
  if (!today.passes) return null;
  const prior = evolutionCpaImprovedAsOf(ctx, addDays(ctx.yesterday, -1));
  if (prior.passes) return null; // já tinha cruzado ontem — não repete

  const improvementPct = today.previousCpa && today.currentCpa !== null ? (today.previousCpa - today.currentCpa) / today.previousCpa : 0;

  return {
    type: "client_evolution_cpa_improved",
    scope: "client",
    family: "evolucao",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `evolution_cpa:${ctx.yesterday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "cpa",
      actual: today.currentCpa ?? 0,
      unit: "currency",
      comparisonActual: today.previousCpa ?? undefined,
      windowEnd: ctx.yesterday,
      windowStart: addDays(ctx.yesterday, -6),
      comparisonWindowStart: addDays(ctx.yesterday, -13),
      comparisonWindowEnd: addDays(ctx.yesterday, -7),
    },
    headline: `CPA da ${ctx.clientName} melhorou ${formatPercent(improvementPct * 100)} vs. os 7 dias anteriores`,
    detail: `${formatCurrency(today.currentCpa ?? 0)} contra ${formatCurrency(today.previousCpa ?? 0)} no período anterior`,
  };
}

function evolutionRoasGrowthAsOf(ctx: ClientAchievementContext, asOfDate: string): { passes: boolean; currentRoas: number | null; previousRoas: number | null } {
  const map = pointsMap(ctx);
  const current = aggregateWindow(windowPointsEndingAt(map, asOfDate, 7));
  const previous = aggregateWindow(windowPointsEndingAt(map, addDays(asOfDate, -7), 7));
  if (!windowSampleIsValid(current, WINDOW_SAMPLE_POLICY.d7) || !windowSampleIsValid(previous, WINDOW_SAMPLE_POLICY.d7)) {
    return { passes: false, currentRoas: current.roas ?? null, previousRoas: previous.roas ?? null };
  }
  const currentRoas = current.roas ?? null;
  const previousRoas = previous.roas ?? null;
  if (currentRoas === null || previousRoas === null || previousRoas === 0) {
    return { passes: false, currentRoas, previousRoas };
  }
  const growthPct = (currentRoas - previousRoas) / previousRoas;
  return { passes: growthPct >= EVOLUTION_ROAS_GROWTH_PCT, currentRoas, previousRoas };
}

export function ruleEvolutionRoasGrowth(ctx: ClientAchievementContext): AchievementCandidate | null {
  if (!ctx.tracksRevenue) return null;
  const today = evolutionRoasGrowthAsOf(ctx, ctx.yesterday);
  if (!today.passes) return null;
  const prior = evolutionRoasGrowthAsOf(ctx, addDays(ctx.yesterday, -1));
  if (prior.passes) return null;

  const growthPct = today.previousRoas && today.currentRoas !== null ? (today.currentRoas - today.previousRoas) / today.previousRoas : 0;

  return {
    type: "client_evolution_roas_growth",
    scope: "client",
    family: "evolucao",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `evolution_roas:${ctx.yesterday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "roas",
      actual: today.currentRoas ?? 0,
      unit: "ratio",
      comparisonActual: today.previousRoas ?? undefined,
      windowEnd: ctx.yesterday,
      windowStart: addDays(ctx.yesterday, -6),
      comparisonWindowStart: addDays(ctx.yesterday, -13),
      comparisonWindowEnd: addDays(ctx.yesterday, -7),
    },
    headline: `ROAS da ${ctx.clientName} cresceu ${formatPercent(growthPct * 100)} vs. os 7 dias anteriores`,
    detail: `${(today.currentRoas ?? 0).toFixed(2)}x contra ${(today.previousRoas ?? 0).toFixed(2)}x no período anterior`,
  };
}

// ---------------------------------------------------------------------------
// ESCALA — investimento cresceu ≥20% enquanto o CPA se manteve dentro da
// meta (SCALE_MAX_CPA_DETERIORATION_PCT = 0 na V1: nenhuma tolerância além
// de "continuar dentro da meta"). Mesmas duas pernas 7d/7d-anterior, mesmo
// detector de cruzamento.
// ---------------------------------------------------------------------------

function scaleEfficientAsOf(
  ctx: ClientAchievementContext,
  asOfDate: string,
): { passes: boolean; currentSpend: number; previousSpend: number; currentCpa: number | null; target: number | null } {
  const map = pointsMap(ctx);
  const current = aggregateWindow(windowPointsEndingAt(map, asOfDate, 7));
  const previous = aggregateWindow(windowPointsEndingAt(map, addDays(asOfDate, -7), 7));
  const goal = monthGoal(ctx, asOfDate);

  if (!windowSampleIsValid(current, WINDOW_SAMPLE_POLICY.d7) || !windowSampleIsValid(previous, WINDOW_SAMPLE_POLICY.d7)) {
    return { passes: false, currentSpend: current.spend, previousSpend: previous.spend, currentCpa: current.cpa, target: goal?.targetCostPerResult ?? null };
  }
  if (!goal || goal.targetCostPerResult === null || !goal.scopeComparable) {
    return { passes: false, currentSpend: current.spend, previousSpend: previous.spend, currentCpa: current.cpa, target: null };
  }
  if (previous.spend === 0 || current.cpa === null) {
    return { passes: false, currentSpend: current.spend, previousSpend: previous.spend, currentCpa: current.cpa, target: goal.targetCostPerResult };
  }

  const growthPct = (current.spend - previous.spend) / previous.spend;
  const withinTarget = current.cpa <= goal.targetCostPerResult * (1 + SCALE_MAX_CPA_DETERIORATION_PCT);

  return {
    passes: growthPct >= SCALE_MIN_INVESTMENT_GROWTH_PCT && withinTarget,
    currentSpend: current.spend,
    previousSpend: previous.spend,
    currentCpa: current.cpa,
    target: goal.targetCostPerResult,
  };
}

export function ruleScaleInvestmentGrowthWithEfficiency(ctx: ClientAchievementContext): AchievementCandidate | null {
  const today = scaleEfficientAsOf(ctx, ctx.yesterday);
  if (!today.passes) return null;
  const prior = scaleEfficientAsOf(ctx, addDays(ctx.yesterday, -1));
  if (prior.passes) return null;

  const growthPct = today.previousSpend > 0 ? (today.currentSpend - today.previousSpend) / today.previousSpend : 0;

  return {
    type: "client_scale_investment_growth_with_efficiency",
    scope: "client",
    family: "escala",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `scale:${ctx.yesterday}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "investment",
      actual: today.currentSpend,
      unit: "currency",
      comparisonActual: today.previousSpend,
      target: today.target ?? undefined,
      windowEnd: ctx.yesterday,
      windowStart: addDays(ctx.yesterday, -6),
      comparisonWindowStart: addDays(ctx.yesterday, -13),
      comparisonWindowEnd: addDays(ctx.yesterday, -7),
    },
    headline: `${ctx.clientName} escalou investimento mantendo eficiência`,
    detail:
      today.currentCpa !== null && today.target
        ? `Investimento aumentou ${formatPercent(growthPct * 100)} e o CPA continuou dentro da meta (${formatCurrency(today.currentCpa)} · meta ${formatCurrency(today.target)})`
        : `Investimento aumentou ${formatPercent(growthPct * 100)} mantendo o CPA dentro da meta`,
  };
}

// ---------------------------------------------------------------------------
// RECUPERAÇÃO — CPA só (mesma razão da Consistência: sem meta de ROAS).
// Sequência ruim mínima + confirmação mínima (determinação de aprovação
// nº4/seção 9 da Auditoria) — nunca 1 dia isolado.
// ---------------------------------------------------------------------------

export function ruleRecoveryCpaBackWithinTarget(ctx: ClientAchievementContext): AchievementCandidate | null {
  const days = buildCpaStreakDays(ctx);
  const result = scanBackwardRecovery(days, RECOVERY_MIN_BAD_STREAK_DAYS, RECOVERY_MIN_CONFIRMATION_DAYS);
  if (!result.recovered || !result.confirmedOnDate) return null;

  // Só emite no dia exato em que a confirmação atingiu o mínimo — não em
  // todo dia subsequente que a recuperação se mantém.
  if (result.confirmedOnDate !== ctx.yesterday) return null;

  const goal = monthGoal(ctx, ctx.yesterday);
  const point = pointsMap(ctx).get(ctx.yesterday);
  const cpaToday = point ? dailyCpa(point) : null;

  return {
    type: "client_recovery_cpa_back_within_target",
    scope: "client",
    family: "recuperacao",
    severity: "highlight",
    occurredOnDate: ctx.yesterday,
    windowKey: `recovery_cpa:${result.badStreakStartDate}`,
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    metric: {
      metric: "cpa",
      actual: cpaToday ?? 0,
      unit: "currency",
      target: goal?.targetCostPerResult ?? null,
      windowStart: result.badStreakStartDate ?? undefined,
      windowEnd: ctx.yesterday,
    },
    headline: `Performance recuperada`,
    detail:
      cpaToday !== null && goal?.targetCostPerResult
        ? `Depois de um período acima da meta, o CPA da ${ctx.clientName} voltou para ${formatCurrency(cpaToday)}, abaixo da meta de ${formatCurrency(goal.targetCostPerResult)}`
        : `O CPA da ${ctx.clientName} voltou a ficar dentro da meta após um período acima dela`,
  };
}

export const CLIENT_RULES: ((ctx: ClientAchievementContext) => AchievementCandidate | null)[] = [
  ruleRecordBestCpaWeek,
  ruleRecordBestRoasWeek,
  ruleRecordBestResultsWeek,
  ruleRecordBestMonthClosed,
  ruleRecordCurrentMonthPaceBeatsHistory,
  ruleGoalMonthlyResultReached,
  ruleConsistencyCpaBelowTarget,
  ruleEvolutionCpaImproved,
  ruleEvolutionRoasGrowth,
  ruleScaleInvestmentGrowthWithEfficiency,
  ruleRecoveryCpaBackWithinTarget,
];
