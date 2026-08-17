import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { perfNow, perfLog } from "@/lib/perf-log";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { todayUTC, todayDateString } from "@/lib/today";
import {
  currentMonthRange,
  findSprintForDate,
  isDateWithinPeriod,
  monthRangeFromParam,
  shiftMonthParam,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatMonthLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { getMonthTemporalStatus, resolveMonthlyBudget, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { getClientMonthHorizons } from "@/lib/client-month-horizons";
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
import { groupChannelSpendBySprintId, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import type { AccountReviewSummaryItem } from "@/app/clients/account-reviews-section";
import { RecordAccountReviewDrawer } from "@/app/clients/record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "@/app/clients/account-review-detail-drawer";
import { computeClientUpdateStatus } from "@/lib/client-updates";
import { fetchRecurringTaskDetail, fetchRecurringTaskListsForSprints } from "@/lib/recurring-task-data";
import { RecurringTaskDrawer } from "@/app/clients/recurring-task-drawer";
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
import { ROW_GRID_CLASSES } from "./row-grid";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { SprintsContextMemory } from "./context-memory-client";

type SprintsView = "current" | "monthly";
type MonthlyGrouping = "consolidated" | "sprints";

/** Reconstrução do cabeçalho (aproximação de UX a partir de uma referência
 * visual) — as 3 combinações de view+grouping viram abas únicas, lado a
 * lado, em vez de uma aba "Mensal" com um segundo controle aninhado só
 * pra escolher o agrupamento. Mesmas 3 combinações de sempre, só a
 * apresentação muda (nenhum novo estado, nenhuma URL nova). */
const TABS = [
  { key: "current", label: "Sprint atual", view: "current" as SprintsView, grouping: undefined },
  { key: "monthly-consolidated", label: "Mensal consolidado", view: "monthly" as SprintsView, grouping: "consolidated" as MonthlyGrouping },
  { key: "monthly-sprints", label: "Mensal por sprints", view: "monthly" as SprintsView, grouping: "sprints" as MonthlyGrouping },
] as const;

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
    review?: string;
    reviewClient?: string;
    reviewDetail?: string;
    reviewError?: string;
    recurringTaskDetail?: string;
    recurringTaskClient?: string;
    recurringTaskSprint?: string;
    recurringTaskError?: string;
  }>;
}) {
  // Instrumentação temporária (Navigation Performance & Perceived Speed 1.0)
  // — só console.log no servidor, sem dado pessoal/token; remover depois de
  // confirmado o ganho em produção.
  const __perfPageStart = perfNow();

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

  const __perfBlock1Start = perfNow();
  const [clients, gestores, sprints, dailySpend, tasks, plannedAllocations, budgetChanges, channelSpendRows] = await Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select(
          "id, name, meta_ad_account_id, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
        )
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Sobreposição com a janela (não "começa na janela") — sprint que
    // atravessa mês precisa ser encontrada mesmo com start_date fora dela.
    requireQuery(
      supabase
        .from("sprints")
        .select(
          "id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
        )
        .lte("start_date", rangeEnd)
        .gte("end_date", rangeStart),
      "sprints",
    ),
    requireQuery(
      supabase
        .from("daily_spend")
        .select("client_id, date, spend, synced_at")
        .gte("date", rangeStart)
        .lte("date", rangeEnd),
      "daily_spend",
    ),
    requireQuery(
      supabase
        .from("tasks")
        .select(
          "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
        ),
      "tasks",
    ),
    requireQuery(
      supabase
        .from("sprint_planned_allocations")
        .select("client_id, sprint_id, date, planned_amount")
        .gte("date", rangeStart)
        .lte("date", rangeEnd),
      "sprint_planned_allocations",
    ),
    // Orçamento vigente (Etapa 66) — só do mês SELECIONADO (`monthRange`),
    // não da janela união com o mês corrente. Etapa "Migração Multicanal dos
    // Consumidores": todos os canais (nunca mais só `channel = 'meta'`) —
    // `resolveConsolidatedMonthlyPlanned` (chamada dentro de
    // `buildOperationClientCard`) soma os canais com plano.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, channel, month, new_amount, changed_at")
        .eq("month", monthRange.firstDay),
      "monthly_budget_changes",
    ),
    // Investimento manual multicanal (`sprint_channel_spend`, adotada como
    // fonte de verdade — ver `resolveManualActualSpend`, lib/effective-spend.ts)
    // — mesma busca sem filtro já usada pela Visão Geral (`page.tsx`), a
    // tabela é pequena (uma linha por sprint+canal com override lançado).
    requireQuery(
      supabase.from("sprint_channel_spend").select("client_id, sprint_id, channel, spend_source, manual_actual_spend"),
      "sprint_channel_spend",
    ),
  ]);
  perfLog("sprints bloco 1 (clients/team_members/sprints/daily_spend/tasks/allocations/budget)", __perfBlock1Start);

  const clientIds = clients.map((c) => c.id);
  // Etapa "Horizonte de Planejamento": clientes de evento (campanha que
  // termina antes do fim do mês) — mapa vazio pra quem não tem nenhum,
  // comportamento idêntico a antes desta etapa.
  const monthHorizonsByClient = await getClientMonthHorizons(supabase, clientIds, monthRange.firstDay);
  const allSprintIds = sprints.map((s) => s.id);
  const currentSprintIds = sprints
    .filter((s) => isDateWithinPeriod(todayStr, s.start_date, s.end_date))
    .map((s) => s.id);
  // Etapa 71: só as sprints que de fato pertencem ao mês SELECIONADO (não a
  // janela união com o mês corrente) — igual à Visão Geral, pra nunca somar
  // no consolidado mensal um resultado de uma sprint de outro mês.
  const monthSprintsForPerformance = sprints.filter(
    (s) => s.start_date <= monthRange.lastDay && s.end_date >= monthRange.firstDay,
  );

  // Comentários de TODAS as sprints visíveis, buscados em lote uma única vez
  // (não por card) — pra o mesmo SprintCard da página do cliente também
  // mostrar comentários aqui, sem virar N+1.
  const __perfBlock2Start = perfNow();
  const [clientActivity, sprintActivity, sprintComments, performanceRecords] = await Promise.all([
    clientIds.length > 0
      ? requireQuery(
          supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds),
          "client_last_operational_activity",
        )
      : Promise.resolve([]),
    currentSprintIds.length > 0
      ? requireQuery(
          supabase
            .from("sprint_last_operational_activity")
            .select("sprint_id, last_activity_at")
            .in("sprint_id", currentSprintIds),
          "sprint_last_operational_activity",
        )
      : Promise.resolve([]),
    allSprintIds.length > 0
      ? requireQuery(
          supabase
            .from("comments")
            .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
            .eq("commentable_type", "sprint")
            .in("commentable_id", allSprintIds)
            .order("created_at"),
          "comments",
        )
      : Promise.resolve([]),
    // Integração Stract (arquitetura aprovada — ver DECISIONS.md):
    // `resolvePerformanceRowsForSprints` decide, por cliente, entre
    // `performance_records` (manual) e `daily_performance` (Stract) — nunca
    // as duas somadas. Mesmo formato de linha de antes.
    resolvePerformanceRowsForSprints(
      supabase,
      monthSprintsForPerformance.map((s) => ({ id: s.id, client_id: s.client_id, start_date: s.start_date, end_date: s.end_date })),
    ),
  ]);
  perfLog("sprints bloco 2 (atividade/comentários/performance)", __perfBlock2Start);

  // Navigation Performance & Perceived Speed 1.0: lastReviews, sprintReviewRows
  // e reportSelections não dependem umas das outras — só de clientIds/
  // allSprintIds/allCommentIds, já disponíveis desde os blocos anteriores —
  // então rodam num único Promise.all em vez de 3 round-trips sequenciais.
  const allCommentIds = sprintComments.map((c) => c.id);

  const __perfBlock3Start = perfNow();
  const [lastReviews, sprintReviewRows, reportSelections, recurringTasksBySprintId] = await Promise.all([
    // Etapa 74 — "Última otimização"/filtro "optimization": sempre o dado
    // GLOBAL mais recente por cliente (independe do mês selecionado), por
    // isso uma busca própria sem filtro de data — mesma fonte usada na Visão
    // Geral e no Acompanhamento da Conta (account_reviews.reviewed_at).
    clientIds.length > 0
      ? requireQuery(
          supabase
            .from("account_reviews")
            .select("client_id, reviewed_at")
            .in("client_id", clientIds)
            .order("reviewed_at", { ascending: false }),
          "account_reviews:last-reviews",
        )
      : Promise.resolve([]),
    // Sprint UX 2.0 — "Otimizações" (account_reviews) direto na tela Sprints,
    // igual à página do cliente: mesma query rica (Etapa 57), só filtrada
    // pelas sprints já visíveis nesta tela (allSprintIds) em vez de por
    // cliente, pra cobrir as 3 visões com uma única busca.
    allSprintIds.length > 0
      ? requireQuery(
          supabase
            .from("account_reviews")
            .select(
              "id, client_id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact, quantity), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
            )
            .in("sprint_id", allSprintIds)
            .order("reviewed_at", { ascending: false }),
          "account_reviews:sprint-reviews",
        )
      : Promise.resolve([]),
    allCommentIds.length > 0
      ? requireQuery(
          supabase.from("report_comment_selections").select("comment_id").in("comment_id", allCommentIds),
          "report_comment_selections",
        )
      : Promise.resolve([]),
    // Reformulação do sistema de tarefas (28/07) — recorrências (Checar
    // saldo/Reportar cliente/Otimização) de todas as sprints visíveis nesta
    // tela, batched (mesmo motivo de sprintReviewRows acima: nunca uma
    // consulta por sprint). Hoje sempre retorna vazio (nenhuma linha em
    // `recurring_tasks` até a migração final rodar) — zero mudança de
    // comportamento em produção enquanto isso não acontece.
    fetchRecurringTaskListsForSprints(supabase, sprints, todayStr),
  ]);
  perfLog("sprints bloco 3 fundido (lastReviews/sprintReviewRows/reportSelections, antes eram 3 round-trips sequenciais)", __perfBlock3Start);

  const lastReviewAtByClient = new Map<string, string>();
  for (const row of lastReviews) {
    if (!lastReviewAtByClient.has(row.client_id)) lastReviewAtByClient.set(row.client_id, row.reviewed_at);
  }

  // reviewClientUpdateRows depende de reviewIds (resultado de sprintReviewRows
  // acima) — continua sequencial, não dá pra paralelizar com o bloco anterior.
  const reviewIds = sprintReviewRows.map((r) => r.id);
  const reviewClientUpdateRows =
    reviewIds.length > 0
      ? await requireQuery(
          supabase
            .from("client_updates")
            .select(
              "id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)",
            )
            .in("account_review_id", reviewIds),
          "client_updates",
        )
      : [];
  const clientUpdatesByReviewId = new Map(reviewClientUpdateRows.map((row) => [row.account_review_id, row]));

  const accountReviewsBySprintId = new Map<string, AccountReviewSummaryItem[]>();
  for (const review of sprintReviewRows) {
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
  // Investimento manual multicanal — resolve `manual_actual_spend` de cada
  // sprint ANTES de agrupar por cliente, pra `ensureClosedSprintSnapshots` e
  // `buildOperationClientCard` (abaixo) herdarem o valor certo sem
  // duplicar a regra (ver `resolveManualActualSpend`, lib/effective-spend.ts).
  const channelSpendBySprintId = groupChannelSpendBySprintId(
    (channelSpendRows ?? []).map((r) => ({
      sprintId: r.sprint_id,
      channel: r.channel,
      spend_source: r.spend_source,
      manual_actual_spend: r.manual_actual_spend,
    })),
  );
  // Mesma lista, agrupada por CLIENTE (não por sprint) — o pré-preenchimento
  // do formulário de investimento (`buildEditableInvestmentValues`, dentro de
  // `buildOperationClientCard`) precisa da lista bruta por cliente, mesmo
  // padrão já usado pela Visão Geral (`page.tsx`).
  const channelOverridesByClient = new Map<string, SprintChannelSpendOverrideRow[]>();
  for (const o of channelSpendRows ?? []) {
    const list = channelOverridesByClient.get(o.client_id) ?? [];
    list.push({ sprintId: o.sprint_id, channel: o.channel, spend_source: o.spend_source, manual_actual_spend: o.manual_actual_spend });
    channelOverridesByClient.set(o.client_id, list);
  }

  const sprintsByClient = new Map<string, SprintRow[]>();
  for (const s of sprints ?? []) {
    const resolvedSprint: SprintRow = {
      ...s,
      manual_actual_spend: resolveManualActualSpend(s.manual_actual_spend, channelSpendBySprintId.get(s.id) ?? []),
    };
    const list = sprintsByClient.get(s.client_id) ?? [];
    list.push(resolvedSprint);
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
    list.push({ channel: c.channel as TrafficChannel, month: c.month, newAmount: c.new_amount, changedAt: c.changed_at });
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
      revenue: r.revenue,
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
      // Etapa "Horizonte de Planejamento": o congelamento de sprint fechada
      // (planejamento original/recomendação) usa o horizonte OPERACIONAL do
      // cliente, não o mês civil cru — cliente sem horizonte configurado
      // continua idêntico (resolvePlanningHorizon devolve monthRange).
      const snapshots = await ensureClosedSprintSnapshots(supabase, {
        clientId: client.id,
        today,
        monthRange: resolvePlanningHorizon(monthRange, monthHorizonsByClient.get(client.id) ?? null),
        sprints: sprintsByClient.get(client.id) ?? [],
        dailySpend: dailySpendByClient.get(client.id) ?? [],
        budgetChanges: clientBudgetChanges,
        plannedAllocations: clientPlannedAllocations,
        currentMonthlyBudget,
      });
      sprintClosedSnapshotsByClient.set(client.id, snapshots);
    }),
  );
  perfLog("sprints — dados totais carregados (auth + queries)", __perfPageStart);

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
      channelSpendOverrides: channelOverridesByClient.get(client.id) ?? [],
    };
  });

  const allCards = rawClients.map((client) =>
    buildOperationClientCard(client, today, monthRange, resolvePlanningHorizon(monthRange, monthHorizonsByClient.get(client.id) ?? null)),
  );

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
          quantity: opt.quantity,
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

  // Fase "Drawer das recorrentes" — buscado sob demanda (só quando o drawer
  // está aberto), ao contrário de `accountReviewsBySprintId` (que já vem
  // pronto pra tela inteira): "Histórico" mostra TODO o passado do cliente
  // pra essa recorrência, não só o que já está carregado pro mês/sprints
  // visíveis nesta tela.
  const recurringTaskSprint = params.recurringTaskSprint ? sprints.find((s) => s.id === params.recurringTaskSprint) ?? null : null;
  const recurringTaskDetail =
    params.recurringTaskDetail && params.recurringTaskClient && recurringTaskSprint
      ? await fetchRecurringTaskDetail(supabase, params.recurringTaskDetail, params.recurringTaskClient, recurringTaskSprint, todayStr)
      : null;
  // Etapa "Reports": o módulo de geração só existe na página do cliente —
  // o CTA "Gerar report" aberto a partir daqui sempre navega pra lá (nunca
  // um wizard próprio nesta tela), com cliente/período/recorrência já
  // resolvidos, igual ao mesmo CTA dentro de `/clients/[id]`.
  const recurringTaskReportHref =
    params.recurringTaskClient && recurringTaskSprint
      ? `/clients/${params.recurringTaskClient}?clientReport=new&reportRecurringTaskId=${params.recurringTaskDetail}&reportPeriodStart=${recurringTaskSprint.start_date}&reportPeriodEnd=${recurringTaskSprint.end_date}`
      : null;

  const activeTabKey =
    view === "current" ? "current" : grouping === "consolidated" ? "monthly-consolidated" : "monthly-sprints";

  return (
    <div className="mx-auto max-w-6xl px-6 py-4">
      <ScrollRestoreOnMount />
      <SprintsContextMemory
        view={view}
        grouping={view === "monthly" ? grouping : undefined}
        month={view === "monthly" ? params.month : undefined}
        manager={managerFilter}
        health={healthFilter}
        ritmo={ritmoFilter}
        tasks={tasksFilter}
        optimization={optimizationFilter}
        activity={activityFilter}
        display={displayFilter}
        client={clientFilter}
      />

      {/* Linha 1 — só os controles, alinhados à direita (Etapa "Sprint
          Workspace Polish 2.0", Parte 5): título "Sprints" e subtítulo
          removidos — a navegação por abas logo abaixo já deixa claro onde o
          usuário está, repetir o nome da tela aqui era redundante e custava
          uma linha inteira de espaço vertical. Nenhum filtro/funcionalidade
          mudou, só a disposição visual. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {view === "monthly" && (
          <div className="flex h-8 items-center gap-0.5 rounded-md border border-overview-border px-1 text-sm">
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
              scroll={false}
              className="rounded px-1 text-overview-text-primary hover:bg-overview-surface-hover"
              aria-label="Mês anterior"
            >
              &lsaquo;
            </Link>
            <span className="min-w-[7.5rem] text-center text-xs font-medium text-overview-text-primary">{monthLabel}</span>
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
              scroll={false}
              className="rounded px-1 text-overview-text-primary hover:bg-overview-surface-hover"
              aria-label="Próximo mês"
            >
              &rsaquo;
            </Link>
            {params.month && (
              <Link href={buildUrl({ month: "" })} scroll={false} className="ml-1 text-[11px] text-brand hover:underline">
                Hoje
              </Link>
            )}
          </div>
        )}

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

      {params.taskError && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {params.taskError}
        </p>
      )}

      {/* Linha 2 — abas: as 3 combinações de view+grouping ficam lado a
          lado (Sprint atual / Mensal consolidado / Mensal por sprints),
          direto abaixo do cabeçalho, sem virar uma segunda barra de
          ferramentas (texto + sublinhado, não pílulas/caixas). */}
      <div role="tablist" className="mt-2.5 flex items-center gap-4 border-b border-overview-border text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={buildUrl({ view: tab.view, month: tab.grouping ? (params.month ?? "") : "", grouping: tab.grouping ?? "" })}
            scroll={false}
            role="tab"
            aria-selected={tab.key === activeTabKey}
            className={`-mb-px border-b-2 pb-1.5 font-medium transition-colors ${
              tab.key === activeTabKey
                ? "border-brand text-brand"
                : "border-transparent text-overview-text-secondary hover:text-overview-text-primary"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <p className="mt-2 text-xs text-overview-text-secondary">
        {cards.length !== baseCount ? `${cards.length} de ${baseCount} clientes` : `${baseCount} cliente${baseCount !== 1 ? "s" : ""}`}
        {attentionCount > 0 && ` · ${attentionCount} precisa${attentionCount !== 1 ? "m" : ""} de atenção`}
      </p>

      {/* Sprint UX 2.0 Fase 3: cabeçalho de colunas — mesmo grid da linha do
          cliente/sprint (`ROW_GRID_CLASSES`), pra deixar explícito que a
          lista é uma tabela de verdade (leitura vertical por coluna), não
          um bloco de texto corrido. Só desktop (a lista em telas estreitas
          já quebra as colunas em texto empilhado — repetir esses rótulos lá
          seria ruído sem a mesma grade visual por trás). Etapa "Painel
          Operacional 1.0": "Status"/"Tarefas"/"Otimiz." (3 rótulos) viraram
          "Progresso" (1) — ver doc de `ROW_GRID_CLASSES`. */}
      {cards.length > 0 && (
        <div className="mt-3 flex items-center gap-2 px-2.5">
          {/* Espaçador invisível do mesmo tamanho do "▸" + gap de cada linha
              abaixo — sem ele, as colunas do cabeçalho não alinham com as
              colunas reais (cada linha tem um caret antes da própria grade). */}
          <span aria-hidden="true" className="invisible shrink-0 text-xs">▸</span>
          <div
            className={`flex-1 text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted ${ROW_GRID_CLASSES}`}
          >
            <span />
            <span>Cliente / Gestor</span>
            <span>Investimento</span>
            <span>Progresso</span>
          </div>
        </div>
      )}

      <div className="mt-1.5 flex flex-col gap-1.5">
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
                recurringTasks={card.sprint ? recurringTasksBySprintId.get(card.sprint.sprintId) ?? [] : []}
                managers={gestores ?? []}
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
                monthTemporalStatus={getMonthTemporalStatus(
                  resolvePlanningHorizon(monthRange, monthHorizonsByClient.get(card.clientId) ?? null),
                  todayStr,
                )}
                isAdmin={isAdmin}
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
                recurringTasksBySprintId={recurringTasksBySprintId}
                monthTemporalStatus={getMonthTemporalStatus(
                  resolvePlanningHorizon(monthRange, monthHorizonsByClient.get(card.clientId) ?? null),
                  todayStr,
                )}
                managers={gestores ?? []}
              />
            ))
          )
        ) : (
          <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
            <EmptyState>Nenhum cliente encontrado com esses filtros.</EmptyState>
          </div>
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
          managers={gestores ?? []}
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

      {recurringTaskDetail && params.recurringTaskClient && (
        <RecurringTaskDrawer
          detail={recurringTaskDetail}
          clientId={params.recurringTaskClient}
          closeHref={buildUrl({})}
          reportHref={recurringTaskReportHref}
        />
      )}
    </div>
  );
}
