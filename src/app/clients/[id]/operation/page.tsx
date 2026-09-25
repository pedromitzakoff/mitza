import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import {
  assertSingleCurrentSprint,
  computeSprintFinancials,
  currentMonthRange,
  monthRangeFromParam,
  resolveSprintEffectiveSpend,
  shiftMonthParam,
} from "@/lib/sprint-financials";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { groupChannelSpendBySprintId, buildEditableInvestmentValues, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, primaryGoalResultTypeFilter } from "@/lib/client-plan";
import { buildEditableChannelValues, buildSprintPerformanceView } from "@/lib/performance";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { fetchClientOperationalHistory } from "@/lib/client-operational-history";
import { fetchRecurringTaskDetail, fetchRecurringTaskListsForSprints } from "@/lib/recurring-task-data";
import { IconButton } from "@/components/workspace/button";
import { SubmitButton } from "@/app/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "../../section";
import { SprintCard, type SprintPerformanceProps } from "../../sprint-card";
import { MonthTasksPanel } from "../../month-tasks-panel";
import { ClientHistoryList } from "../../client-history-list";
import { RecordAccountReviewDrawer } from "../../record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "../../account-review-detail-drawer";
import { RecurringTaskDrawer } from "../../recurring-task-drawer";
import { generateClientUpdateAction } from "../../client-update-actions";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationTaskItem, PerformanceRecordRawRow } from "@/app/operation/operation-data";
import { WorkspaceContainer } from "../../workspace-container";

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * `/clients/[id]/operation` — Operação do cliente (Etapa "MITZA —
 * Reformulação Estrutural", seção 10 do pedido): "Estamos executando
 * corretamente esse cliente?". Extraído de `[id]/page.tsx` (que fazia tudo
 * isso dentro de "Visão geral") — mesma lógica/componentes de sempre
 * (`SprintCard`, `MonthTasksPanel`, `ClientHistoryList`,
 * `RecordAccountReviewDrawer`), nunca reconstruídos.
 *
 * Correção explícita (decisão 8 do usuário — "corrigir a mistura atual
 * entre Demandas e tarefas operacionais"): a lista de tarefas aqui filtra
 * `origin = 'template'` — nunca mais o antigo `tasks` sem filtro nenhum
 * (bug real encontrado na auditoria: `[id]/page.tsx` buscava TODA `tasks`
 * do cliente, misturando `origin='manual'` com `origin='template'`).
 * `origin='manual'` mora exclusivamente em `/clients/[id]/demandas` agora.
 *
 * Sem seletor de canal (Consolidado/Meta/Google) — isso é leitura
 * analítica, ficou em Performance; Operação sempre mostra o consolidado.
 *
 * Etapa "Correção de UX do Workspace": deixou de ser uma das 5 abas
 * equivalentes do header e virou rota de APROFUNDAMENTO — o Painel
 * principal (`[id]/page.tsx`) já mostra um resumo operacional (sprint
 * atual, última otimização, saúde) com um CTA "Ver operação completa →"
 * pra cá. `WorkspaceContainer` (mesma largura do Painel — corrige a
 * largura estreita herdada do monólito antigo) + link "← {cliente}" de
 * volta pro Painel, já que esta rota não tem mais aba destacada no header
 * pra sinalizar "você está aqui".
 */
export default async function ClientOperationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    month?: string;
    task?: string;
    taskError?: string;
    review?: string;
    reviewError?: string;
    reviewDetail?: string;
    reviewSaved?: string;
    clientUpdateError?: string;
    recurringTaskDetail?: string;
    recurringTaskSprint?: string;
    recurringTaskError?: string;
    historyPage?: string;
  }>;
}) {
  const { id } = await params;
  const {
    month: monthQueryParam,
    task: openTaskId,
    taskError,
    review: openReview,
    reviewError,
    reviewDetail: openReviewDetailId,
    reviewSaved,
    clientUpdateError,
    recurringTaskDetail: openRecurringTaskId,
    recurringTaskSprint: openRecurringTaskSprintId,
    recurringTaskError,
    historyPage: historyPageParam,
  } = await searchParams;

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select("id, name, status, performance_goal, target_cost_per_result, media_channels, primary_manager:team_members!clients_primary_manager_id_fkey(name)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[ClientOperationPage] falha ao buscar cliente ${id}:`, clientQueryError);
  if (!client) notFound();

  const canOperate = client.status === "ativo";
  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;
  const monthLabel = formatMonthLabel(firstDay);
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const returnTo = `/clients/${id}/operation${monthQuery}`;
  const prevMonthHref = `/clients/${id}/operation?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}/operation?month=${shiftMonthParam({ firstDay }, 1)}`;

  const [sprintsRaw, dailySpend, channelSpendRows, performanceTargetHistory, managers, accountReviewRows, clientUpdateRows] = await Promise.all([
    requireQuery(
      supabase
        .from("sprints")
        .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at")
        .eq("client_id", id)
        .lte("start_date", lastDay)
        .gte("end_date", firstDay)
        .order("start_date"),
      "sprints:operation",
    ),
    requireQuery(supabase.from("daily_spend").select("date, spend").eq("client_id", id).gte("date", firstDay).lte("date", lastDay), "daily_spend:operation"),
    requireQuery(
      supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
      "sprint_channel_spend:operation",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("channel, month, changed_at, new_amount, target_result_count, target_cost_per_result")
        .eq("client_id", id)
        .lte("month", firstDay)
        .or(primaryGoalResultTypeFilter(client.performance_goal))
        .order("month", { ascending: false })
        .order("changed_at", { ascending: false }),
      "monthly_budget_changes:operation",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members:operation"),
    requireQuery(
      supabase
        .from("account_reviews")
        .select(
          "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, diagnosis, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact, quantity), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
        )
        .eq("client_id", id)
        .order("reviewed_at", { ascending: false })
        .limit(200),
      "account_reviews:operation",
    ),
    requireQuery(
      supabase
        .from("client_updates")
        .select("id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)")
        .eq("client_id", id),
      "client_updates:operation",
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
  const performanceGoal = client.performance_goal;
  const targetCostPerResult = resolveTargetCostPerResult({ channel: "consolidated", plan: clientPlan, legacyFallback: client.target_cost_per_result });

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
  // explícita do bug encontrado na auditoria (seção 8 do pedido).
  const tasks = await requireQuery(
    supabase
      .from("tasks")
      .select("id, title, type, due_date, due_time, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)")
      .eq("client_id", id)
      .eq("origin", "template")
      .order("due_date"),
    "tasks:operation",
  );

  const { data: taskCommentsRaw } = await supabase
    .from("comments")
    .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
    .eq("commentable_type", "task")
    .in("commentable_id", (tasks ?? []).map((t) => t.id))
    .order("created_at");
  const taskCommentsById = new Map<string, typeof taskCommentsRaw>();
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

  const taskHrefPrefix = `/clients/${id}/operation${monthQuery ? `${monthQuery}&` : "?"}task=`;
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

  return (
    <WorkspaceContainer>
      <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
        &larr; {client.name}
      </Link>

      {(taskError || reviewError || recurringTaskError || clientUpdateError) && (
        <div className="flex flex-col gap-2">
          {[taskError, reviewError, recurringTaskError, clientUpdateError].filter(Boolean).map((message, index) => (
            <p key={index} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {message}
            </p>
          ))}
        </div>
      )}

      {reviewSaved && !clientUpdatesByReviewId.has(reviewSaved) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-overview-border bg-overview-surface px-3 py-2 text-sm">
          <span className="text-overview-text-primary">Revisão de conta registrada com sucesso.</span>
          <div className="flex items-center gap-2">
            <form action={generateClientUpdateAction.bind(null, reviewSaved, withParam(returnTo, `reviewDetail=${reviewSaved}`))}>
              <SubmitButton pendingChildren="Gerando..." className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                Gerar atualização
              </SubmitButton>
            </form>
            <Link href={returnTo} className="rounded-md border border-overview-border px-3 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover">
              Fechar
            </Link>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 border-b border-overview-border pb-2">
        <div className="flex items-center gap-0.5">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[6rem] px-1 text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <Link href={withParam(returnTo, "review=new")} scroll={false} className="ml-auto text-sm font-medium text-brand hover:underline">
          + Registrar revisão
        </Link>
      </div>

      <div className="mt-6">
        <MonthTasksPanel
          key={monthLabel}
          monthLabel={monthLabel}
          tasks={monthTaskRows}
          clientId={id}
          managers={managers ?? []}
          isAdmin={isAdmin}
          canOperate={canOperate}
          recurringTasks={recurringTasksForCurrentSprint}
          recurringTaskHrefPrefix={
            currentSprintForRecurring
              ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}recurringTaskSprint=${currentSprintForRecurring.sprintId}&recurringTaskDetail=`
              : undefined
          }
          taskHrefPrefix={taskHrefPrefix}
        />
      </div>

      <Section title={`Sprints de ${monthLabel}`}>
        <div className="flex flex-col gap-2">
          {sortedSprints.length > 0 ? (
            sortedSprints.map((sprint) => (
              <SprintCard
                key={sprint.sprintId}
                sprint={sprint}
                comments={[]}
                clientId={id}
                isAdmin={isAdmin}
                canEditPerformance={isAdmin}
                tasks={bySprintId.get(sprint.sprintId) ?? []}
                manualSpendUpdatedAt={manualSpendUpdatedAtBySprintId.get(sprint.sprintId) ?? null}
                metaSyncedAt={null}
                taskManagers={managers ?? []}
                defaultAssigneeName={client.primary_manager?.name ?? null}
                performance={sprintPerformanceBySprintId.get(sprint.sprintId)}
                targetCostPerResult={targetCostPerResult}
                returnTo={returnTo}
                hideNextAction
                hideTaskList
                canOperate={canOperate}
              />
            ))
          ) : (
            <EmptyState>Nenhuma sprint encontrada para este período — verifique se as sprints do mês já foram geradas.</EmptyState>
          )}
        </div>
      </Section>

      <Section title={`Histórico de ${monthLabel}`}>
        <ClientHistoryList rows={historyRows} buildReviewDetailHref={buildReviewDetailHref} emptyLabel={`Nenhum evento registrado em ${monthLabel}.`} />
        {(historyPage > 0 || hasMoreHistory) && (
          <div className="mt-3 flex items-center justify-between border-t border-overview-border pt-2 text-xs">
            {historyPage > 0 ? (
              <Link href={buildHistoryPageHref(historyPage - 1)} scroll={false} className="font-medium text-brand hover:underline">
                &larr; Mais recentes
              </Link>
            ) : (
              <span />
            )}
            {hasMoreHistory && (
              <Link href={buildHistoryPageHref(historyPage + 1)} scroll={false} className="font-medium text-brand hover:underline">
                Mais antigos &rarr;
              </Link>
            )}
          </div>
        )}
      </Section>

      {openTask && (
        <TaskDrawerPanel
          task={openTask}
          clientId={id}
          clientName={client.name}
          sprintPeriodLabel={openTaskSprintPeriodLabel}
          comments={(taskCommentsById.get(openTask.id) ?? []) as never}
          closeHref={returnTo}
          returnTo={returnTo}
          isAdmin={isAdmin}
          managers={managers ?? []}
          canOperate={canOperate}
        />
      )}

      {openReview === "new" && <RecordAccountReviewDrawer clientId={id} closeHref={returnTo} managers={managers ?? []} error={reviewError} />}

      {reviewDetail && <AccountReviewDetailDrawer review={reviewDetail} clientId={id} closeHref={returnTo} />}

      {recurringTaskDetail && (
        <RecurringTaskDrawer detail={recurringTaskDetail} clientId={id} closeHref={returnTo} reportHref={recurringTaskReportHref} />
      )}
    </WorkspaceContainer>
  );
}
