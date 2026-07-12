import type {
  KpiDirection,
  KpiUnit,
  MonthlyReportStatus,
  TaskRecurrence,
  TaskStatus,
  TaskType,
} from "@/lib/supabase/database.types";
import { effectiveTaskStatus } from "@/lib/task-status";
import { formatCurrency } from "@/lib/format";

export const MONTHLY_REPORT_STATUS_LABEL: Record<MonthlyReportStatus, string> = {
  nao_iniciado: "Não iniciado",
  em_andamento: "Em andamento",
  pronto_revisao: "Pronto para revisão",
  finalizado: "Finalizado",
};

export const MONTHLY_REPORT_STATUS_BADGE_CLASSES: Record<MonthlyReportStatus, string> = {
  nao_iniciado: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  em_andamento: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  pronto_revisao: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  finalizado: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
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

export const KPI_TARGET_STATUS_LABEL: Record<KpiTargetStatus, string> = {
  atingiu: "Bateu meta",
  abaixo: "Abaixo da meta",
  sem_meta: "Sem meta",
};

export const KPI_TARGET_STATUS_BADGE_CLASSES: Record<KpiTargetStatus, string> = {
  atingiu: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  sem_meta: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** Variação percentual entre o resultado do mês e o do mês anterior — não
 * carrega direção (bom/ruim): "Situação" (acima) já cobre isso; aqui é só a
 * comparação objetiva pedida na tabela do Bloco 2. */
export function computeKpiVariationPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** "Hoje"/"Ontem"/"Há N dias"/"Nunca" — dias corridos (não úteis, diferente
 * de `formatLastActivityLabel`) porque é assim que o pedido da Visão Geral
 * (coluna "Última otimização") descreveu o rótulo. Nunca colore em
 * vermelho automaticamente (seção 19): sem uma regra de cadência de
 * otimização definida além do lookback de 14 dias já usado em
 * `buildAttentionAlerts`, este rótulo fica neutro — a urgência de "otimização
 * vencida" já aparece separadamente em `getClientPriority`. */
export function formatLastOptimizationLabel(lastOptimizationAt: string | null, today: Date): string {
  if (!lastOptimizationAt) return "Nunca";
  const diffDays = Math.floor(
    (today.getTime() - new Date(`${lastOptimizationAt}T00:00:00Z`).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return `Há ${diffDays} dias`;
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
 * Cada contagem reaproveita `tasks.type`/`recurrence`/`effectiveTaskStatus`
 * já existentes — nenhum dado novo, só uma leitura agregada. */
export function computeAgencyExecutionSummary(
  monthTasks: { type: TaskType; status: TaskStatus; due_date: string; recurrence: TaskRecurrence }[],
  today: Date,
): AgencyExecutionSummary {
  const summary: AgencyExecutionSummary = {
    optimizationsDone: 0,
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
      if (task.type === "otimizacao") summary.optimizationsDone++;
      if (task.type === "reuniao") summary.meetingsDone++;
      if (task.type === "entrega_criativo") summary.creativeDeliveriesDone++;
    } else if (status === "atrasado") {
      summary.overdueTasks++;
      if (task.recurrence !== "nenhuma") summary.missedCadences++;
    }
  }

  return summary;
}
