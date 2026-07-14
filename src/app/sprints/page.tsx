import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import {
  currentMonthRange,
  findSprintForDate,
  isDateWithinPeriod,
  monthRangeFromParam,
  shiftMonthParam,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatFullDate, formatMonthLabel } from "@/lib/format";
import { getMonthTemporalStatus, resolveMonthlyBudget } from "@/lib/monthly-budget";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import type { SprintClosedSnapshot } from "@/lib/sprint-recommendation";
import {
  sortAccountsByPriority,
  financialStatusForPeriod,
  periodOverdueCount,
  type PriorityPeriod,
} from "@/lib/account-priority";
import type { CommentItem } from "@/app/clients/comment-thread";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type OperationTaskItem,
} from "@/app/operation/operation-data";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
import { RecordAccountReviewDrawer } from "@/app/clients/record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "@/app/clients/account-review-detail-drawer";
import { computeClientUpdateStatus } from "@/lib/client-updates";
import { SprintCurrentClientGroup } from "./current-client-group";
import { SprintMonthlyBySprintsGroup } from "./monthly-sprints-group";
import { SprintMonthlyConsolidatedGroup } from "./monthly-consolidated-group";
import {
  SprintsFilters,
  type SprintsActivityFilter,
  type SprintsDisplayFilter,
  type SprintsHealthFilter,
  type SprintsOptimizationFilter,
  type SprintsRitmoFilter,
  type SprintsTasksFilter,
} from "./sprints-filters";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";

type SprintsView = "current" | "monthly";
type MonthlyGrouping = "consolidated" | "sprints";

const VIEW_LABEL: Record<SprintsView, string> = {
  current: "Sprint atual",
  monthly: "Mensal",
};

const GROUPING_LABEL: Record<MonthlyGrouping, string> = {
  consolidated: "Consolidado",
  sprints: "Por sprints",
};

const OPTIMIZATION_DAY_MS = 86_400_000;

export default async function SprintsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    grouping?: string;
    manager?: string;
    client?: string;
    month?: string;
    health?: string;
    ritmo?: string;
    tasks?: string;
    optimization?: string;
    activity?: string;
    display?: string;
    task?: string;
    taskError?: string;
    commentError?: string;
    review?: string;
    reviewClient?: string;
    reviewDetail?: string;
    reviewError?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;

  const view: SprintsView = params.view === "monthly" ? "monthly" : "current";
  // Grouping só existe dentro do modo Mensal — qualquer valor ausente ou
  // desconhecido cai em "consolidated" (o padrão ao entrar em Mensal).
  const grouping: MonthlyGrouping = params.grouping === "sprints" ? "sprints" : "consolidated";
  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");
  const healthFilter = (params.health ?? "todos") as SprintsHealthFilter;
  const ritmoFilter = (params.ritmo ?? "todos") as SprintsRitmoFilter;
  const tasksFilter = (params.tasks ?? "todas") as SprintsTasksFilter;
  const optimizationFilter = (params.optimization ?? "todas") as SprintsOptimizationFilter;
  const activityFilter = (params.activity ?? "todos") as SprintsActivityFilter;
  const displayFilter = (params.display ?? "todos") as SprintsDisplayFilter;

  // Período em foco pra tudo que é "prioridade"/situação financeira/tarefas
  // atrasadas: sprint atual na visão Sprint atual, mês selecionado nas duas
  // visões Mensais (Consolidado e Por sprints combinam pelo mesmo resumo
  // mensal por cliente) — nunca mistura sprint com mês no mesmo cálculo.
  const period: PriorityPeriod = view === "current" ? "sprint" : "month";

  const today = todayUTC();
  const todayStr = todayDateString();
  // "Sprint atual" sempre é resolvida pela data real de hoje — por isso a
  // busca cobre o mês corrente E o mês selecionado (union), garantindo que
  // a sprint de hoje seja encontrada mesmo com a visão Mensal navegando pra
  // outro mês. Isso também evita a ambiguidade de "sprint atual de um mês
  // passado": a visão Sprint atual nunca lê `month`, só a Mensal lê.
  const monthRange = monthRangeFromParam(params.month, today);
  const currentRange = currentMonthRange(today);
  const rangeStart = monthRange.firstDay < currentRange.firstDay ? monthRange.firstDay : currentRange.firstDay;
  const rangeEnd = monthRange.lastDay > currentRange.lastDay ? monthRange.lastDay : currentRange.lastDay;

  const supabase = await createSupabaseClient();

  const [
    { data: clients },
    { data: gestores },
    { data: sprints },
    { data: dailySpend },
    { data: tasks },
    { data: plannedAllocations },
    { data: budgetChanges },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, meta_ad_account_id, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
    // Sobreposição com a janela (não "começa na janela") — sprint que
    // atravessa mês precisa ser encontrada mesmo com start_date fora dela.
    supabase
      .from("sprints")
      .select(
        "id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
      )
      .lte("start_date", rangeEnd)
      .gte("end_date", rangeStart),
    supabase
      .from("daily_spend")
      .select("client_id, date, spend, synced_at")
      .gte("date", rangeStart)
      .lte("date", rangeEnd),
    supabase
      .from("tasks")
      .select(
        "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
      ),
    supabase
      .from("sprint_planned_allocations")
      .select("client_id, sprint_id, date, planned_amount")
      .gte("date", rangeStart)
      .lte("date", rangeEnd),
    // Orçamento vigente (Etapa 66) — só do mês SELECIONADO (`monthRange`),
    // não da janela união com o mês corrente.
    supabase
      .from("monthly_budget_changes")
      .select("client_id, new_amount, changed_at")
      .eq("month", monthRange.firstDay),
  ]);

  const clientIds = (clients ?? []).map((c) => c.id);
  const allSprintIds = (sprints ?? []).map((s) => s.id);
  const currentSprintIds = (sprints ?? [])
    .filter((s) => isDateWithinPeriod(todayStr, s.start_date, s.end_date))
    .map((s) => s.id);
  // Etapa 71: só as sprints que de fato pertencem ao mês SELECIONADO (não a
  // janela união com o mês corrente) — igual à Visão Geral, pra nunca somar
  // no consolidado mensal um resultado de uma sprint de outro mês.
  const monthSprintIdsForPerformance = (sprints ?? [])
    .filter((s) => s.start_date <= monthRange.lastDay && s.end_date >= monthRange.firstDay)
    .map((s) => s.id);

  // Comentários de TODAS as sprints visíveis, buscados em lote uma única vez
  // (não por card) — pra o mesmo SprintCard da página do cliente também
  // mostrar comentários aqui, sem virar N+1.
  const [{ data: clientActivity }, { data: sprintActivity }, { data: sprintComments }, { data: performanceRecords }] =
    await Promise.all([
      clientIds.length > 0
        ? supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds)
        : Promise.resolve({ data: [] }),
      currentSprintIds.length > 0
        ? supabase.from("sprint_last_operational_activity").select("sprint_id, last_activity_at").in("sprint_id", currentSprintIds)
        : Promise.resolve({ data: [] }),
      allSprintIds.length > 0
        ? supabase
            .from("comments")
            .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
            .eq("commentable_type", "sprint")
            .in("commentable_id", allSprintIds)
            .order("created_at")
        : Promise.resolve({ data: [] }),
      monthSprintIdsForPerformance.length > 0
        ? supabase
            .from("performance_records")
            .select("client_id, sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", monthSprintIdsForPerformance)
        : Promise.resolve({ data: [] }),
    ]);

  // Etapa 74 — "Última otimização"/filtro "optimization": sempre o dado
  // GLOBAL mais recente por cliente (independe do mês selecionado), por
  // isso uma busca própria sem filtro de data — mesma fonte usada na Visão
  // Geral e no Acompanhamento da Conta (account_reviews.reviewed_at).
  const { data: lastReviews } =
    clientIds.length > 0
      ? await supabase
          .from("account_reviews")
          .select("client_id, reviewed_at")
          .in("client_id", clientIds)
          .order("reviewed_at", { ascending: false })
      : { data: [] };
  const lastReviewAtByClient = new Map<string, string>();
  for (const row of lastReviews ?? []) {
    if (!lastReviewAtByClient.has(row.client_id)) lastReviewAtByClient.set(row.client_id, row.reviewed_at);
  }

  // Sprint UX 2.0 — "Otimizações" (account_reviews) direto na tela Sprints,
  // igual à página do cliente: mesma query rica (Etapa 57), só filtrada
  // pelas sprints já visíveis nesta tela (allSprintIds) em vez de por
  // cliente, pra cobrir as 3 visões com uma única busca.
  const { data: sprintReviewRows } =
    allSprintIds.length > 0
      ? await supabase
          .from("account_reviews")
          .select(
            "id, client_id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
          )
          .in("sprint_id", allSprintIds)
          .order("reviewed_at", { ascending: false })
      : { data: [] };

  const reviewIds = (sprintReviewRows ?? []).map((r) => r.id);
  const { data: reviewClientUpdateRows } =
    reviewIds.length > 0
      ? await supabase
          .from("client_updates")
          .select(
            "id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)",
          )
          .in("account_review_id", reviewIds)
      : { data: [] };
  const clientUpdatesByReviewId = new Map((reviewClientUpdateRows ?? []).map((row) => [row.account_review_id, row]));

  const accountReviewsBySprintId = new Map<string, AccountReviewSummaryItem[]>();
  for (const review of sprintReviewRows ?? []) {
    const update = clientUpdatesByReviewId.get(review.id) ?? null;
    const list = accountReviewsBySprintId.get(review.sprint_id) ?? [];
    list.push({
      id: review.id,
      reviewedAt: review.reviewed_at,
      reason: review.reason,
      reasonOtherDescription: review.reason_other_description,
      outcome: review.outcome,
      managerName: review.team_member?.name ?? "Membro removido",
      optimizationCount: review.optimizations.length,
      issueDescription: review.issue_description,
      updateStatus: computeClientUpdateStatus(
        update ? { copiedAt: update.copied_at, sentAt: update.sent_at } : null,
      ),
    });
    accountReviewsBySprintId.set(review.sprint_id, list);
  }

  const allCommentIds = (sprintComments ?? []).map((c) => c.id);
  const { data: reportSelections } =
    allCommentIds.length > 0
      ? await supabase.from("report_comment_selections").select("comment_id").in("comment_id", allCommentIds)
      : { data: [] };
  const includedCommentIds = new Set((reportSelections ?? []).map((r) => r.comment_id));

  const sprintCommentsById = new Map<string, CommentItem[]>();
  for (const comment of sprintComments ?? []) {
    const list = sprintCommentsById.get(comment.commentable_id) ?? [];
    list.push({ ...comment, includedInReport: includedCommentIds.has(comment.id) });
    sprintCommentsById.set(comment.commentable_id, list);
  }

  type SprintRow = {
    id: string;
    client_id: string;
    start_date: string;
    end_date: string;
    planned_spend: number;
    spend_source: "manual" | "meta_api";
    manual_actual_spend: number | null;
    original_planned_amount: number | null;
    final_recommended_amount: number | null;
    final_actual_amount: number | null;
    snapshot_frozen_at: string | null;
  };
  const sprintsByClient = new Map<string, SprintRow[]>();
  for (const s of sprints ?? []) {
    const list = sprintsByClient.get(s.client_id) ?? [];
    list.push(s);
    sprintsByClient.set(s.client_id, list);
  }

  const dailySpendByClient = new Map<string, { date: string; spend: number }[]>();
  const lastSyncedByClient = new Map<string, string>();
  for (const d of dailySpend ?? []) {
    const list = dailySpendByClient.get(d.client_id) ?? [];
    list.push({ date: d.date, spend: d.spend });
    dailySpendByClient.set(d.client_id, list);

    const current = lastSyncedByClient.get(d.client_id);
    if (!current || d.synced_at > current) {
      lastSyncedByClient.set(d.client_id, d.synced_at);
    }
  }

  const tasksByClient = new Map<string, OperationClientRawData["tasks"]>();
  for (const t of tasks ?? []) {
    const list = tasksByClient.get(t.client_id) ?? [];
    list.push(t);
    tasksByClient.set(t.client_id, list);
  }

  const plannedAllocationsByClient = new Map<string, OperationClientRawData["plannedAllocations"]>();
  for (const a of plannedAllocations ?? []) {
    const list = plannedAllocationsByClient.get(a.client_id) ?? [];
    list.push({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount });
    plannedAllocationsByClient.set(a.client_id, list);
  }

  const budgetChangesByClient = new Map<string, OperationClientRawData["monthlyBudgetChanges"]>();
  for (const c of budgetChanges ?? []) {
    const list = budgetChangesByClient.get(c.client_id) ?? [];
    list.push({ newAmount: c.new_amount, changedAt: c.changed_at });
    budgetChangesByClient.set(c.client_id, list);
  }

  const performanceRecordsByClient = new Map<string, OperationClientRawData["performanceRecords"]>();
  for (const r of performanceRecords ?? []) {
    const list = performanceRecordsByClient.get(r.client_id) ?? [];
    list!.push({
      sprintId: r.sprint_id,
      channel: r.channel,
      resultType: r.result_type,
      resultCount: r.result_count,
      source: r.source,
      sourceUpdatedAt: r.source_updated_at,
    });
    performanceRecordsByClient.set(r.client_id, list);
  }

  const clientActivityById = new Map((clientActivity ?? []).map((r) => [r.client_id, r.last_activity_at]));
  const sprintActivityById = new Map((sprintActivity ?? []).map((r) => [r.sprint_id, r.last_activity_at]));
  const primaryManagerNameByClient = new Map(
    (clients ?? []).map((c) => [c.id, c.primary_manager?.name ?? null]),
  );

  // Etapa 70 — congela (lazy, idempotente) o histórico financeiro de cada
  // sprint do mês selecionado que já encerrou e ainda não tem snapshot;
  // roda em paralelo por cliente, nunca bloqueia o resto da página se uma
  // escrita falhar (`ensureClosedSprintSnapshots` já é silenciosa nesse
  // caso). Nunca altera a lógica mensal — só consome dados já buscados.
  const sprintClosedSnapshotsByClient = new Map<string, Map<string, SprintClosedSnapshot>>();
  await Promise.all(
    (clients ?? []).map(async (client) => {
      const clientBudgetChanges = budgetChangesByClient.get(client.id) ?? [];
      const clientPlannedAllocations = plannedAllocationsByClient.get(client.id) ?? [];
      const currentMonthlyBudget = resolveMonthlyBudget(
        clientBudgetChanges,
        sumPlannedForMonth(clientPlannedAllocations, monthRange),
      );
      const snapshots = await ensureClosedSprintSnapshots(supabase, {
        clientId: client.id,
        today,
        monthRange,
        sprints: sprintsByClient.get(client.id) ?? [],
        dailySpend: dailySpendByClient.get(client.id) ?? [],
        budgetChanges: clientBudgetChanges,
        plannedAllocations: clientPlannedAllocations,
        currentMonthlyBudget,
      });
      sprintClosedSnapshotsByClient.set(client.id, snapshots);
    }),
  );

  const rawClients: OperationClientRawData[] = (clients ?? []).map((client) => {
    const clientSprints = sprintsByClient.get(client.id) ?? [];
    const currentSprint = findSprintForDate(clientSprints, todayStr);

    return {
      id: client.id,
      name: client.name,
      metaAdAccountId: client.meta_ad_account_id,
      // Etapa 62: fonte única do gestor atribuído — clients.primary_manager_id.
      managerNames: client.primary_manager ? [client.primary_manager.name] : [],
      managerIds: client.primary_manager ? [client.primary_manager.id] : [],
      sprints: clientSprints,
      dailySpend: dailySpendByClient.get(client.id) ?? [],
      plannedAllocations: plannedAllocationsByClient.get(client.id) ?? [],
      monthlyBudgetChanges: budgetChangesByClient.get(client.id) ?? [],
      tasks: tasksByClient.get(client.id) ?? [],
      clientLastActivityAt: clientActivityById.get(client.id) ?? null,
      sprintLastActivityAt: currentSprint ? sprintActivityById.get(currentSprint.id) ?? null : null,
      lastSyncedAt: lastSyncedByClient.get(client.id) ?? null,
      lastReviewAt: lastReviewAtByClient.get(client.id) ?? null,
      sprintClosedSnapshots: sprintClosedSnapshotsByClient.get(client.id) ?? new Map(),
      performanceGoal: client.performance_goal,
      targetCostPerResult: client.target_cost_per_result,
      performanceRecords: performanceRecordsByClient.get(client.id) ?? [],
    };
  });

  const allCards = rawClients.map((client) => buildOperationClientCard(client, today, monthRange));

  const clientOptions = [...allCards]
    .map((card) => ({ id: card.clientId, name: card.clientName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let cards = allCards;

  if (managerFilter === "me") {
    cards = cards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  // Cliente inválido, inacessível, ou fora da carteira selecionada é
  // ignorado com segurança — mesma regra da Visão Geral (Etapa 39).
  const clientFilter = params.client && cards.some((card) => card.clientId === params.client) ? params.client : undefined;
  if (clientFilter) {
    cards = cards.filter((card) => card.clientId === clientFilter);
  }

  // "N clientes"/"N de M clientes" (seção 13): base = escopo escolhido
  // (carteira + cliente), antes dos filtros secundários abaixo.
  const baseCount = cards.length;

  if (ritmoFilter !== "todos") {
    cards = cards.filter((card) => financialStatusForPeriod(card, period) === ritmoFilter);
  }

  if (healthFilter === "sem_execucao") {
    cards = cards.filter((card) => card.sprintFilterBucket === "sem_execucao");
  } else if (healthFilter !== "todos") {
    cards = cards.filter((card) => card.accountHealth === healthFilter);
  }

  if (tasksFilter === "atrasadas") {
    cards = cards.filter((card) => periodOverdueCount(card, period, today) > 0);
  } else if (tasksFilter === "hoje") {
    cards = cards.filter((card) => card.todayAndOverdueTasks.some((t) => t.due_date === todayStr));
  } else if (tasksFilter === "sem_atrasadas") {
    cards = cards.filter((card) => periodOverdueCount(card, period, today) === 0);
  }

  if (optimizationFilter !== "todas") {
    cards = cards.filter((card) => {
      if (!card.lastOptimizationAt) return optimizationFilter === "nunca";
      if (optimizationFilter === "nunca") return false;
      const diffDays = Math.floor(
        (today.getTime() - new Date(`${card.lastOptimizationAt}T00:00:00Z`).getTime()) / OPTIMIZATION_DAY_MS,
      );
      if (optimizationFilter === "hoje") return diffDays <= 0;
      if (optimizationFilter === "7dias") return diffDays > 0 && diffDays <= 7;
      return diffDays > 7; // mais7
    });
  }

  if (activityFilter === "recente") {
    cards = cards.filter((card) => card.activityStatus === "ativo");
  } else if (activityFilter === "sem_recente") {
    cards = cards.filter((card) => card.activityStatus !== "ativo");
  }

  if (displayFilter === "atencao") {
    cards = cards.filter((card) => card.accountHealth !== "saudavel");
  } else if (displayFilter === "em_dia") {
    cards = cards.filter((card) => card.accountHealth === "saudavel");
  }

  // Fila operacional (seção 11): ordenação única por prioridade, sempre —
  // não é um filtro, é a ordem padrão das três visões.
  cards = sortAccountsByPriority(cards, period, today);

  const attentionCount = cards.filter((card) => card.accountHealth !== "saudavel").length;

  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    next.set("view", view);
    if (view === "monthly") next.set("grouping", grouping);
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
    if (view === "monthly" && params.month) next.set("month", params.month);
    if (healthFilter !== "todos") next.set("health", healthFilter);
    if (ritmoFilter !== "todos") next.set("ritmo", ritmoFilter);
    if (tasksFilter !== "todas") next.set("tasks", tasksFilter);
    if (optimizationFilter !== "todas") next.set("optimization", optimizationFilter);
    if (activityFilter !== "todos") next.set("activity", activityFilter);
    if (displayFilter !== "todos") next.set("display", displayFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/sprints?${next.toString()}`;
  };

  const monthLabel = formatMonthLabel(monthRange.firstDay);
  const monthTemporalStatus = getMonthTemporalStatus(monthRange, todayStr);

  const openTaskId = params.task ?? null;
  let openTask: {
    task: OperationTaskItem;
    clientId: string;
    clientName: string;
    sprintPeriodLabel: string | null;
    comments: CommentItem[];
  } | null = null;

  if (openTaskId) {
    for (const card of cards) {
      // Procura em qualquer tarefa visível do cliente nesta tela — sprint
      // atual, tarefas do mês (Consolidado) ou de qualquer sprint do mês
      // (Por sprints) — nunca só na sprint atual, senão o link de uma
      // tarefa de outra sprint do mês abriria a URL sem nunca achar a
      // tarefa (drawer nunca aparecia).
      const allClientTasks = [
        ...card.sprintTasks,
        ...card.monthTasks,
        ...Object.values(card.monthSprintTasks).flat(),
      ];
      const found = allClientTasks.find((t) => t.id === openTaskId);
      if (found) {
        const { data: comments } = await supabase
          .from("comments")
          .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
          .eq("commentable_type", "task")
          .eq("commentable_id", openTaskId)
          .order("created_at");
        openTask = {
          task: found,
          clientId: card.clientId,
          clientName: card.clientName,
          sprintPeriodLabel: card.sprintPeriodLabel,
          comments: comments ?? [],
        };
        break;
      }
    }
  }

  // Sprint UX 2.0 — "+ Registrar otimização" precisa saber PARA QUAL cliente
  // (a tela mostra vários), por isso o parâmetro extra `reviewClient` (a
  // página do cliente não precisa disso, o cliente já é o da própria rota).
  // Mesma regra defensiva do filtro de cliente (seção 39 acima): cliente
  // inválido ou fora do escopo atual é ignorado com segurança.
  const reviewClientId =
    params.review === "new" && params.reviewClient && cards.some((c) => c.clientId === params.reviewClient)
      ? params.reviewClient
      : undefined;

  const openReviewDetailRow = params.reviewDetail
    ? (sprintReviewRows ?? []).find((r) => r.id === params.reviewDetail) ?? null
    : null;
  const reviewDetail: AccountReviewDetail | null = openReviewDetailRow
    ? {
        id: openReviewDetailRow.id,
        reviewedAt: openReviewDetailRow.reviewed_at,
        managerName: openReviewDetailRow.team_member?.name ?? "Membro removido",
        reason: openReviewDetailRow.reason,
        reasonOtherDescription: openReviewDetailRow.reason_other_description,
        outcome: openReviewDetailRow.outcome,
        notes: openReviewDetailRow.notes,
        issueDescription: openReviewDetailRow.issue_description,
        issueCategory: openReviewDetailRow.issue_category,
        issueTaskTitle: openReviewDetailRow.issue_task?.title ?? null,
        secondsSincePreviousReview: openReviewDetailRow.seconds_since_previous_review,
        optimizations: openReviewDetailRow.optimizations.map((opt) => ({
          id: opt.id,
          type: opt.optimization_type,
          action: opt.optimization_action,
          description: opt.description,
          reason: opt.reason,
          expectedImpact: opt.expected_impact,
        })),
        clientUpdate: (() => {
          const update = clientUpdatesByReviewId.get(openReviewDetailRow.id);
          return update
            ? {
                id: update.id,
                content: update.content,
                sentAt: update.sent_at,
                sentByName: update.sent_by_profile?.name ?? null,
              }
            : null;
        })(),
      }
    : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <ScrollRestoreOnMount />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sprints</h1>
          <p className="text-sm text-muted-foreground">{formatFullDate(today)}</p>
        </div>
      </div>

      {(params.taskError || params.commentError) && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {params.taskError || params.commentError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABEL) as SprintsView[]).map((v) => (
            <Link
              key={v}
              href={buildUrl({
                view: v,
                month: v === "monthly" ? (params.month ?? "") : "",
                // Entrar em Mensal vindo de Sprint atual sempre cai em
                // Consolidado (o padrão); reclicar na aba já ativa preserva
                // o agrupamento que já estava selecionado.
                grouping: v === "monthly" ? (v === view ? grouping : "consolidated") : "",
              })}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                v === view
                  ? "bg-brand text-white"
                  : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>

        {view === "monthly" && (
          <div className="flex items-center gap-0.5 text-sm">
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              aria-label="Mês anterior"
            >
              &lsaquo;
            </Link>
            <span className="min-w-[8.5rem] text-center font-medium text-foreground">{monthLabel}</span>
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              aria-label="Próximo mês"
            >
              &rsaquo;
            </Link>
            {params.month && (
              <Link href={buildUrl({ month: "" })} className="ml-1.5 text-xs text-brand hover:underline">
                Mês atual
              </Link>
            )}
          </div>
        )}

        {view === "monthly" && (
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs">
            {(Object.keys(GROUPING_LABEL) as MonthlyGrouping[]).map((g) => (
              <Link
                key={g}
                href={buildUrl({ grouping: g })}
                className={`rounded px-2 py-1 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  g === grouping
                    ? "bg-brand/10 text-brand"
                    : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                {GROUPING_LABEL[g]}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3">
        <SprintsFilters
          clients={clientOptions}
          selectedClientId={clientFilter}
          view={view}
          grouping={grouping}
          month={view === "monthly" ? params.month : undefined}
          isAdmin={isAdmin}
          gestores={gestores ?? []}
          manager={managerFilter}
          health={healthFilter}
          ritmo={ritmoFilter}
          tasks={tasksFilter}
          optimization={optimizationFilter}
          activity={activityFilter}
          display={displayFilter}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length !== baseCount ? `${cards.length} de ${baseCount} clientes` : `${baseCount} cliente${baseCount !== 1 ? "s" : ""}`}
        {attentionCount > 0 && ` · ${attentionCount} precisa${attentionCount !== 1 ? "m" : ""} de atenção`}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {cards.length > 0 ? (
          view === "current" ? (
            cards.map((card) => (
              <SprintCurrentClientGroup
                key={card.clientId}
                card={card}
                returnTo={buildUrl({})}
                primaryManagerName={primaryManagerNameByClient.get(card.clientId) ?? null}
                isAdmin={isAdmin}
                comments={card.sprint ? sprintCommentsById.get(card.sprint.sprintId) ?? [] : []}
                accountReviews={card.sprint ? accountReviewsBySprintId.get(card.sprint.sprintId) ?? [] : []}
              />
            ))
          ) : grouping === "consolidated" ? (
            cards.map((card) => (
              <SprintMonthlyConsolidatedGroup
                key={card.clientId}
                card={card}
                monthLabel={monthLabel}
                monthRange={monthRange}
                primaryManagerName={primaryManagerNameByClient.get(card.clientId) ?? null}
                returnTo={buildUrl({})}
                accountReviewsBySprintId={accountReviewsBySprintId}
                monthTemporalStatus={monthTemporalStatus}
              />
            ))
          ) : (
            cards.map((card) => (
              <SprintMonthlyBySprintsGroup
                key={card.clientId}
                card={card}
                monthLabel={monthLabel}
                monthRange={monthRange}
                primaryManagerName={primaryManagerNameByClient.get(card.clientId) ?? null}
                isAdmin={isAdmin}
                returnTo={buildUrl({})}
                sprintCommentsById={sprintCommentsById}
                accountReviewsBySprintId={accountReviewsBySprintId}
                monthTemporalStatus={monthTemporalStatus}
              />
            ))
          )
        ) : (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum cliente encontrado com esses filtros.
          </p>
        )}
      </div>

      {openTask && (
        <TaskDrawerPanel
          task={openTask.task}
          clientId={openTask.clientId}
          clientName={openTask.clientName}
          sprintPeriodLabel={openTask.sprintPeriodLabel}
          comments={openTask.comments}
          closeHref={buildUrl({ task: "" })}
          returnTo={buildUrl({ task: "" })}
          isAdmin={isAdmin}
        />
      )}

      {reviewClientId && (
        <RecordAccountReviewDrawer
          clientId={reviewClientId}
          closeHref={buildUrl({})}
          managers={gestores ?? []}
          error={params.reviewError}
        />
      )}

      {reviewDetail && openReviewDetailRow && (
        <AccountReviewDetailDrawer review={reviewDetail} clientId={openReviewDetailRow.client_id} closeHref={buildUrl({})} />
      )}
    </div>
  );
}
