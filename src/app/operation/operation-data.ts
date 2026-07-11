import {
  computeSprintEffectiveSpend,
  computeSprintFinancials,
  currentMonthRange,
  sumEffectiveSpend,
  sumExpectedToDate,
  type SprintFinancials,
  type SpendSource,
} from "@/lib/sprint-financials";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { effectiveTaskStatus } from "@/lib/task-status";
import { buildAttentionAlerts, computeAccountHealth, type AttentionAlert, type AccountHealth } from "@/lib/attention-alerts";
import {
  buildSprintExecutionAlert,
  computeSprintExecutionInfo,
  formatSprintExecutionLabel,
  type SprintExecutionInfo,
} from "@/lib/sprint-execution";
import { businessDaysSince } from "@/lib/business-days";
import {
  classifyOperationalActivityStatus,
  formatLastActivityLabel,
  type OperationalActivityStatus,
} from "@/lib/operational-activity";
import type { TaskListItem } from "@/app/clients/task-row";

const OPTIMIZATION_LOOKBACK_DAYS = 14;

export type SprintFilterBucket = "atrasadas" | "sem_execucao" | "em_dia" | "sem_sprint";

export type OperationTaskItem = TaskListItem & { sprint_id: string | null; notes: string | null };

export interface OperationClientRawData {
  id: string;
  name: string;
  metaAdAccountId: string;
  managerNames: string[];
  managerIds: string[];
  sprints: {
    id: string;
    start_date: string;
    end_date: string;
    planned_spend: number;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[];
  dailySpend: { date: string; spend: number }[];
  tasks: OperationTaskItem[];
  clientLastActivityAt: string | null;
  sprintLastActivityAt: string | null;
  lastSyncedAt: string | null;
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
  monthPlanned: number;
  monthActual: number;
  /** Soma do esperado até hoje de cada sprint do mês (dias corridos já
   * decorridos dentro de cada sprint) — mesma conta usada no cartão da
   * sprint individual, nunca uma regra paralela. */
  monthExpectedToDate: number;
  monthStatus: SpendStatus;
  hasMonthGoal: boolean;
  /** Prazo da otimização concluída mais recente (qualquer mês), ou null se
   * nunca houve uma. */
  lastOptimizationAt: string | null;
  lastSyncedAt: string | null;
  /** Tarefas do mês selecionado com status efetivo "atrasado" — usado pela
   * Central de Atenção (Visão Geral) pra agrupar por cliente sem precisar
   * de uma query nova (mesmo `monthTasks` já calculado abaixo). */
  overdueTasks: { id: string; due_date: string }[];
  /** Mesma regra de "sprint sem execução" de sempre — null se a sprint
   * atual não está sem execução (ou não há sprint atual). */
  sprintExecutionInfo: SprintExecutionInfo | null;
  /** Todas as sprints do mês selecionado (não só a atual), na ordem do
   * calendário — usado pelo resumo expansível da visão Mensal da tela
   * Sprints. Reaproveita computeSprintFinancials pra cada uma, nunca
   * duplica a conta de planejado/realizado/esperado. */
  monthSprints: SprintFinancials[];
  /** Tarefas de cada sprint do mês, por sprintId — pra montar o mesmo
   * SprintCard da página do cliente pra qualquer sprint do mês (não só a
   * atual), sem duplicar o filtro de tarefas por sprint. */
  monthSprintTasks: Record<string, OperationTaskItem[]>;
  /** Mesmo texto ("Hoje"/"Ontem"/"Há N dias úteis") que a página do cliente
   * mostra em "Última execução da sprint" — null se não há sprint atual.
   * Só faz sentido pra sprint atual (quem renderiza decide isso). */
  sprintExecutionLabel: string | null;
}

/** Monta o card operacional de um cliente a partir dos dados já buscados
 * em lote (nunca uma query por cliente) — reaproveita as mesmas funções
 * puras da página individual do cliente. `monthRange` é opcional (default:
 * mês corrente) — o dashboard da agência passa um mês selecionado; a tela
 * Operação continua sem passar nada, então o comportamento dela não muda. */
export function buildOperationClientCard(
  client: OperationClientRawData,
  today: Date,
  monthRange?: { firstDay: string; lastDay: string },
): OperationClientCard {
  const todayStr = today.toISOString().slice(0, 10);
  const { firstDay, lastDay } = monthRange ?? currentMonthRange(today);

  const currentSprintRow = client.sprints.find(
    (s) => s.start_date <= todayStr && s.end_date >= todayStr,
  );

  let sprint: SprintFinancials | null = null;
  let sprintNumber: number | null = null;
  let sprintTasks: OperationTaskItem[] = [];

  if (currentSprintRow) {
    const actualSpend = computeSprintEffectiveSpend(currentSprintRow, client.dailySpend);
    sprint = computeSprintFinancials(currentSprintRow, actualSpend, today, currentSprintRow.spend_source);
    sprintNumber =
      client.sprints.filter((s) => s.start_date <= currentSprintRow.start_date).length;
    sprintTasks = client.tasks.filter((t) => t.sprint_id === currentSprintRow.id);
  }

  const monthTasks = client.tasks.filter((t) => t.due_date >= firstDay && t.due_date <= lastDay);
  const monthSprintRows = client.sprints
    .filter((s) => s.start_date >= firstDay && s.start_date <= lastDay)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const monthPlanned = monthSprintRows.reduce((sum, s) => sum + s.planned_spend, 0);
  const monthActual = sumEffectiveSpend(monthSprintRows, client.dailySpend);
  const monthExpectedToDate = sumExpectedToDate(monthSprintRows, today);
  // Ritmo do mês: sempre realizado x esperado até hoje (nunca x 100% do
  // planejado antes do mês acabar — clientes no início do mês não podem
  // aparecer "abaixo do ritmo" só por ainda não terem gastado o mês
  // inteiro). `monthPlanned` como 3º argumento só detecta "sem meta".
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);
  const monthSprints: SprintFinancials[] = monthSprintRows.map((row) => {
    const actualSpend = computeSprintEffectiveSpend(row, client.dailySpend);
    return computeSprintFinancials(row, actualSpend, today, row.spend_source);
  });
  const monthSprintTasks: Record<string, OperationTaskItem[]> = {};
  for (const row of monthSprintRows) {
    monthSprintTasks[row.id] = client.tasks.filter((t) => t.sprint_id === row.id);
  }

  const taskCounts = { total: 0, done: 0, pending: 0, overdue: 0 };
  const overdueTasks: { id: string; due_date: string }[] = [];
  for (const task of monthTasks) {
    const status = effectiveTaskStatus(task, today);
    if (status === "feito") taskCounts.done++;
    else if (status === "atrasado") {
      taskCounts.overdue++;
      overdueTasks.push({ id: task.id, due_date: task.due_date });
    } else taskCounts.pending++;
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

  const completedOptimizations = client.tasks.filter(
    (t) => t.type === "otimizacao" && effectiveTaskStatus(t, today) === "feito",
  );
  const lastOptimizationAt =
    completedOptimizations.length > 0
      ? completedOptimizations.reduce((latest, t) => (t.due_date > latest ? t.due_date : latest), completedOptimizations[0].due_date)
      : null;

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
    lastSyncedAt: client.lastSyncedAt,
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
  const sprintExecutionInfo = sprint
    ? computeSprintExecutionInfo(sprint, sprintLastActivityDate, today)
    : null;
  const sprintExecutionLabel = currentSprintRow
    ? formatSprintExecutionLabel(sprintLastActivityDate, currentSprintRow.start_date, today)
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
    monthPlanned,
    monthActual,
    monthExpectedToDate,
    monthStatus,
    hasMonthGoal: monthPlanned > 0,
    lastOptimizationAt,
    lastSyncedAt: client.lastSyncedAt,
    overdueTasks,
    sprintExecutionInfo,
    monthSprints,
    monthSprintTasks,
    sprintExecutionLabel,
  };
}
