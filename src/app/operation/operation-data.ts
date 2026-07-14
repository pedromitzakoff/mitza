import {
  computeSprintEffectiveSpend,
  computeSprintFinancials,
  currentMonthRange,
  sumActualSpendForMonth,
  sumPlannedForMonth,
  type SprintFinancials,
  type SpendSource,
  type PlannedAllocationRow,
} from "@/lib/sprint-financials";
import {
  resolveMonthlyBudget,
  resolveBudgetEffectiveDate,
  computeMonthlyBudgetPlan,
  computeMonthlyExpectedToDateByCalendar,
} from "@/lib/monthly-budget";
import { computeOriginalSprintPlans, type SprintClosedSnapshot } from "@/lib/sprint-recommendation";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
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
import {
  aggregatePerformanceResults,
  buildEditableChannelValues,
  buildSprintPerformanceView,
  computePerformanceSummary,
  type PerformanceRecordRow,
  type PerformanceSummary,
  type SprintPerformanceView,
} from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { SprintPerformanceProps } from "@/app/clients/sprint-card";

const OPTIMIZATION_LOOKBACK_DAYS = 14;

export type SprintFilterBucket = "atrasadas" | "sem_execucao" | "em_dia" | "sem_sprint";

/** Linha crua de `performance_records`, com o `sprintId` que
 * `PerformanceRecordRow` (lib/performance.ts) não carrega — necessário aqui
 * só pra filtrar os registros de CADA sprint antes de agregar; o resto dos
 * campos é repassado como está pras funções centrais puras. */
export interface PerformanceRecordRawRow extends PerformanceRecordRow {
  sprintId: string | null;
}

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
  /** Planejado diário (`sprint_planned_allocations`), já buscado pelo
   * chamador pro intervalo de datas que ele precisa (mês selecionado, ou
   * união de meses). Etapa 66: só serve de fallback pra `resolveMonthlyBudget`
   * (cliente que nunca configurou orçamento pelo editor) — nunca mais a
   * fonte principal do planejado do mês. */
  plannedAllocations: PlannedAllocationRow[];
  /** Histórico de alterações de orçamento (`monthly_budget_changes`) do mês
   * selecionado — Etapa 66: única fonte do orçamento mensal VIGENTE
   * (`resolveMonthlyBudget`), nunca mais a soma dos planejamentos diários
   * persistidos. */
  monthlyBudgetChanges: { newAmount: number; changedAt: string }[];
  tasks: OperationTaskItem[];
  clientLastActivityAt: string | null;
  sprintLastActivityAt: string | null;
  lastSyncedAt: string | null;
  /** `reviewed_at` da otimização (revisão estratégica da conta,
   * account_reviews) mais recente do cliente, de qualquer resultado —
   * `null` se nunca houve uma. Etapa 74: substitui o sinal antigo baseado
   * na tarefa recorrente "otimizacao" (desativada desde a Etapa 57 e nunca
   * migrada pra este sinal, o que deixava "Última otimização"/"Otimizações
   * realizadas" incorretos em toda a Visão Geral/Sprints/Relatório). */
  lastReviewAt: string | null;
  /** Snapshot congelado (Etapa 70) de cada sprint do mês já encerrada — já
   * resolvido por quem chama (`ensureClosedSprintSnapshots`, que faz a
   * escrita no banco antes de montar o card, já que esta função é pura e
   * nunca escreve nada). Mapa vazio (padrão) = nenhuma sprint foi congelada
   * ainda por esta chamada — sprints concluídas caem no fallback "sem
   * recomendação histórica registrada" até a próxima leitura que já tenha
   * feito o congelamento (ex.: visitar a página do cliente). */
  sprintClosedSnapshots?: Map<string, SprintClosedSnapshot>;
  /** Objetivo de performance do cliente (Etapa 71) — `null` = ainda não
   * configurado (nunca inventado). Dimensão nova, complementar ao
   * financeiro; nunca lida por nenhum cálculo acima. */
  performanceGoal?: PerformanceGoal | null;
  targetCostPerResult?: number | null;
  /** Registros de `performance_records` já buscados pra TODAS as sprints do
   * mês (mesmo padrão batch de `dailySpend`/`tasks` — nunca uma query por
   * cliente). Vazio (padrão) = ninguém buscou ainda, equivalente a "sem
   * dados" pra quem não passar esta prop. */
  performanceRecords?: PerformanceRecordRawRow[];
}

export interface OperationClientCard {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  managerIds: string[];
  sprint: SprintFinancials | null;
  /** Identidade da sprint atual (Etapa 50) — "13–19 jul" ou "27 jul – 02 ago"
   * quando ela atravessa mês. Substitui "Sprint N": o número de ordem deixou
   * de ser a identidade principal em toda a interface. */
  sprintPeriodLabel: string | null;
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
  /** Planejamento restante de cada sprint do mês, por sprintId (Etapa 66) —
   * sempre `computeMonthlyBudgetPlan().sprintPlans`, a mesma função central
   * usada na página do cliente; `null` quando o mês está encerrado (não
   * existe "planejamento restante" pra um mês que já passou). */
  monthSprintPlans: Record<string, { remainingPlanned: number; eligibleDaysCount: number }> | null;
  /** Planejamento original de cada sprint do mês, por sprintId (Etapa 70) —
   * congelado (`sprintClosedSnapshots`) pra sprint concluída, recalculado ao
   * vivo (`computeOriginalSprintPlans` sobre o orçamento vigente) pra
   * atual/futura. Sempre disponível, nunca `null` (0 só quando não há
   * nenhuma base de orçamento). */
  monthSprintOriginalPlans: Record<string, number>;
  /** Recomendação final congelada de cada sprint CONCLUÍDA do mês, por
   * sprintId (Etapa 70) — `null` pra sprint atual/futura (não se aplica) e
   * também pra sprint concluída sem nenhuma recomendação histórica real
   * (nunca inventada retroativamente). */
  monthSprintFinalRecommendations: Record<string, number | null>;
  /** Tarefas de cada sprint do mês, por sprintId — pra montar o mesmo
   * SprintCard da página do cliente pra qualquer sprint do mês (não só a
   * atual), sem duplicar o filtro de tarefas por sprint. */
  monthSprintTasks: Record<string, OperationTaskItem[]>;
  /** Todas as tarefas do mês selecionado, sem separação por sprint — usado
   * pela visão Mensal > Consolidado da tela Sprints (lista cronológica
   * única). Mesmo filtro por due_date que já gera `taskCounts`/`overdueTasks`,
   * só exposto como lista completa em vez de só contagem. */
  monthTasks: OperationTaskItem[];
  /** Mesmo texto ("Hoje"/"Ontem"/"Há N dias úteis") que a página do cliente
   * mostra em "Última execução da sprint" — null se não há sprint atual.
   * Só faz sentido pra sprint atual (quem renderiza decide isso). */
  sprintExecutionLabel: string | null;
  /** Dimensão de PERFORMANCE (Etapa 71) — sempre derivada de
   * `performanceRecords` + `monthActual`/`sprint.actualSpend` já calculados
   * acima; nunca uma segunda fonte de investimento. */
  performanceGoal: PerformanceGoal | null;
  targetCostPerResult: number | null;
  /** Resumo consolidado do mês inteiro — `null` só quando `performanceGoal`
   * também é `null` (sem objetivo configurado, nada a resumir). */
  monthPerformanceSummary: PerformanceSummary | null;
  /** Resultado por canal do mês, só os que têm pelo menos 1 registro —
   * quem renderiza decide mostrar (e só mostra se houver mais de 1). */
  monthPerformanceChannelBreakdown: { channel: TrafficChannel; resultCount: number }[];
  /** Estado de performance de cada sprint do mês, por sprintId — mesmo
   * padrão de `monthSprintOriginalPlans`/`monthSprintFinalRecommendations`. */
  sprintPerformanceViews: Record<string, SprintPerformanceView>;
  /** Valores já lançados por canal de cada sprint, por sprintId — pré-
   * preenche "Editar resultados" sem recalcular na tela. */
  sprintPerformanceEditableChannels: Record<string, { channel: TrafficChannel; existingCount: number | null }[]>;
}

/** Monta a prop pronta pra `SprintCard`/`SprintCardBody` a partir de um
 * `OperationClientCard` já construído — único lugar que sabe como juntar
 * `sprintPerformanceViews`/`sprintPerformanceEditableChannels` num único
 * objeto `SprintPerformanceProps`, pra nenhuma tela duplicar essa junção. */
export function buildSprintPerformanceProps(card: OperationClientCard, sprintId: string): SprintPerformanceProps {
  return {
    view: card.sprintPerformanceViews[sprintId] ?? { kind: "not_configured" },
    editableChannels: card.sprintPerformanceEditableChannels[sprintId] ?? [],
  };
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
  let sprintPeriodLabel: string | null = null;
  let sprintTasks: OperationTaskItem[] = [];

  if (currentSprintRow) {
    const actualSpend = computeSprintEffectiveSpend(currentSprintRow, client.dailySpend);
    sprint = computeSprintFinancials(currentSprintRow, actualSpend, today, currentSprintRow.spend_source);
    sprintPeriodLabel = formatSprintPeriodLabel(currentSprintRow.start_date, currentSprintRow.end_date);
    sprintTasks = client.tasks.filter((t) => t.sprint_id === currentSprintRow.id);
  }

  const monthTasks = client.tasks.filter((t) => t.due_date >= firstDay && t.due_date <= lastDay);
  // Sobreposição com o mês (não "começa no mês") — uma sprint que atravessa
  // a fronteira (ex.: 27/jul-02/ago) precisa aparecer tanto na visão de
  // julho quanto na de agosto, mesmo tendo start_date em julho.
  const monthSprintRows = client.sprints
    .filter((s) => s.start_date <= lastDay && s.end_date >= firstDay)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const monthRangeArg = { firstDay, lastDay };
  // Etapa 66: orçamento mensal VIGENTE — nunca mais a soma dos planejamentos
  // diários persistidos (ver `resolveMonthlyBudget`).
  const monthPlanned = resolveMonthlyBudget(
    client.monthlyBudgetChanges,
    sumPlannedForMonth(client.plannedAllocations, monthRangeArg),
  );
  const monthActual = sumActualSpendForMonth(monthSprintRows, monthRangeArg, client.dailySpend);
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente,
  // independente de sprints/planejamentos antigos.
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(monthPlanned, monthRangeArg, todayStr).expectedToDate;
  // Ritmo do mês: sempre realizado x esperado até hoje (nunca x 100% do
  // planejado antes do mês acabar — clientes no início do mês não podem
  // aparecer "abaixo do ritmo" só por ainda não terem gastado o mês
  // inteiro). `monthPlanned` como 3º argumento só detecta "sem meta".
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);
  const monthSprints: SprintFinancials[] = monthSprintRows.map((row) => {
    const actualSpend = computeSprintEffectiveSpend(row, client.dailySpend);
    return computeSprintFinancials(row, actualSpend, today, row.spend_source);
  });
  // Etapa 66: mesmo planejamento restante por sprint mostrado na página do
  // cliente — `null` quando o mês está encerrado (sem "restante" possível).
  const { effectiveDate: monthEffectiveDate } = resolveBudgetEffectiveDate(monthRangeArg, todayStr);
  const monthSprintPlans: Record<string, { remainingPlanned: number; eligibleDaysCount: number }> | null = monthEffectiveDate
    ? Object.fromEntries(
        computeMonthlyBudgetPlan({
          monthlyBudget: monthPlanned,
          monthActual,
          monthRange: monthRangeArg,
          effectiveDate: monthEffectiveDate,
          sprints: monthSprintRows.map((row) => ({ sprintId: row.id, startDate: row.start_date, endDate: row.end_date })),
        }).sprintPlans,
      )
    : null;
  // Etapa 70 — planejamento original: congelado (`sprintClosedSnapshots`,
  // já resolvido por quem chama antes de invocar esta função pura) pra
  // sprint concluída; recalculado ao vivo pra atual/futura — nunca a mesma
  // fórmula pras duas (ver `computeOriginalSprintPlans`).
  const closedSnapshots = client.sprintClosedSnapshots ?? new Map<string, SprintClosedSnapshot>();
  const liveOriginalPlans = computeOriginalSprintPlans(
    monthPlanned,
    monthRangeArg,
    monthSprintRows.map((row) => ({ sprintId: row.id, startDate: row.start_date, endDate: row.end_date })),
  );
  const monthSprintOriginalPlans: Record<string, number> = {};
  const monthSprintFinalRecommendations: Record<string, number | null> = {};
  for (const row of monthSprintRows) {
    const snapshot = closedSnapshots.get(row.id);
    monthSprintOriginalPlans[row.id] =
      snapshot?.originalPlannedAmount ?? liveOriginalPlans.get(row.id)?.originalPlannedAmount ?? 0;
    monthSprintFinalRecommendations[row.id] = snapshot?.finalRecommendedAmount ?? null;
  }
  const monthSprintTasks: Record<string, OperationTaskItem[]> = {};
  for (const row of monthSprintRows) {
    monthSprintTasks[row.id] = client.tasks.filter((t) => t.sprint_id === row.id);
  }

  // Etapa 71 — camada de PERFORMANCE: consome `monthActual`/`sprint.actualSpend`
  // já calculados acima (nunca uma segunda fonte de investimento). Registros
  // já vêm todos escopados às sprints do mês (query do chamador), então o
  // consolidado mensal é sempre a soma direta deles — nunca um lançamento
  // manual mensal independente (evita contagem dupla, ver migration).
  const performanceGoal = client.performanceGoal ?? null;
  const targetCostPerResult = client.targetCostPerResult ?? null;
  const performanceRecords = client.performanceRecords ?? [];
  const monthPerformanceSummary: PerformanceSummary | null = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult,
      })
    : null;
  const monthPerformanceChannelBreakdown: { channel: TrafficChannel; resultCount: number }[] = performanceGoal
    ? AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({
        channel,
        resultCount: aggregatePerformanceResults(performanceRecords, performanceGoal, channel).resultCount,
      })).filter((entry) => entry.resultCount > 0)
    : [];
  const sprintPerformanceViews: Record<string, SprintPerformanceView> = {};
  const sprintPerformanceEditableChannels: Record<string, { channel: TrafficChannel; existingCount: number | null }[]> = {};
  for (const row of monthSprintRows) {
    const sprintRecords = performanceRecords.filter((r) => r.sprintId === row.id);
    const sprintFinancial = monthSprints.find((s) => s.sprintId === row.id);
    const sprintActualSpend = sprintFinancial?.actualSpend ?? 0;
    sprintPerformanceViews[row.id] = buildSprintPerformanceView({
      performanceGoal,
      isFuture: sprintFinancial?.temporalStatus === "futura",
      records: sprintRecords,
      actualSpend: sprintActualSpend,
      targetCostPerResult,
    });
    sprintPerformanceEditableChannels[row.id] = performanceGoal
      ? buildEditableChannelValues(sprintRecords, performanceGoal, AVAILABLE_TRAFFIC_CHANNELS)
      : [];
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

  // Etapa 74: sinal de "otimização recente" e "última otimização" vêm de
  // account_reviews (revisão estratégica da conta), não mais da tarefa
  // recorrente "otimizacao" (desativada desde a Etapa 57).
  const lookbackStartIso = new Date(today.getTime() - OPTIMIZATION_LOOKBACK_DAYS * 86_400_000).toISOString();
  const optimizationRecentlyDone = client.lastReviewAt !== null && client.lastReviewAt >= lookbackStartIso;
  // `lastOptimizationAt` é consumido como data (`${lastOptimizationAt}T00:00:00Z`)
  // por formatLastOptimizationLabel/sprints/page.tsx — nunca o timestamp
  // completo, só a data civil.
  const lastOptimizationAt = client.lastReviewAt ? client.lastReviewAt.slice(0, 10) : null;

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
    sprintPeriodLabel,
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
    monthSprintPlans,
    monthSprintOriginalPlans,
    monthSprintFinalRecommendations,
    monthSprintTasks,
    sprintExecutionLabel,
    monthTasks,
    performanceGoal,
    targetCostPerResult,
    monthPerformanceSummary,
    monthPerformanceChannelBreakdown,
    sprintPerformanceViews,
    sprintPerformanceEditableChannels,
  };
}
