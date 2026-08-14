import { todayUTC } from "@/lib/today";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { resolveDaysElapsedInRange } from "@/lib/monthly-budget";
import type { TaskStatus } from "@/lib/supabase/database.types";

export interface MonthProjection {
  /** Projeção de gasto ao final do mês, pelo ritmo (run-rate) até agora. */
  projectedSpend: number;
  /** % da projeção em relação ao planejado do mês (null se não houver planejado). */
  projectedPct: number | null;
  status: SpendStatus;
}

/**
 * Projeta o gasto de fim de período extrapolando o ritmo diário observado
 * até hoje (gasto até agora / dias já passados / dias totais do período).
 * `monthRange` é sempre o intervalo já resolvido por quem chama — mês civil
 * pra cliente normal, ou `resolvePlanningHorizon` (lib/monthly-budget.ts,
 * Etapa "Horizonte de Planejamento") pra cliente de evento, nunca decidido
 * aqui. Dias decorridos são contados dentro do próprio intervalo: 0 se ainda
 * não começou (futuro), o intervalo inteiro se já terminou (passado,
 * projeção = realizado final).
 */
export function computeMonthProjectionForRange(
  monthPlanned: number,
  monthActualSoFar: number,
  monthRange: { firstDay: string; lastDay: string },
  today: Date = todayUTC(),
): MonthProjection {
  // `today` é sempre meia-noite UTC do dia civil já resolvido (contrato de
  // `todayUTC()`, respeitado por todo caller conhecido) — a conversão pra
  // string aqui é uma fatia direta do ISO, NUNCA `todayDateString()` de
  // novo (reconverteria pelo fuso da agência uma segunda vez e empurraria a
  // data um dia pra trás — mesmo bug já documentado em
  // `formatRelativeDateTime`, lib/format.ts).
  const todayStr = today.toISOString().slice(0, 10);
  const { daysElapsed, daysInMonth } = resolveDaysElapsedInRange(monthRange, todayStr);

  const projectedSpend = daysElapsed > 0 ? (monthActualSoFar / daysElapsed) * daysInMonth : 0;
  const status = classifySpendStatus(projectedSpend, monthPlanned, monthPlanned);
  const projectedPct = monthPlanned > 0 ? (projectedSpend / monthPlanned) * 100 : null;

  return { projectedSpend, projectedPct, status };
}

export interface TaskCounts {
  total: number;
  done: number;
  pending: number;
  overdue: number;
}

/** Conta tarefas por status efetivo (feito / atrasado / pendente). */
export function computeTaskCounts(
  tasks: { status: TaskStatus; due_date: string }[],
  today: Date = todayUTC(),
): TaskCounts {
  let done = 0;
  let pending = 0;
  let overdue = 0;

  for (const task of tasks) {
    const effective = effectiveTaskStatus(task, today);
    if (effective === "feito") done++;
    else if (effective === "atrasado") overdue++;
    else pending++;
  }

  return { total: tasks.length, done, pending, overdue };
}
