import { listDatesInclusive, computeMonthlyExpectedToDateByCalendar, computeNeededDailyRate } from "@/lib/monthly-budget";
import { safeDivide } from "@/lib/performance";
import { evaluateMetricDiagnostic, evaluateCpaDiagnostic, type MetricTone, type MetricDeviationSensitivity } from "@/lib/metric-diagnostics";

/**
 * Núcleo puro da tabela "RESUMO DAS METAS" (Etapa "MEGA FACELIFT — Fase 2:
 * Metas") — sem Supabase, sem Next, testável isoladamente (mesmo padrão de
 * `lib/client-plan.ts`/`lib/goal-spend.ts`). A regra central deste módulo
 * (seção 5 do pedido): métrica CUMULATIVA (Resultado/Investimento/
 * Faturamento) e métrica de RAZÃO (CPA/CPL/ROAS) nunca passam pela mesma
 * matemática — são duas funções builder deliberadamente separadas, nunca
 * um `if` dentro de uma função genérica tentando servir as duas.
 *
 * Diagnóstico de cor reaproveita SÓ `lib/metric-diagnostics.ts`
 * (`evaluateMetricDiagnostic`/`evaluateCpaDiagnostic`) — nenhum motor novo,
 * nenhum threshold inventado aqui (seção 8 do pedido).
 */

export type MetasRowUnit = "currency" | "count" | "ratio_x";

export interface MetasDayCell {
  date: string;
  /** `null` = sem dado real nesse dia — nunca um valor fabricado. Cobre
   * tanto "dia sem granularidade diária disponível" quanto "dia futuro de
   * uma linha de razão" (CPA/CPL/ROAS nunca têm ritmo necessário). */
  value: number | null;
  isFuture: boolean;
  /** Só `true` nos dias futuros de uma linha CUMULATIVA com meta
   * calculável — `value`, nesse caso, é a MESMA taxa flat repetida em cada
   * dia futuro (nunca um número diferente por dia: "ritmo necessário" é
   * uma constante pros dias restantes, não uma previsão dia a dia). */
  isNeededRate: boolean;
}

export interface MetasRow {
  key: string;
  label: string;
  unit: MetasRowUnit;
  /** "Meta do mês" — `null` quando não existe meta configurada pra esta
   * linha/objetivo (nunca 0 fabricado; ver auditoria seção 9 — objetivo
   * secundário nunca tem meta de INVESTIMENTO real, por exemplo). */
  targetMonth: number | null;
  /** "Realizado" (acumulado até hoje, ou total do mês se já encerrado) —
   * `null` só quando o dado é genuinamente indisponível (nunca 0 pra
   * disfarçar ausência). */
  realizedMonth: number | null;
  tone: MetricTone;
  /** Motivo de indisponibilidade pra linhas de razão (cobertura de
   * classificação incompleta, sem campanha classificada etc.) — `null`
   * quando o valor está disponível ou quando a linha nunca teve meta pra
   * começo (Faturamento/ROAS). */
  unavailableNote: string | null;
  days: MetasDayCell[];
}

function buildDayCellsForCumulative(
  dates: string[],
  todayStr: string,
  dailyValues: Map<string, number> | null,
  neededDailyRate: number | null,
): MetasDayCell[] {
  return dates.map((date) => {
    const isFuture = date > todayStr;
    if (!isFuture) {
      return { date, value: dailyValues?.get(date) ?? null, isFuture, isNeededRate: false };
    }
    return { date, value: neededDailyRate, isFuture, isNeededRate: neededDailyRate !== null };
  });
}

function buildDayCellsForRatio(
  dates: string[],
  todayStr: string,
  dailyNumerator: Map<string, number> | null,
  dailyDenominator: Map<string, number> | null,
): MetasDayCell[] {
  return dates.map((date) => {
    const isFuture = date > todayStr;
    // Razão nunca tem "ritmo necessário" (não há fórmula matemática segura
    // pra "CPA necessário dos próximos dias") — dia futuro é sempre "—".
    if (isFuture) return { date, value: null, isFuture, isNeededRate: false };
    const numerator = dailyNumerator?.get(date) ?? null;
    const denominator = dailyDenominator?.get(date) ?? null;
    return { date, value: safeDivide(numerator, denominator), isFuture, isNeededRate: false };
  });
}

export interface BuildCumulativeRowInput {
  key: string;
  label: string;
  unit: "currency" | "count";
  monthRange: { firstDay: string; lastDay: string };
  todayStr: string;
  /** `getRemainingEligibleDaysIncludingToday` já resolvido por quem chama
   * — nunca recalculado aqui. */
  eligibleDaysCount: number;
  targetMonth: number | null;
  realizedMonth: number;
  /** `false` = nenhum registro existe pro escopo (distinto de "existe
   * registro, soma é 0") — `realizedMonth` sai como `null` nesse caso. */
  hasRealizedData: boolean;
  /** `null` = granularidade diária genuinamente indisponível pra esta
   * linha/objetivo (cliente manual sem sincronização) — todo dia passado
   * também vira "—", nunca uma distribuição inventada do total mensal. */
  dailyValues: Map<string, number> | null;
  sensitivity: MetricDeviationSensitivity;
}

export function buildCumulativeRow(input: BuildCumulativeRowInput): MetasRow {
  const dates = listDatesInclusive(input.monthRange.firstDay, input.monthRange.lastDay);
  const expectedToDate =
    input.targetMonth !== null
      ? computeMonthlyExpectedToDateByCalendar(input.targetMonth, input.monthRange, input.todayStr).expectedToDate
      : null;
  const diagnostic = input.hasRealizedData ? evaluateMetricDiagnostic(input.realizedMonth, expectedToDate, input.sensitivity) : null;
  const neededDailyRate = computeNeededDailyRate(input.targetMonth, input.realizedMonth, input.eligibleDaysCount);

  return {
    key: input.key,
    label: input.label,
    unit: input.unit,
    targetMonth: input.targetMonth,
    realizedMonth: input.hasRealizedData ? input.realizedMonth : null,
    tone: diagnostic?.tone ?? "normal",
    unavailableNote: null,
    days: buildDayCellsForCumulative(dates, input.todayStr, input.dailyValues, neededDailyRate),
  };
}

export interface BuildRatioRowInput {
  key: string;
  label: string;
  unit: "currency" | "ratio_x";
  monthRange: { firstDay: string; lastDay: string };
  todayStr: string;
  targetMonth: number | null;
  realizedMonth: number | null;
  /** Só usado quando `diagnosticKind === "cpa"` (amostra mínima de
   * `evaluateCpaDiagnostic`). */
  resultCountForReliability?: number;
  /** `"cpa"` reaproveita `evaluateCpaDiagnostic` (único eixo de razão com
   * regra de cor já existente); `"none"` nunca aplica cor — ROAS/Faturamento
   * não têm meta nem regra determinística de bom/ruim, então o valor
   * aparece sem classificação (seção 8 do pedido). */
  diagnosticKind: "cpa" | "none";
  unavailableNote: string | null;
  dailyNumerator: Map<string, number> | null;
  dailyDenominator: Map<string, number> | null;
}

export function buildRatioRow(input: BuildRatioRowInput): MetasRow {
  const dates = listDatesInclusive(input.monthRange.firstDay, input.monthRange.lastDay);
  const diagnostic =
    input.diagnosticKind === "cpa" ? evaluateCpaDiagnostic(input.realizedMonth, input.targetMonth, input.resultCountForReliability ?? 0) : null;

  return {
    key: input.key,
    label: input.label,
    unit: input.unit,
    targetMonth: input.targetMonth,
    realizedMonth: input.realizedMonth,
    tone: diagnostic?.tone ?? "normal",
    unavailableNote: input.unavailableNote,
    days: buildDayCellsForRatio(dates, input.todayStr, input.dailyNumerator, input.dailyDenominator),
  };
}

/** Agrupa valores diários (dinheiro OU contagem) por data, somando quando
 * mais de uma linha cair no mesmo dia (vários canais) — núcleo único de
 * agregação por dia, reaproveitado tanto pra Investimento (`daily_spend`)
 * quanto pra Resultado/Faturamento (`daily_performance`), nunca duas
 * implementações do mesmo "somar por data" espalhadas pelo loader. */
export function sumByDate(rows: { date: string; value: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date, (map.get(row.date) ?? 0) + row.value);
  }
  return map;
}
