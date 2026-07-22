import type {
  KpiDirection,
  KpiUnit,
  MonthlyReportStatus,
  ReportActionItemDependency,
  TaskRecurrence,
  TaskStatus,
  TaskType,
} from "@/lib/supabase/database.types";
import { effectiveTaskStatus } from "@/lib/task-status";
import { formatCurrency } from "@/lib/format";
import type { SpendStatus } from "@/lib/spend-status";
import {
  classifySprintSpendStatus,
  computeSprintExpectedToDate,
  computeSprintMonthActualSpend,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { KPI_TARGET_STATUS_REGISTRY, MONTHLY_REPORT_STATUS_REGISTRY } from "@/lib/status-registry";

/** Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1 — `em_andamento` agora é "Relatório em andamento"
 * (qualificado: o mesmo valor de enum também existe, com outro
 * significado, em `SpendStatus` e `ReportActionItemStatus`). */
export const MONTHLY_REPORT_STATUS_LABEL: Record<MonthlyReportStatus, string> = {
  nao_iniciado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.nao_iniciado"].label,
  em_andamento: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.em_andamento"].label,
  pronto_revisao: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.pronto_revisao"].label,
  finalizado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.finalizado"].label,
};

export const MONTHLY_REPORT_STATUS_BADGE_CLASSES: Record<MonthlyReportStatus, string> = {
  nao_iniciado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.nao_iniciado"].badgeClassName,
  em_andamento: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.em_andamento"].badgeClassName,
  pronto_revisao: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.pronto_revisao"].badgeClassName,
  finalizado: MONTHLY_REPORT_STATUS_REGISTRY["monthly_report.finalizado"].badgeClassName,
};

export const KPI_UNIT_LABEL: Record<KpiUnit, string> = {
  numero: "Número",
  moeda: "Moeda (R$)",
  percentual: "Percentual (%)",
};

export const KPI_DIRECTION_LABEL: Record<KpiDirection, string> = {
  maior_melhor: "Maior é melhor",
  menor_melhor: "Menor é melhor",
};

/** Formata o valor de um KPI conforme a unidade configurada — nunca um
 * número cru sem contexto (R$, %, ou só o número, conforme o cliente
 * configurou aquele KPI). */
export function formatKpiValue(value: number | null, unit: KpiUnit): string {
  if (value === null) return "—";
  if (unit === "moeda") return formatCurrency(value);
  if (unit === "percentual") return `${value}%`;
  return new Intl.NumberFormat("pt-BR").format(value);
}

export type KpiTargetStatus = "atingiu" | "abaixo" | "sem_meta";

/** "Situação" do KPI (Bloco 2) — bateu a meta ou não, respeitando a direção
 * configurada (CPL/CPA: menor é melhor; Leads/ROAS/Vendas: maior é melhor).
 * Sem meta configurada, não inventa situação nenhuma. */
export function classifyKpiTargetStatus(
  result: number | null,
  target: number | null,
  direction: KpiDirection,
): KpiTargetStatus {
  if (result === null || target === null) return "sem_meta";
  const hit = direction === "maior_melhor" ? result >= target : result <= target;
  return hit ? "atingiu" : "abaixo";
}

/** Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1. */
export const KPI_TARGET_STATUS_LABEL: Record<KpiTargetStatus, string> = {
  atingiu: KPI_TARGET_STATUS_REGISTRY["kpi_target.atingiu"].label,
  abaixo: KPI_TARGET_STATUS_REGISTRY["kpi_target.abaixo"].label,
  sem_meta: KPI_TARGET_STATUS_REGISTRY["kpi_target.sem_meta"].label,
};

export const KPI_TARGET_STATUS_BADGE_CLASSES: Record<KpiTargetStatus, string> = {
  atingiu: KPI_TARGET_STATUS_REGISTRY["kpi_target.atingiu"].badgeClassName,
  abaixo: KPI_TARGET_STATUS_REGISTRY["kpi_target.abaixo"].badgeClassName,
  sem_meta: KPI_TARGET_STATUS_REGISTRY["kpi_target.sem_meta"].badgeClassName,
};

/** Variação percentual entre o resultado do mês e o do mês anterior — não
 * carrega direção (bom/ruim): "Situação" (acima) já cobre isso; aqui é só a
 * comparação objetiva pedida na tabela do Bloco 2. */
export function computeKpiVariationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export interface AgencyExecutionSummary {
  optimizationsDone: number;
  meetingsDone: number;
  creativeDeliveriesDone: number;
  operationalTasksDone: number;
  overdueTasks: number;
  /** Tarefas recorrentes (diária/semanal/mensal) do mês que não foram
   * concluídas — a cadência combinada não foi cumprida. */
  missedCadences: number;
}

/** Bloco 3 ("Execução da agência") — resumo operacional do mês, nunca a
 * lista completa de tarefas (isso fica atrás de "Ver execução completa").
 * Reuniões/entregas/tarefas reaproveitam `tasks.type`/`recurrence`/
 * `effectiveTaskStatus` já existentes — nenhum dado novo, só uma leitura
 * agregada. `optimizationsCount` (Etapa 74) já vem pronto de quem chama —
 * é a contagem de otimizações (account_reviews.reviewed_at, a revisão
 * estratégica da conta) do mês, nunca mais derivado da tarefa recorrente
 * "otimizacao" (desativada desde a Etapa 57 e nunca migrada pra este
 * resumo, o que o deixava sempre zerado). */
export function computeAgencyExecutionSummary(
  monthTasks: { type: TaskType; status: TaskStatus; due_date: string; recurrence: TaskRecurrence }[],
  today: Date,
  optimizationsCount: number,
): AgencyExecutionSummary {
  const summary: AgencyExecutionSummary = {
    optimizationsDone: optimizationsCount,
    meetingsDone: 0,
    creativeDeliveriesDone: 0,
    operationalTasksDone: 0,
    overdueTasks: 0,
    missedCadences: 0,
  };

  for (const task of monthTasks) {
    const status = effectiveTaskStatus(task, today);

    if (status === "feito") {
      summary.operationalTasksDone++;
      if (task.type === "reuniao") summary.meetingsDone++;
      if (task.type === "entrega_criativo") summary.creativeDeliveriesDone++;
    } else if (status === "atrasado") {
      summary.overdueTasks++;
      if (task.recurrence !== "nenhuma") summary.missedCadences++;
    }
  }

  return summary;
}

export const REPORT_ACTION_ITEM_DEPENDENCY_LABEL: Record<ReportActionItemDependency, string> = {
  agencia: "Agência",
  cliente: "Cliente",
  terceiro: "Terceiro",
};

/** Bloco "Comportamento por sprint" — uma linha por sprint do mês, cada uma
 * usando as mesmas funções financeiras centrais de sempre (nunca um cálculo
 * paralelo pro relatório). `executionPct` é a taxa de conclusão das tarefas
 * daquela sprint específica (não do mês inteiro, que já é o Bloco 3). */
export interface SprintBehaviorRow {
  sprintId: string;
  periodLabel: string;
  planned: number;
  actual: number;
  pct: number | null;
  status: SpendStatus;
  executionPct: number | null;
}

export function computeSprintBehaviorRows(
  sprints: { id: string; start_date: string; end_date: string; planned_spend: number; spend_source: "manual" | "meta_api"; manual_actual_spend: number | null }[],
  plannedAllocations: { sprintId: string; amount: number }[],
  dailySpend: { date: string; spend: number }[],
  tasks: { sprint_id: string | null; status: TaskStatus; due_date: string; recurrence: TaskRecurrence }[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): SprintBehaviorRow[] {
  return [...sprints]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((sprint) => {
      const planned = plannedAllocations
        .filter((a) => a.sprintId === sprint.id)
        .reduce((sum, a) => sum + a.amount, 0);
      const actual = computeSprintMonthActualSpend(sprint, monthRange, dailySpend);
      const expectedToDate = computeSprintExpectedToDate(sprint, today);
      const status = classifySprintSpendStatus(sprint, actual, expectedToDate, planned, today);
      const pct = planned > 0 ? (actual / planned) * 100 : null;

      const sprintTasks = tasks.filter((t) => t.sprint_id === sprint.id);
      const doneCount = sprintTasks.filter((t) => effectiveTaskStatus(t, today) === "feito").length;
      const executionPct = sprintTasks.length > 0 ? (doneCount / sprintTasks.length) * 100 : null;

      return {
        sprintId: sprint.id,
        periodLabel: formatSprintPeriodLabel(sprint.start_date, sprint.end_date),
        planned,
        actual,
        pct,
        status,
        executionPct,
      };
    });
}
