import { requireQuery } from "@/lib/require-query";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { assertSingleCurrentSprint, computeSprintFinancials, resolveSprintEffectiveSpend } from "@/lib/sprint-financials";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { groupChannelSpendBySprintId, buildEditableInvestmentValues, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, primaryGoalResultTypeFilter } from "@/lib/client-plan";
import { buildEditableChannelValues, buildSprintPerformanceView } from "@/lib/performance";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { fetchClientOperationalHistory, type ClientHistoryRow } from "@/lib/client-operational-history";
import { fetchRecurringTaskDetail, fetchRecurringTaskListsForSprints, type RecurringTaskDetail, type RecurringTaskListItem } from "@/lib/recurring-task-data";
import type { SprintPerformanceProps } from "./sprint-card";
import type { AccountReviewDetail } from "./account-review-detail-drawer";
import type { OperationTaskItem, PerformanceRecordRawRow } from "@/app/operation/operation-data";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TaskStatus, TaskType, TeamMemberStatus } from "@/lib/supabase/database.types";
import type { createClient as createSupabaseClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * Núcleo de dados da "seção Operação" (Etapa "Correção de Direção do
 * Workspace" — restaura a COMPLETUDE da página antiga do cliente sem
 * voltar ao monólito). Extraído 1:1 de `[id]/operation/page.tsx` (mesma
 * lógica, nenhum recálculo novo) pra ser reaproveitado tanto pela rota de
 * aprofundamento (`/operation`) quanto pelo Painel principal
 * (`[id]/page.tsx`, que volta a mostrar Operação por completo, não mais
 * um resumo). Único ponto de fonte de verdade — nunca duas implementações
 * do mesmo cálculo.
 *
 * Tarefas aqui são SEMPRE `origin='template'` (rotina/execução) — nunca
 * `origin='manual'` (Demandas, que tem sua própria seção/rota). Essa
 * separação é o principal bug que a Fase 1 corrigiu e que esta restauração
 * NUNCA deve reintroduzir.
 */
export interface OperationSectionParams {
  id: string;
  firstDay: string;
  lastDay: string;
  today: Date;
  todayStr: string;
  isCurrentMonth: boolean;
  performanceGoal: PerformanceGoal | null;
  targetCostPerResultFallback: number | null;
  returnTo: string;
  openTaskId?: string;
  openReviewDetailId?: string;
  openRecurringTaskId?: string;
  openRecurringTaskSprintId?: string;
  historyPageParam?: string;
}

export interface OperationSectionData {
  managers: { id: string; name: string }[];
  sortedSprints: ReturnType<typeof computeSprintFinancials>[];
  sprintPerformanceBySprintId: Map<string, SprintPerformanceProps>;
  targetCostPerResult: number | null;
  bySprintId: Map<string, OperationTaskRow[]>;
  manualSpendUpdatedAtBySprintId: Map<string, string | null>;
  monthTaskRows: OperationTaskRow[];
  recurringTasksForCurrentSprint: RecurringTaskListItem[];
  currentSprintForRecurring: ReturnType<typeof computeSprintFinancials> | null;
  recurringTaskDetail: RecurringTaskDetail | null;
  recurringTaskReportHref: string | null;
  clientUpdatesByReviewId: Map<string, { id: string; content: string; sent_at: string | null; sent_by_profile: { name: string } | null }>;
  reviewDetail: AccountReviewDetail | null;
  buildReviewDetailHref: (reviewId: string) => string;
  historyRows: ClientHistoryRow[];
  hasMoreHistory: boolean;
  historyPage: number;
  buildHistoryPageHref: (page: number) => string;
  openTask: OperationTaskItem | null;
  openTaskSprintPeriodLabel: string | null;
  taskCommentsById: Map<string, OperationTaskComment[]>;
}

export interface OperationTaskRow {
  id: string;
  title: string;
  type: TaskType;
  due_date: string;
  due_time: string | null;
  status: TaskStatus;
  sprint_id: string | null;
  notes: string | null;
  assignee: { name: string; status: TeamMemberStatus } | null;
}

interface OperationTaskComment {
  id: string;
  commentable_id: string;
  content: string;
  created_at: string;
  author: { name: string } | null;
}

export async function loadOperationSectionData(supabase: Supabase, params: OperationSectionParams): Promise<OperationSectionData> {
  const {
    id,
    firstDay,
    lastDay,
    today,
    todayStr,
    isCurrentMonth,
    performanceGoal,
    targetCostPerResultFallback,
    returnTo,
    openTaskId,
    openReviewDetailId,
    openRecurringTaskId,
    openRecurringTaskSprintId,
    historyPageParam,
  } = params;

  const [sprintsRaw, dailySpend, channelSpendRows, performanceTargetHistory, managers, accountReviewRows, clientUpdateRows] = await Promise.all([
    requireQuery(
      supabase
        .from("sprints")
        .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at")
        .eq("client_id", id)
        .lte("start_date", lastDay)
        .gte("end_date", firstDay)
        .order("start_date"),
      "sprints:operation-section",
    ),
    requireQuery(
      supabase.from("daily_spend").select("date, spend").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
      "daily_spend:operation-section",
    ),
    requireQuery(
      supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
      "sprint_channel_spend:operation-section",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, month, changed_at, new_amount, target_result_count, target_cost_per_result")
        .eq("client_id", id)
        .lte("month", firstDay)
        .or(primaryGoalResultTypeFilter(performanceGoal))
        .order("month", { ascending: false })
        .order("changed_at", { ascending: false }),
      "monthly_budget_changes:operation-section",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members:operation-section"),
    requireQuery(
      supabase
        .from("account_reviews")
        .select(
          "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, diagnosis, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact, quantity), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
        )
        .eq("client_id", id)
        .order("reviewed_at", { ascending: false })
        .limit(200),
      "account_reviews:operation-section",
    ),
    requireQuery(
      supabase
        .from("client_updates")
        .select("id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)")
        .eq("client_id", id),
      "client_updates:operation-section",
    ),
  ]);

  const channelSpendOverrideRows: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));
  const channelSpendBySprintId = groupChannelSpendBySprintId(channelSpendOverrideRows);
  const legacyManualActualSpendBySprintId = new Map(sprintsRaw.map((sprint) => [sprint.id, sprint.manual_actual_spend]));
  const sprints = sprintsRaw.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(sprint.manual_actual_spend, channelSpendBySprintId.get(sprint.id) ?? []),
  }));
  assertSingleCurrentSprint(sprints, today);

  const performanceRecordRows = await resolvePerformanceRowsForSprints(
    supabase,
    sprints.map((s) => ({ id: s.id, client_id: id, start_date: s.start_date, end_date: s.end_date })),
  );
  const performanceRecords: PerformanceRecordRawRow[] = performanceRecordRows.map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  const sprintFinancials = sprints.map((sprint) => {
    const { actual: actualSpend, effectiveSource } = resolveSprintEffectiveSpend(sprint, dailySpend ?? []);
    return computeSprintFinancials(sprint, actualSpend, today, effectiveSource);
  });
  const manualSpendUpdatedAtBySprintId = new Map(sprints.map((s) => [s.id, s.manual_spend_updated_at]));
  const sortedSprints = [...sprintFinancials].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const clientPlan = resolveClientMonthlyPlan({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: (performanceTargetHistory ?? []).map((row) => ({
      channel: row.channel as TrafficChannel,
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
    })),
    selectedMonth: firstDay,
  });
  const targetCostPerResult = resolveTargetCostPerResult({ channel: "consolidated", plan: clientPlan, legacyFallback: targetCostPerResultFallback });

  const sprintPerformanceBySprintId = new Map<string, SprintPerformanceProps>();
  for (const sprint of sprintFinancials) {
    const sprintRecords = performanceRecords.filter((r) => r.sprintId === sprint.sprintId);
    sprintPerformanceBySprintId.set(sprint.sprintId, {
      view: buildSprintPerformanceView({
        performanceGoal,
        isFuture: sprint.temporalStatus === "futura",
        records: sprintRecords,
        actualSpend: sprint.actualSpend,
        targetCostPerResult,
      }),
      editableChannels: performanceGoal ? buildEditableChannelValues(sprintRecords, performanceGoal, AVAILABLE_TRAFFIC_CHANNELS) : [],
      editableInvestment: buildEditableInvestmentValues(
        AVAILABLE_TRAFFIC_CHANNELS,
        legacyManualActualSpendBySprintId.get(sprint.sprintId) ?? null,
        channelSpendBySprintId.get(sprint.sprintId) ?? [],
      ),
      performanceGoal,
    });
  }

  // Tarefas OPERACIONAIS (origin='template') — nunca misturadas com Demandas
  // (origin='manual', que mora só em `/clients/[id]/demandas`). Correção
  // explícita do bug encontrado na auditoria original — restaurar
  // completude NUNCA deve reabrir esta mistura.
  const tasks = await requireQuery(
    supabase
      .from("tasks")
      .select("id, title, type, due_date, due_time, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)")
      .eq("client_id", id)
      .eq("origin", "template")
      .order("due_date"),
    "tasks:operation-section",
  );

  const { data: taskCommentsRaw } = await supabase
    .from("comments")
    .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
    .eq("commentable_type", "task")
    .in("commentable_id", (tasks ?? []).map((t) => t.id))
    .order("created_at");
  const taskCommentsById = new Map<string, OperationTaskComment[]>();
  for (const comment of taskCommentsRaw ?? []) {
    const list = taskCommentsById.get(comment.commentable_id) ?? [];
    list.push(comment);
    taskCommentsById.set(comment.commentable_id, list);
  }

  const bySprintId = new Map<string, typeof tasks>();
  const unlinkedAllTime: typeof tasks = [];
  for (const task of tasks ?? []) {
    if (!task.sprint_id) {
      unlinkedAllTime.push(task);
      continue;
    }
    const list = bySprintId.get(task.sprint_id) ?? [];
    list.push(task);
    bySprintId.set(task.sprint_id, list);
  }
  const unlinkedTasks = unlinkedAllTime.filter((task) => task.due_date >= firstDay && task.due_date <= lastDay);
  const monthTaskRows = [...sortedSprints.flatMap((sprint) => bySprintId.get(sprint.sprintId) ?? []), ...unlinkedTasks];

  const currentSprintForRecurring = isCurrentMonth ? sprintFinancials.find((s) => s.temporalStatus === "atual") ?? null : null;
  const recurringTasksForCurrentSprint = currentSprintForRecurring
    ? (
        await fetchRecurringTaskListsForSprints(
          supabase,
          [
            {
              id: currentSprintForRecurring.sprintId,
              client_id: id,
              start_date: currentSprintForRecurring.startDate,
              end_date: currentSprintForRecurring.endDate,
            },
          ],
          todayStr,
        )
      ).get(currentSprintForRecurring.sprintId) ?? []
    : [];
  const recurringTaskSprintForDrawer = openRecurringTaskSprintId ? sprints.find((s) => s.id === openRecurringTaskSprintId) ?? null : null;
  const recurringTaskDetail =
    openRecurringTaskId && recurringTaskSprintForDrawer
      ? await fetchRecurringTaskDetail(supabase, openRecurringTaskId, id, recurringTaskSprintForDrawer, todayStr)
      : null;
  const recurringTaskReportHref = recurringTaskSprintForDrawer
    ? `/clients/${id}/relatorio?clientReport=new&reportRecurringTaskId=${openRecurringTaskId}&reportPeriodStart=${recurringTaskSprintForDrawer.start_date}&reportPeriodEnd=${recurringTaskSprintForDrawer.end_date}`
    : null;

  const clientUpdatesByReviewId = new Map(clientUpdateRows.map((row) => [row.account_review_id, row]));
  const accountReviews = accountReviewRows;
  const openReviewDetail = openReviewDetailId ? accountReviews.find((r) => r.id === openReviewDetailId) ?? null : null;
  const reviewDetail: AccountReviewDetail | null = openReviewDetail
    ? {
        id: openReviewDetail.id,
        reviewedAt: openReviewDetail.reviewed_at,
        managerName: openReviewDetail.team_member?.name ?? "Membro removido",
        reason: openReviewDetail.reason,
        reasonOtherDescription: openReviewDetail.reason_other_description,
        outcome: openReviewDetail.outcome,
        diagnosis: openReviewDetail.diagnosis,
        notes: openReviewDetail.notes,
        issueDescription: openReviewDetail.issue_description,
        issueCategory: openReviewDetail.issue_category,
        issueTaskTitle: openReviewDetail.issue_task?.title ?? null,
        secondsSincePreviousReview: openReviewDetail.seconds_since_previous_review,
        optimizations: openReviewDetail.optimizations.map((opt) => ({
          id: opt.id,
          type: opt.optimization_type,
          action: opt.optimization_action,
          description: opt.description,
          reason: opt.reason,
          expectedImpact: opt.expected_impact,
          quantity: opt.quantity,
        })),
        clientUpdate: (() => {
          const update = clientUpdatesByReviewId.get(openReviewDetail.id);
          return update ? { id: update.id, content: update.content, sentAt: update.sent_at, sentByName: update.sent_by_profile?.name ?? null } : null;
        })(),
      }
    : null;
  const buildReviewDetailHref = (reviewId: string) => withParam(returnTo, `reviewDetail=${reviewId}`);

  const historyPage = Math.max(0, Number(historyPageParam) || 0);
  const { rows: historyRows, hasMore: hasMoreHistory } = await fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, historyPage);
  const buildHistoryPageHref = (page: number) => withParam(returnTo, `historyPage=${page}`);

  const openTaskRow = openTaskId ? (tasks ?? []).find((t) => t.id === openTaskId) ?? null : null;
  const openTask: OperationTaskItem | null = openTaskRow
    ? {
        id: openTaskRow.id,
        title: openTaskRow.title,
        type: openTaskRow.type,
        due_date: openTaskRow.due_date,
        status: openTaskRow.status,
        assignee: openTaskRow.assignee,
        sprint_id: openTaskRow.sprint_id,
        notes: openTaskRow.notes,
      }
    : null;
  const openTaskSprint = openTaskRow?.sprint_id ? sprintFinancials.find((s) => s.sprintId === openTaskRow.sprint_id) ?? null : null;
  const openTaskSprintPeriodLabel = openTaskSprint ? formatSprintPeriodLabel(openTaskSprint.startDate, openTaskSprint.endDate) : null;

  return {
    managers: managers ?? [],
    sortedSprints,
    sprintPerformanceBySprintId,
    targetCostPerResult,
    bySprintId,
    manualSpendUpdatedAtBySprintId,
    monthTaskRows,
    recurringTasksForCurrentSprint,
    currentSprintForRecurring,
    recurringTaskDetail,
    recurringTaskReportHref,
    clientUpdatesByReviewId,
    reviewDetail,
    buildReviewDetailHref,
    historyRows,
    hasMoreHistory,
    historyPage,
    buildHistoryPageHref,
    openTask,
    openTaskSprintPeriodLabel,
    taskCommentsById,
  };
}
