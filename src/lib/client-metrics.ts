import { todayUTC } from "@/lib/today";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import type { TaskStatus } from "@/lib/supabase/database.types";

export interface MonthProjection {
  /** Projeção de gasto ao final do mês, pelo ritmo (run-rate) até agora. */
  projectedSpend: number;
  /** % da projeção em relação ao planejado do mês (null se não houver planejado). */
  projectedPct: number | null;
  status: SpendStatus;
}

/**
 * Projeta o gasto de fim de mês extrapolando o ritmo diário observado até
 * hoje (gasto até agora / dias já passados no mês) para os dias restantes.
 */
export function computeMonthProjection(
  monthPlanned: number,
  monthActualSoFar: number,
  today: Date = todayUTC(),
): MonthProjection {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(year, month, daysInMonth)).toISOString().slice(0, 10);
  return computeMonthProjectionForRange(monthPlanned, monthActualSoFar, { firstDay, lastDay }, today);
}

/**
 * Mesma projeção por ritmo, mas para um mês qualquer (não necessariamente o
 * mês corrente) — usado pelo dashboard da agência, que respeita o mês
 * selecionado no filtro. Dias decorridos são contados dentro do próprio
 * intervalo: 0 se o mês ainda não começou (mês futuro), o mês inteiro se já
 * terminou (mês passado, projeção = realizado final).
 */
export function computeMonthProjectionForRange(
  monthPlanned: number,
  monthActualSoFar: number,
  monthRange: { firstDay: string; lastDay: string },
  today: Date = todayUTC(),
): MonthProjection {
  const start = new Date(`${monthRange.firstDay}T00:00:00Z`);
  const end = new Date(`${monthRange.lastDay}T00:00:00Z`);
  const daysInMonth = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const daysElapsed =
    today < start ? 0 : today > end ? daysInMonth : Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;

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
