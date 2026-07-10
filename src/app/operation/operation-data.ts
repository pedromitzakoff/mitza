import { computeSprintFinancials, currentMonthRange, type SprintFinancials } from "@/lib/sprint-financials";
import { classifySpendStatus } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { buildAttentionAlerts, computeAccountHealth, type AttentionAlert, type AccountHealth } from "@/lib/attention-alerts";
import { buildSprintExecutionAlert } from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import {
  classifyOperationalActivityStatus,
  formatLastActivityLabel,
  type OperationalActivityStatus,
} from "@/lib/operational-activity";
import type { TaskListItem } from "@/app/clients/task-row";

const OPTIMIZATION_LOOKBACK_DAYS = 14;

export type OperationMode = "hoje" | "sprint" | "todos";
export type SprintFilterBucket = "atrasadas" | "sem_execucao" | "em_dia" | "sem_sprint";

export type OperationTaskItem = TaskListItem & { sprint_id: string | null; notes: string | null };

export interface OperationClientRawData {
  id: string;
  name: string;
  metaAdAccountId: string;
  managerNames: string[];
  managerIds: string[];
  sprints: { id: string; start_date: string; end_date: string; planned_spend: number }[];
  dailySpend: { date: string; spend: number }[];
  tasks: OperationTaskItem[];
  clientLastActivityAt: string | null;
  sprintLastActivityAt: string | null;
}

export interface OperationClientCard {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  managerIds: string[];
  sprint: SprintFinancials | null;
  sprintNumber: number | null;
  sprintTasks: OperationTaskItem[];
  todayAndOverdueTasks: OperationTaskItem[];
  taskCounts: { total: number; done: number; pending: number; overdue: number };
  alerts: AttentionAlert[];
  accountHealth: AccountHealth;
  activityStatus: OperationalActivityStatus;
  activityLabel: string;
  sprintFilterBucket: SprintFilterBucket;
}

/** Monta o card operacional de um cliente a partir dos dados já buscados
 * em lote (nunca uma query por cliente) — reaproveita as mesmas funções
 * puras da página individual do cliente. */
export function buildOperationClientCard(client: OperationClientRawData, today: Date): OperationClientCard {
  const todayStr = today.toISOString().slice(0, 10);
  const { firstDay, lastDay } = currentMonthRange(today);

  const currentSprintRow = client.sprints.find(
    (s) => s.start_date <= todayStr && s.end_date >= todayStr,
  );

  let sprint: SprintFinancials | null = null;
  let sprintNumber: number | null = null;
  let sprintTasks: OperationTaskItem[] = [];

  if (currentSprintRow) {
    const actualSpend = client.dailySpend
      .filter((d) => d.date >= currentSprintRow.start_date && d.date <= currentSprintRow.end_date)
      .reduce((sum, d) => sum + d.spend, 0);
    sprint = computeSprintFinancials(currentSprintRow, actualSpend, today);
    sprintNumber =
      client.sprints.filter((s) => s.start_date <= currentSprintRow.start_date).length;
    sprintTasks = client.tasks.filter((t) => t.sprint_id === currentSprintRow.id);
  }

  const monthTasks = client.tasks.filter((t) => t.due_date >= firstDay && t.due_date <= lastDay);
  const monthSprints = client.sprints.filter((s) => s.start_date >= firstDay && s.start_date <= lastDay);
  const monthPlanned = monthSprints.reduce((sum, s) => sum + s.planned_spend, 0);
  const monthActual = client.dailySpend
    .filter((d) => d.date >= firstDay && d.date <= lastDay)
    .reduce((sum, d) => sum + d.spend, 0);
  const monthStatus = classifySpendStatus(monthActual, monthPlanned, monthPlanned);

  const taskCounts = { total: 0, done: 0, pending: 0, overdue: 0 };
  for (const task of monthTasks) {
    const status = effectiveTaskStatus(task, today);
    if (status === "feito") taskCounts.done++;
    else if (status === "atrasado") taskCounts.overdue++;
    else taskCounts.pending++;
    taskCounts.total++;
  }

  const lookbackStart = new Date(today.getTime() - OPTIMIZATION_LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recentOptimizationTasks = client.tasks.filter(
    (t) => t.type === "otimizacao" && t.due_date >= lookbackStart && t.due_date <= todayStr,
  );
  const optimizationRecentlyDone =
    recentOptimizationTasks.length === 0 ||
    recentOptimizationTasks.some((t) => effectiveTaskStatus(t, today) === "feito");

  const lastActivityDate = client.clientLastActivityAt ? new Date(client.clientLastActivityAt) : null;
  const clientInactivityBusinessDays = lastActivityDate
    ? businessDaysSince(lastActivityDate, today)
    : null;
  const activityStatus = classifyOperationalActivityStatus(clientInactivityBusinessDays);
  const activityLabel = formatLastActivityLabel(lastActivityDate, today);

  const alerts = buildAttentionAlerts({
    monthStatus,
    overdueTasksCount: taskCounts.overdue,
    optimizationRecentlyDone,
    lastSyncedAt: null,
    currentSprintPlannedSpend: sprint?.plannedSpend ?? null,
    currentSprintTaskCount: sprintTasks.length,
    currentSprintUnassignedCount: sprintTasks.filter((t) => !t.assignee).length,
    clientInactivityBusinessDays,
    now: today,
  });

  const sprintLastActivityDate = client.sprintLastActivityAt
    ? new Date(client.sprintLastActivityAt)
    : null;
  const sprintExecutionAlert = sprint
    ? buildSprintExecutionAlert(sprint, sprintLastActivityDate, today)
    : null;

  const allAlerts = sprintExecutionAlert ? [...alerts, sprintExecutionAlert] : alerts;
  const accountHealth = computeAccountHealth(allAlerts);

  const todayAndOverdueTasks = client.tasks.filter((t) => {
    const status = effectiveTaskStatus(t, today);
    return status === "atrasado" || (t.due_date === todayStr && status !== "feito");
  });

  let sprintFilterBucket: SprintFilterBucket = "sem_sprint";
  if (sprint) {
    if (sprintTasks.some((t) => effectiveTaskStatus(t, today) === "atrasado")) {
      sprintFilterBucket = "atrasadas";
    } else if (sprintExecutionAlert) {
      sprintFilterBucket = "sem_execucao";
    } else {
      sprintFilterBucket = "em_dia";
    }
  }

  return {
    clientId: client.id,
    clientName: client.name,
    metaAdAccountId: client.metaAdAccountId,
    managerNames: client.managerNames,
    managerIds: client.managerIds,
    sprint,
    sprintNumber,
    sprintTasks,
    todayAndOverdueTasks,
    taskCounts,
    alerts: allAlerts,
    accountHealth,
    activityStatus,
    activityLabel,
    sprintFilterBucket,
  };
}

export function matchesOperationMode(card: OperationClientCard, mode: OperationMode): boolean {
  if (mode !== "hoje") return true;
  return (
    card.todayAndOverdueTasks.length > 0 ||
    card.activityStatus !== "ativo" ||
    card.sprintFilterBucket === "sem_execucao"
  );
}
