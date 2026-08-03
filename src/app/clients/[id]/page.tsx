import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  getActiveImportSourceChannelsForClient,
  getEnabledImportSourceIdsForClient,
  getImportSourceHealthIssue,
  resolvePerformanceRowsForSprints,
} from "@/lib/performance-queries";
import {
  assertSingleCurrentSprint,
  computeSprintFinancials,
  currentMonthRange,
  monthRangeFromParam,
  resolveSprintEffectiveSpend,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { classifySpendStatus, SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL } from "@/lib/spend-status";
import {
  resolveBudgetEffectiveDate,
  resolveMonthlyBudget,
  resolveMonthlyPerformanceTargets,
  computeMonthlyExpectedToDateByCalendar,
} from "@/lib/monthly-budget";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatCurrency, formatMonthLabel, formatRelativeDateTime } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import { fetchClientOperationalHistory } from "@/lib/client-operational-history";
import { effectiveTaskStatus } from "@/lib/task-status";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL, contractStatusBannerText, isWorkspaceClient } from "@/lib/client-fields";
import { syncClientMetaAction } from "../meta-actions";
import { syncClientStractSourcesAction } from "../stract-sync-actions";
import { ClientIdentitySticky } from "../client-identity-sticky";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { MonthInvestmentSummary } from "../month-investment-summary";
import { SprintCard } from "../sprint-card";
import { MonthTasksPanel } from "../month-tasks-panel";
import { Section } from "../section";
import { AccountFollowUpPanel, type LastOptimizationInfo } from "../account-follow-up-panel";
import { ClientOperationalHistoryDrawer } from "../client-operational-history-drawer";
import { EssentialInfoPanel } from "../essential-info-panel";
import type { CommentItem } from "../comment-thread";
import type { TaskListItem } from "../task-row";
import { RecordAccountReviewDrawer } from "../record-account-review-drawer";
import { AccountReviewDetailDrawer, type AccountReviewDetail } from "../account-review-detail-drawer";
import { generateClientUpdateAction } from "../client-update-actions";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import type { OperationTaskItem, PerformanceRecordRawRow } from "@/app/operation/operation-data";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { MonthlyBudgetHistoryDrawer } from "../monthly-budget-history-drawer";
import {
  aggregatePerformanceResults,
  buildEditableChannelValues,
  buildSprintPerformanceView,
  computePerformanceSummary,
  deriveMonthlyKpiTexts,
} from "@/lib/performance";
import type { SprintPerformanceProps } from "../sprint-card";
import { ClientHistoryList } from "../client-history-list";
import { fetchRecurringTaskDetail, fetchRecurringTaskListsForSprints } from "@/lib/recurring-task-data";
import { RecurringTaskDrawer } from "../recurring-task-drawer";
import { defaultReportPeriod } from "@/lib/client-reports";
import { fetchClientReportDetail } from "../client-report-data";
import { ClientReportWizard } from "../client-report-wizard";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { fetchClientAnalyticsData } from "../analytics-data";
import { AnalyticsSection } from "../analytics-section";
import { getAdCreativeDailyMetricsForPeriod } from "@/lib/creative-analytics-data";
import { buildCreativeDetail, buildCreativeSummaries } from "@/lib/creative-analytics";
import { CreativeAnalyticsSection } from "../creative-analytics-section";
import { buildCampaignSummaries } from "@/lib/campaign-analytics";
import { getCampaignDailyMetricsForPeriod } from "@/lib/campaign-analytics-data";
import { AnalyticsCampaignsSection } from "../analytics-campaigns-section";
import { AnalyticsInsightsSection } from "../analytics-insights-section";
import { AnalyticsHubHeader } from "../analytics-hub-header";
import { AnalyticsHubNav } from "../analytics-hub-nav";
import { AnalyticsPlatformSwitch } from "../analytics-platform-switch";
import { GoogleNotConnectedState } from "../google-not-connected-state";
import { CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE } from "@/lib/analytics-messages";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";

async function fetchCommentsByType(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  type: "sprint" | "task",
  ids: string[],
): Promise<CommentItem[]> {
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("comments")
    .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
    .eq("commentable_type", type)
    .in("commentable_id", ids)
    .order("created_at");

  return data ?? [];
}

function groupByCommentableId(comments: CommentItem[]): Map<string, CommentItem[]> {
  const map = new Map<string, CommentItem[]>();
  for (const comment of comments) {
    const list = map.get(comment.commentable_id) ?? [];
    list.push(comment);
    map.set(comment.commentable_id, list);
  }
  return map;
}

/** Anexa `?param` (ou `&param` se a URL já tiver query string) — necessário
 * a partir da Etapa 62 porque `returnTo` agora pode já carregar `?month=...`
 * (contexto temporal da página inteira), então nenhum href pode mais
 * simplesmente concatenar "?" sem checar. */
function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

function groupBySprintId(
  tasks: (TaskListItem & { sprint_id: string | null })[],
): { bySprintId: Map<string, TaskListItem[]>; unlinked: TaskListItem[] } {
  const bySprintId = new Map<string, TaskListItem[]>();
  const unlinked: TaskListItem[] = [];

  for (const { sprint_id, ...task } of tasks) {
    if (!sprint_id) {
      unlinked.push(task);
      continue;
    }
    const list = bySprintId.get(sprint_id) ?? [];
    list.push(task);
    bySprintId.set(sprint_id, list);
  }

  return { bySprintId, unlinked };
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    synced?: string;
    stractSynced?: string;
    saved?: string;
    taskError?: string;
    task?: string;
    historicoOrcamento?: string;
    review?: string;
    reviewDetail?: string;
    reviewError?: string;
    reviewsHistory?: string;
    reviewSaved?: string;
    clientUpdateError?: string;
    month?: string;
    historyPage?: string;
    area?: string;
    recurringTaskDetail?: string;
    recurringTaskSprint?: string;
    recurringTaskError?: string;
    clientReport?: string;
    reportRecurringTaskId?: string;
    reportPeriodStart?: string;
    reportPeriodEnd?: string;
    analyticsPreset?: string;
    analyticsStart?: string;
    analyticsEnd?: string;
    analyticsSection?: string;
    analyticsPlatform?: string;
    creative?: string;
  }>;
}) {
  const { id } = await params;
  const {
    error,
    synced,
    stractSynced,
    saved,
    taskError,
    task: openTaskId,
    historicoOrcamento,
    review: openReview,
    reviewDetail: openReviewDetailId,
    reviewError,
    reviewsHistory,
    reviewSaved,
    clientUpdateError,
    month: monthQueryParam,
    historyPage: historyPageParam,
    area: areaParam,
    recurringTaskDetail: openRecurringTaskId,
    recurringTaskSprint: openRecurringTaskSprintId,
    recurringTaskError,
    clientReport: clientReportParam,
    reportRecurringTaskId,
    reportPeriodStart: reportPeriodStartParam,
    reportPeriodEnd: reportPeriodEndParam,
    analyticsPreset: analyticsPresetParam,
    analyticsStart: analyticsStartParam,
    analyticsEnd: analyticsEndParam,
    analyticsSection: analyticsSectionParam,
    analyticsPlatform: analyticsPlatformParam,
    creative: creativeParam,
  } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  // Etapa "Reorganização do hub de Analytics": a plataforma deixou de ser
  // "um lugar pra ver relatórios" e virou "um lugar pra entender a
  // operação" (pedido explícito do usuário). Analytics agora é o hub
  // central de inteligência — absorveu a antiga aba "Relatórios" (pendências
  // + linha do tempo curada + fechar/reabrir mês, sub-seção "Ações") e a
  // antiga aba "Criativos" (sub-seção "Criativos"), além de ganhar duas
  // sub-seções novas ("Campanhas" e "Insights"). Só restam 3 áreas de nível
  // superior: Visão Geral (trabalho operacional do dia a dia), Analytics
  // (hub de inteligência) e Timeline (consulta ao histórico automático).
  type ClientArea = "visao-geral" | "analytics" | "timeline";
  const AREA_TABS: { key: ClientArea; label: string }[] = [
    { key: "visao-geral", label: "Visão geral" },
    { key: "analytics", label: "Analytics" },
    { key: "timeline", label: "Timeline" },
  ];
  const activeArea = (AREA_TABS.some((t) => t.key === areaParam) ? areaParam : "visao-geral") as ClientArea;
  const buildAreaHref = (area: ClientArea) => `/clients/${id}?area=${area}${monthQueryParam ? `&month=${monthQueryParam}` : ""}`;

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, contract_start_date, primary_manager_id, primary_manager:team_members!clients_primary_manager_id_fkey(name), main_objective, main_product_or_service, operation_region, primary_audience, client_differentials, client_restrictions, important_seasonal_dates, operational_summary, important_notes, performance_goal, target_cost_per_result, avatar_url, dashboard_url, balance_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!client) notFound();

  // Princípio "Workspace = só cliente ativo": estado único derivado de
  // `client.status`, passado adiante (nunca recalculado em cada botão)
  // pra decidir o que a página oferece como ação nova — pausado/encerrado
  // continua em modo de consulta (histórico, tarefas, sprints visíveis),
  // só não cria nada novo (tarefa, comentário, otimização).
  const canOperate = isWorkspaceClient(client);

  // "Sincronizar agora" (Etapa "Sincronização manual via UI") — o botão só
  // aparece quando o cliente tem pelo menos 1 fonte Stract ativa; a mesma
  // lista de ids é o que a action dispara.
  const stractImportSourceIds = await getEnabledImportSourceIdsForClient(supabase, id);

  // Habilitar Gestores 1.0: "Atualizar performance" (investimento realizado
  // + resultados da sprint) deixou de ser admin-only — o gestor responsável
  // por este cliente também pode, senão não consegue registrar a própria
  // execução do dia a dia. "Responsável" cobre as duas formas de
  // atribuição que existem no cadastro do cliente: estar em
  // `client_managers` ("Gestores de apoio") OU ser o `primary_manager_id`
  // ("Gestor principal", o que aparece no cabeçalho da página) — achado
  // real em produção: um gestor só-principal não tinha nenhuma das duas
  // permissões antes desta correção. Mesmo critério de `is_client_manager()`
  // no RLS (ver supabase/is-client-manager-include-primary.sql).
  const isAssignedManager = isAdmin
    ? false
    : client.primary_manager_id === profile?.id ||
      Boolean(
        (
          await supabase
            .from("client_managers")
            .select("client_id")
            .eq("client_id", id)
            .eq("user_id", profile?.id ?? "")
            .maybeSingle()
        ).data,
      );
  // Habilitar Gestores 3.0: mesmo critério passa a valer pro Cadastro do
  // Cliente inteiro (editar dados cadastrais) — daí o nome mais genérico;
  // continua sendo repassado como `canEditPerformance` pro SprintCard, que
  // é o nome específico que aquele componente já usa.
  const canManageClient = isAdmin || isAssignedManager;

  // Etapa 53: "hoje" tinha que ser SEMPRE todayUTC() (meia-noite UTC do dia
  // civil no fuso America/Sao_Paulo) — usar `new Date()` puro aqui fazia a
  // sprint atual virar errada bem à noite no Brasil (21h–23h59), quando o
  // relógio UTC real já tinha virado o dia seguinte mas em São Paulo ainda
  // era o dia anterior.
  const today = todayUTC();
  const todayStr = todayDateString();
  // Bug real encontrado em produção: `today` (meia-noite UTC do dia civil,
  // certo pra comparar com colunas `date` sem fuso) NUNCA deve alimentar
  // `formatRelativeDateTime`/`formatRelativeShortDateTime` — essas funções
  // esperam um INSTANTE real ("agora"), não uma meia-noite civil; passar
  // `today` fazia `diffCalendarDaysInAppTimezone` reconverter esse valor já
  // truncado pelo fuso de novo, empurrando a referência um dia pra trás e
  // rotulando a sincronização de ONTEM como "Hoje" (o timestamp exibido
  // parecia estar no futuro em relação ao horário real). `nowInstant` é o
  // único valor correto pra essas duas chamadas.
  const nowInstant = new Date();
  // Etapa 62 — contexto temporal global da página: `?month=YYYY-MM` decide
  // o período de TUDO que é temporal (sprints, investimento, tarefas do
  // período, análises/otimizações/reuniões/entregas do Acompanhamento da
  // Conta) — reaproveita exatamente os mesmos helpers já usados por
  // Relatórios/Visão Geral/Sprints (`monthRangeFromParam`/`shiftMonthParam`),
  // nenhum parsing de mês novo. Informações cadastrais do cliente (nome,
  // status contratual, tempo de relacionamento, dados estruturais no fim da
  // página) continuam fora do filtro — não fazem sentido "por mês".
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;
  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const prevMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, 1)}`;

  // Etapa 50 (correção): a geração de sprints não roda mais durante o
  // carregamento da página — só via /api/cron/ensure-sprints.
  const [sprints, dailySpend, lastSync, plannedAllocations, budgetChanges, performanceTargetHistory] =
    await Promise.all([
      // Sobreposição com o mês (não "começa no mês") — uma sprint que
      // atravessa a fronteira (ex.: 27/jul-02/ago) precisa aparecer aqui
      // mesmo com start_date no mês anterior.
      requireQuery(
        supabase
          .from("sprints")
          .select(
            "id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at, original_planned_amount, final_recommended_amount, final_actual_amount, snapshot_frozen_at",
          )
          .eq("client_id", id)
          .lte("start_date", lastDay)
          .gte("end_date", firstDay)
          .order("start_date"),
        "sprints",
      ),
      requireQuery(
        supabase.from("daily_spend").select("date, spend").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "daily_spend",
      ),
      requireQuery<{ synced_at: string } | null>(
        supabase
          .from("daily_spend")
          .select("synced_at")
          .eq("client_id", id)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "daily_spend:last-sync",
      ),
      requireQuery(
        supabase
          .from("sprint_planned_allocations")
          .select("sprint_id, date, planned_amount")
          .eq("client_id", id)
          .gte("date", firstDay)
          .lte("date", lastDay),
        "sprint_planned_allocations",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select(
            "id, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
          )
          .eq("client_id", id)
          .eq("month", firstDay)
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:current-month",
      ),
      // Metas do planejamento mensal vigente (Etapa "Planejamento Mensal
      // 1.0") — deliberadamente `.lte` em vez de `.eq`: a versão vigente do
      // mês selecionado pode ter sido definida num mês anterior (ver
      // `resolveMonthlyPerformanceTargets`), diferente da consulta de
      // `budgetChanges` acima (que é só o HISTÓRICO deste mês específico).
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("month, changed_at, target_result_count, target_cost_per_result")
          .eq("client_id", id)
          .lte("month", firstDay)
          .order("month", { ascending: false })
          .order("changed_at", { ascending: false })
          .limit(1),
        "monthly_budget_changes:target-history",
      ),
    ]);

  // Etapa 71: registros de performance de todas as sprints do mês
  // selecionado — sempre por sprint (nenhum lançamento manual mensal
  // independente, ver migration), nunca uma query por sprint.
  // Integração Stract (arquitetura aprovada — ver DECISIONS.md):
  // `resolvePerformanceRowsForSprints` decide, por cliente, entre
  // `performance_records` (manual) e `daily_performance` (Stract) — nunca
  // as duas somadas. Mesmo formato de linha de antes, então nada abaixo
  // precisa mudar.
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

  assertSingleCurrentSprint(sprints, today);
  const sprintFinancials = sprints.map((sprint) => {
    const { actual: actualSpend, effectiveSource } = resolveSprintEffectiveSpend(sprint, dailySpend ?? []);
    return computeSprintFinancials(sprint, actualSpend, today, effectiveSource);
  });
  // Etapa 65: última edição do gasto manual, por sprint — `SprintFinancials`
  // não carrega esse campo (não é usado por ninguém além do card expandido),
  // então em vez de estender o tipo pros outros consumidores dela, um mapa à
  // parte a partir da própria linha crua já buscada acima.
  const manualSpendUpdatedAtBySprintId = new Map((sprints ?? []).map((s) => [s.id, s.manual_spend_updated_at]));

  // Etapa 70: `sprint_planned_allocations` deixou de alimentar o card da
  // sprint (o "planejamento histórico" virou o "planejamento original"
  // congelado, `sprint-recommendation.ts`) — continua existindo só como
  // fallback de `resolveMonthlyBudget`, abaixo.
  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Etapa 66: orçamento mensal VIGENTE — sempre o valor mais recente
  // configurado (`monthly_budget_changes.new_amount`), nunca a soma dos
  // planejamentos diários persistidos (que diverge do vigente assim que o
  // planejado histórico não bate com o realizado histórico — a regra, não a
  // exceção). `sumPlannedForMonth` só entra como fallback pra cliente que
  // nunca passou pelo editor de orçamento (sem nenhuma linha em
  // monthly_budget_changes ainda).
  const monthPlanned = resolveMonthlyBudget(
    (budgetChanges ?? []).map((c) => ({ newAmount: c.new_amount, changedAt: c.changed_at })),
    sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay }),
  );
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);
  // Etapa 73: a camada de planejamento/recomendação POR SPRINT saiu da
  // interface operacional (fica só no nível mensal) — `computeOriginalSprintPlans`/
  // `monthPlan.sprintPlans` deixaram de alimentar qualquer componente aqui.
  // `ensureClosedSprintSnapshots` continua rodando (preserva o congelamento
  // histórico em `sprints.original_planned_amount`/`final_recommended_amount`
  // pra uma eventual reativação futura), só o valor devolvido não é mais
  // lido por ninguém nesta página.
  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: { firstDay, lastDay },
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: (budgetChanges ?? []).map((c) => ({ newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: monthPlanned,
  });
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente,
  // independente de sprints/planejamentos antigos (mesma função central
  // usada em toda a Visão Geral/Sprints/Relatório — ver operation-data.ts).
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(
    monthPlanned,
    { firstDay, lastDay },
    todayStr,
  ).expectedToDate;
  // Ritmo do mês: realizado x esperado até hoje, nunca x 100% do planejado
  // antes do mês acabar (mesma regra agora usada em toda a Visão Geral/
  // Sprints — ver operation-data.ts).
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);
  // Etapa 61: única lista "Sprints de {mês}" (ver render abaixo) — mesma
  // ordem cronológica crescente por data de início já usada em todo o
  // resto do sistema, aqui explícita em vez de depender da ordem da query.
  const sortedSprints = [...sprintFinancials].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Etapa 71 — camada de PERFORMANCE: consome `monthActual`/`sprint.actualSpend`
  // já calculados acima, nunca uma segunda fonte de investimento. Consolidado
  // do mês é sempre a soma direta dos registros já escopados às sprints do
  // mês selecionado (nenhum lançamento manual mensal independente).
  const performanceGoal = client.performance_goal;
  // Etapa "Planejamento Mensal 1.0": meta de custo vigente vem do
  // planejamento mensal (com `clients.target_cost_per_result` como
  // fallback só pra quem nunca teve nenhuma versão de planejamento) —
  // nunca mais lido direto de `clients` sem passar por este resolvedor.
  const resolvedTargets = resolveMonthlyPerformanceTargets(
    (performanceTargetHistory ?? []).map((row) => ({
      month: row.month,
      changedAt: row.changed_at,
      targetResultCount: row.target_result_count,
      targetCostPerResult: row.target_cost_per_result,
    })),
    firstDay,
    client.target_cost_per_result,
  );
  const targetCostPerResult = resolvedTargets.targetCostPerResult;
  const targetResultCount = resolvedTargets.targetResultCount;
  const monthPerformanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult,
      })
    : null;
  const monthPerformanceChannelBreakdown = performanceGoal
    ? AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({
        channel,
        resultCount: aggregatePerformanceResults(performanceRecords, performanceGoal, channel).resultCount,
      })).filter((entry) => entry.resultCount > 0)
    : [];
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
      performanceGoal,
    });
  }

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate({ firstDay, lastDay }, todayStr);
  // Etapa 64: mês selecionado ainda não começou — usado só pra escolher o
  // texto da seção "Investimento do mês" (nunca uma segunda comparação de
  // datas: "não é o mês corrente" + "não está encerrado" já implica futuro,
  // dado que todo mês é ou passado, ou corrente, ou futuro).
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  // `budgetSprints` alimenta só `MonthInvestmentSummary` agora (Etapa 73) —
  // esta página não computa mais `computeMonthlyBudgetPlan` por conta própria
  // pra derivar planejamento por sprint; o componente mensal já calcula seu
  // próprio plano internamente a partir dos valores brutos recebidos.
  const budgetSprints = sprintFinancials.map((sprint) => ({
    sprintId: sprint.sprintId,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  }));
  const lastBudgetChange = budgetChanges[0] ?? null;
  const lastChange = lastBudgetChange
    ? {
        lastEffectiveDate: lastBudgetChange.effective_date,
        lastPreviousAmount: lastBudgetChange.previous_amount,
        lastNewAmount: lastBudgetChange.new_amount,
        changeCountThisMonth: budgetChanges.length,
      }
    : null;

  const tasks = await requireQuery(
    supabase
      .from("tasks")
      .select(
        "id, title, type, due_date, due_time, status, sprint_id, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
      )
      .eq("client_id", id)
      .order("due_date"),
    "tasks",
  );

  // Etapa 62: a janela fixa de 60 dias (Etapa 57) foi substituída por uma
  // busca sem filtro de data (as últimas 200 análises do cliente — teto
  // generoso, nunca deveria ser atingido na prática) porque agora o mesmo
  // conjunto precisa responder a DUAS perguntas diferentes: "qual a última
  // análise/otimização de verdade" (mês atual — pode estar em qualquer mês
  // passado) e "quais análises/otimizações aconteceram DENTRO do mês
  // selecionado" (mês anterior, Etapa 8) — uma janela fixa de 60 dias
  // quebraria a segunda pergunta pra qualquer mês mais antigo que isso.
  const [accountReviewRows, managers, clientUpdateRows] = await Promise.all([
    requireQuery(
      supabase
        .from("account_reviews")
        .select(
          "id, sprint_id, reviewed_at, reason, reason_other_description, outcome, notes, issue_description, issue_category, seconds_since_previous_review, team_member:team_members!account_reviews_team_member_id_fkey(name), optimizations:account_optimizations(id, optimization_type, optimization_action, description, reason, expected_impact, quantity), issue_task:tasks!account_reviews_issue_task_id_fkey(title)",
        )
        .eq("client_id", id)
        .order("reviewed_at", { ascending: false })
        .limit(200),
      "account_reviews",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Etapa 59 — Atualização para o Cliente: uma linha por análise (no
    // máximo), buscada junto com o resto da página; nenhuma query separada
    // por análise (nem pro indicador discreto nem pro conteúdo do drawer).
    requireQuery(
      supabase
        .from("client_updates")
        .select(
          "id, account_review_id, content, copied_at, sent_at, sent_by_profile:team_members!client_updates_sent_by_fkey(name)",
        )
        .eq("client_id", id),
      "client_updates",
    ),
  ]);

  const clientUpdatesByReviewId = new Map(clientUpdateRows.map((row) => [row.account_review_id, row]));

  const accountReviews = accountReviewRows;

  // Etapa 74 — "Última otimização": no mês atual é sempre o dado GLOBAL mais
  // recente (accountReviews já vem ordenado desc, então é só o primeiro
  // item); num mês anterior, é o mais recente DENTRO do mês selecionado.
  // Um único indicador pra qualquer resultado da revisão (alteração
  // realizada, sem alteração necessária, ou problema identificado) — nunca
  // dois indicadores separados pro mesmo evento.
  const reviewsInMonth = accountReviews.filter(
    (r) => r.reviewed_at >= `${firstDay}T00:00:00Z` && r.reviewed_at <= `${lastDay}T23:59:59.999Z`,
  );
  const reviewsForLastLookup = isCurrentMonth ? accountReviews : reviewsInMonth;

  const lastOptimizationSource = reviewsForLastLookup[0] ?? null;
  const lastOptimization: LastOptimizationInfo | null = lastOptimizationSource
    ? {
        reviewedAt: lastOptimizationSource.reviewed_at,
        managerName: lastOptimizationSource.team_member?.name ?? "Membro removido",
        outcome: lastOptimizationSource.outcome,
        optimizationTypes: lastOptimizationSource.optimizations.map((o) => o.optimization_type),
        issueDescription: lastOptimizationSource.issue_description,
      }
    : null;

  const [sprintComments, taskComments] = await Promise.all([
    fetchCommentsByType(
      supabase,
      "sprint",
      sprintFinancials.map((sprint) => sprint.sprintId),
    ),
    fetchCommentsByType(
      supabase,
      "task",
      (tasks ?? []).map((task) => task.id),
    ),
  ]);

  const sprintCommentsById = groupByCommentableId(sprintComments);
  const taskCommentsById = groupByCommentableId(taskComments);
  const { bySprintId: tasksBySprintId, unlinked: unlinkedTasksAllTime } = groupBySprintId(tasks ?? []);
  // Etapa 62, seção 6: "tarefas do período" respeitam o mês selecionado —
  // as vinculadas a uma sprint já ficam implicitamente restritas (cada
  // sprint só aparece se pertencer ao mês selecionado); só a lista solta
  // (sem sprint) precisava do filtro explícito aqui.
  const unlinkedTasks = unlinkedTasksAllTime.filter((task) => task.due_date >= firstDay && task.due_date <= lastDay);

  // Etapa 62, seção 9 — histórico unificado do mês (análises + otimizações
  // + reuniões/entregas com desfecho), reaproveitando 100% operational_events
  // (ver lib/client-operational-history.ts). O card mostra só as 5 mais
  // recentes; "Ver todos de {mês}" abre a mesma consulta paginada (15 por
  // página, mesmo padrão de `fetchTeamMemberTimeline`).
  // Etapa "MITZA 2.0 — Refinamento da Experiência do Cliente": a aba
  // Timeline agora é o próprio conteúdo (não mais um link redirecionando
  // pro drawer) — a busca paginada completa passa a rodar também quando ela
  // está ativa, não só quando o drawer "Ver todos de {mês}" está aberto.
  const historyPage = Math.max(0, Number(historyPageParam) || 0);
  const shouldLoadFullHistory = Boolean(reviewsHistory) || activeArea === "timeline";
  const [{ rows: recentHistoryRows, hasMore: hasMoreHistory }, fullHistory] = await Promise.all([
    fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, 0, 5),
    shouldLoadFullHistory
      ? fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, historyPage)
      : Promise.resolve({ rows: [], hasMore: false }),
  ]);

  const contractBannerText = contractStatusBannerText(client.status);

  // "Se uma conexão do Stract falhar e não trouxer dados novos, quero que a
  // plataforma sinalize isso" — antes, `import_sources.status` existia só no
  // banco, sem nenhuma tela lendo o campo (ver `lib/stract-sync.ts`). Sempre
  // buscado (não só na aba Analytics): o gestor precisa ver isso não importa
  // em qual aba do cliente esteja.
  const importSourceHealthIssue = await getImportSourceHealthIssue(supabase, id);
  const importSourceHealthBannerText =
    importSourceHealthIssue?.status === "error"
      ? "A integração com o Stract falhou na última sincronização — os dados de performance podem estar desatualizados."
      : importSourceHealthIssue?.status === "no_data"
        ? "A última sincronização com o Stract não retornou nenhum dado — verifique se a conexão continua ativa."
        : null;

  const banners = [
    contractBannerText && {
      tone: "amber",
      text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.`,
    },
    importSourceHealthBannerText && { tone: "red", text: importSourceHealthBannerText },
    error && { tone: "red", text: error },
    taskError && { tone: "red", text: taskError },
    reviewError && { tone: "red", text: reviewError },
    recurringTaskError && { tone: "red", text: recurringTaskError },
    clientUpdateError && { tone: "red", text: clientUpdateError },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    stractSynced && { tone: "green", text: `${stractSynced} fonte(s) sincronizada(s) com sucesso.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green" | "amber"; text: string } => Boolean(banner));

  const returnTo = `/clients/${client.id}${monthQuery}`;

  // Reformulação do sistema de tarefas (28/07) — recorrências na aba
  // "Tarefas de {mês}" (MonthTasksPanel): só reportadas quando o mês exibido
  // é o CORRENTE (um mês passado/futuro não tem uma sprint "atual" óbvia pra
  // reportar progresso semanal contra — o histórico completo dessas sprints
  // continua disponível no drawer/em /sprints). `currentSprintForRecurring`
  // é a mesma sprint que `assertSingleCurrentSprint` já garante ser única.
  const currentSprintForRecurring = isCurrentMonth ? sprintFinancials.find((s) => s.temporalStatus === "atual") ?? null : null;
  const recurringTasksForCurrentSprint = currentSprintForRecurring
    ? (
        await fetchRecurringTaskListsForSprints(
          supabase,
          [
            {
              id: currentSprintForRecurring.sprintId,
              client_id: client.id,
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
      ? await fetchRecurringTaskDetail(supabase, openRecurringTaskId, client.id, recurringTaskSprintForDrawer, todayStr)
      : null;
  // Etapa "Reports": href pronto pro CTA "Gerar report" dentro do drawer da
  // recorrência "Reportar cliente" — período sugerido é sempre o da sprint
  // em que o drawer foi aberto (editável no wizard, nunca imposto).
  const recurringTaskReportHref = recurringTaskSprintForDrawer
    ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}clientReport=new&reportRecurringTaskId=${openRecurringTaskId}&reportPeriodStart=${recurringTaskSprintForDrawer.start_date}&reportPeriodEnd=${recurringTaskSprintForDrawer.end_date}`
    : null;
  const openReviewDetail = openReviewDetailId ? accountReviews.find((r) => r.id === openReviewDetailId) ?? null : null;
  const reviewDetail: AccountReviewDetail | null = openReviewDetail
    ? {
        id: openReviewDetail.id,
        reviewedAt: openReviewDetail.reviewed_at,
        managerName: openReviewDetail.team_member?.name ?? "Membro removido",
        reason: openReviewDetail.reason,
        reasonOtherDescription: openReviewDetail.reason_other_description,
        outcome: openReviewDetail.outcome,
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
  const historyDrawerHref = withParam(returnTo, "historicoOrcamento=1");
  const historyDrawerCloseHref = returnTo;
  const reviewsHistoryHref = withParam(returnTo, "reviewsHistory=1");
  const buildHistoryPageHref = (page: number) => withParam(withParam(returnTo, "reviewsHistory=1"), `historyPage=${page}`);
  const buildReviewDetailHref = (reviewId: string) => withParam(returnTo, `reviewDetail=${reviewId}`);
  // Etapa "MITZA 2.0 — Refinamento da Experiência do Cliente": paginação da
  // Timeline preserva a área/mês ativos (`buildAreaHref`), nunca o parâmetro
  // `reviewsHistory` do drawer (fluxos diferentes, mesma consulta paginada).
  const buildTimelineHistoryPageHref = (page: number) => withParam(buildAreaHref("timeline"), `historyPage=${page}`);
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
  const openTaskSprint = openTaskRow?.sprint_id
    ? (sprintFinancials.find((s) => s.sprintId === openTaskRow.sprint_id) ?? null)
    : null;
  const openTaskSprintPeriodLabel = openTaskSprint
    ? formatSprintPeriodLabel(openTaskSprint.startDate, openTaskSprint.endDate)
    : null;

  // Identificação do cliente (Etapa 74) — substitui o antigo ClientContextBar
  // (subheader sticky compartilhado por toda /clients/[id]/**, removido).
  // Status já aparece como badge ao lado do nome, por isso não se repete
  // na linha secundária abaixo.
  // Etapa "Resumo Executivo": "Ver relatório" volta a apontar pra
  // `/reports/${client.id}` (pendências/timeline/fechamento de mês) — a
  // sub-seção "Ações" do Analytics foi removida (pedido explícito do
  // usuário: "ela não representa inteligência, pertence a outro lugar da
  // plataforma"). A rota nunca deixou de existir; só deixou de ser
  // alcançável a partir do hub por um tempo, entre as duas reorganizações.
  const reportHref = `/reports/${client.id}${monthQueryParam ? `?month=${monthQueryParam}` : ""}`;
  // Etapa "Cabeçalho enxuto": a segunda linha do cabeçalho responde só
  // "quem é o responsável?" — conta Meta (`meta_ad_account_id`) e tempo de
  // relacionamento (`contract_start_date`) são dados técnicos/administrativos
  // que deixam de aparecer aqui (nenhum dado removido do banco, nenhuma
  // query alterada — só a renderização no cabeçalho principal). Continuam
  // disponíveis pra uma futura tela de Configurações/Editar.
  const identitySecondaryLine = client.primary_manager
    ? `Gestor: ${client.primary_manager.name}`
    : "Sem gestor atribuído";

  // Cabeçalho da conta — dois indicadores independentes (Etapa "Dois
  // relógios no cabeçalho"): "Última otimização" responde "a operação está
  // sendo acompanhada?" (evento do GESTOR, mesma fonte de sempre,
  // `lastOptimization`/`account_reviews.reviewed_at`, calculado acima — só
  // reposicionado, antes vivia em AccountActivitySummary junto de "Próxima
  // reunião"/"Próxima entrega", removidas por não fazerem mais parte do
  // fluxo operacional). "Última atualização da performance" responde "os
  // números que estou vendo estão atualizados?" (evento da SINCRONIZAÇÃO de
  // dados, `performance_records.source_updated_at`, já resolvido por
  // `monthPerformanceSummary.latestUpdatedAt`/`latestSource` — o mesmo dado
  // que antes alimentava o rodapé discreto do card de KPIs, ver
  // `monthly-kpi-summary.tsx`: nunca duplicar a mesma informação em dois
  // lugares da página, por isso saiu de lá). Nunca confundir os dois: um
  // cliente pode estar sendo otimizado ativamente com dados de performance
  // desatualizados, e vice-versa.
  const lastOptimizationLabel = isCurrentMonth ? "Última otimização" : `Última otimização em ${monthLabel}`;
  const lastOptimizationValue = lastOptimization
    ? formatRelativeDateTime(lastOptimization.reviewedAt, nowInstant)
    : "Nenhuma otimização registrada";
  const lastOptimizationDetail = lastOptimization
    ? lastOptimization.outcome === "OPTIMIZATION_PERFORMED"
      ? lastOptimization.optimizationTypes.length === 1
        ? OPTIMIZATION_TYPE_LABEL[lastOptimization.optimizationTypes[0]]
        : lastOptimization.optimizationTypes.length > 1
          ? `${lastOptimization.optimizationTypes.length} alterações`
          : null
      : lastOptimization.outcome === "ISSUE_IDENTIFIED"
        ? lastOptimization.issueDescription
        : null
    : null;

  const lastPerformanceUpdateLabel = isCurrentMonth
    ? "Última atualização da performance"
    : `Atualização da performance em ${monthLabel}`;
  const lastPerformanceUpdateValue = monthPerformanceSummary?.latestUpdatedAt
    ? formatRelativeDateTime(monthPerformanceSummary.latestUpdatedAt, nowInstant)
    : "Sem sincronização registrada";
  const lastPerformanceUpdateSourceLabel =
    monthPerformanceSummary?.latestSource === "manual"
      ? "Manual"
      : monthPerformanceSummary?.latestSource === "meta"
        ? "Meta"
        : monthPerformanceSummary?.latestSource === "google"
          ? "Google"
          : null;

  // Etapa "Resumo Executivo": Analytics é o hub único de inteligência da
  // conta, com 4 sub-seções (Resumo/Criativos/Campanhas/Insights) navegadas
  // por `analyticsSection` — nunca abas irmãs próprias. A antiga sub-seção
  // "Ações" (pendências/timeline/histórico de report) foi removida daqui:
  // pedido explícito do usuário ("ela não representa inteligência, pertence
  // a outro lugar da plataforma"; no futuro, uma área própria de Pendências
  // e Operação). O módulo `client_reports` (Report/WhatsApp) continua
  // existindo sem alteração, só não é mais alcançável a partir do Analytics
  // — permanece acessível pelo drawer "Reportar cliente" da recorrência.
  // Todo dado abaixo só é buscado quando `activeArea === "analytics"`
  // (nenhuma query extra fora do hub); dentro do hub, cada busca é recortada
  // pela sub-seção que realmente precisa dela.
  const ANALYTICS_HUB_SECTIONS = ["resumo", "criativos", "campanhas", "insights"] as const;
  type AnalyticsHubSectionValue = (typeof ANALYTICS_HUB_SECTIONS)[number];
  const analyticsSection = (
    ANALYTICS_HUB_SECTIONS.includes(analyticsSectionParam as AnalyticsHubSectionValue) ? analyticsSectionParam : "resumo"
  ) as AnalyticsHubSectionValue;
  const isAnalyticsArea = activeArea === "analytics";

  // O wizard do `client_reports` (novo report ou reabertura de um existente)
  // é independente da área/sub-seção ativa — só é aberto a partir do drawer
  // da recorrência ("Reportar cliente"), em qualquer lugar da página, por
  // isso `clientReportParam` é lido fora de qualquer `if` de área e o
  // `closeHref` do wizard é sempre `returnTo`.
  const isNewClientReport = clientReportParam === "new";
  const clientReportDetail =
    clientReportParam && !isNewClientReport ? await fetchClientReportDetail(supabase, id, clientReportParam) : null;
  const suggestedReportPeriod =
    reportPeriodStartParam && reportPeriodEndParam
      ? { start: reportPeriodStartParam, end: reportPeriodEndParam }
      : defaultReportPeriod(todayStr);

  // Analytics MVP — leitura pura dos dados já existentes (nenhuma tabela
  // nova, nenhum snapshot salvo); período ÚNICO do hub inteiro (Resumo,
  // Criativos e Campanhas compartilham o mesmo seletor — antes cada
  // sub-seção tinha o seu próprio, redundância eliminada nesta
  // reorganização), sempre independente de sprint e do mês selecionado no
  // resto da página.
  const analyticsPreset = (analyticsPresetParam ?? "this_month") as AnalyticsPeriodPreset;
  const analyticsPeriod = resolveAnalyticsPeriod(analyticsPresetParam, todayStr, {
    start: analyticsStartParam,
    end: analyticsEndParam,
  });

  // Integração Google Ads — seletor de plataforma "Meta Ads | Google Ads".
  // Meta é sempre o padrão (pedido explícito do usuário: "manter a
  // experiência atual"); controla TODA a aba de Analytics (Resumo, gráfico,
  // Campanhas, PDF exportado), nunca só uma sub-seção. Nunca consolida os
  // dois canais na mesma visualização — cada um é uma leitura exclusiva.
  const analyticsPlatform: TrafficChannel = AVAILABLE_TRAFFIC_CHANNELS.includes(analyticsPlatformParam as TrafficChannel)
    ? (analyticsPlatformParam as TrafficChannel)
    : "meta";
  // "Conectado" só é uma pergunta real pra Google (Meta pode vir de
  // performance_records manual, sem nenhuma import_sources — sempre
  // continua funcionando como hoje). `import_sources` é a única fonte de
  // verdade pra essa pergunta, nunca inferida de daily_spend/daily_performance.
  const activeImportChannels = isAnalyticsArea ? await getActiveImportSourceChannelsForClient(supabase, id) : new Set<string>();
  const showPlatformNotConnected = isAnalyticsArea && analyticsPlatform === "google" && !activeImportChannels.has("google");

  const analyticsData =
    isAnalyticsArea && analyticsSection === "resumo" && !showPlatformNotConnected
      ? await fetchClientAnalyticsData(supabase, id, analyticsPeriod, analyticsPlatform)
      : null;
  const analyticsBaseHref = buildAreaHref("analytics");
  // Hrefs derivados do mesmo `analyticsBaseHref`, cada um preservando os
  // parâmetros que o OUTRO controle vai mudar: a navegação entre sub-seções
  // preserva período+plataforma (nunca reseta pra "this_month"/Meta ao
  // trocar de aba dentro do hub), o seletor de período preserva
  // seção+plataforma, e o seletor de plataforma preserva período+seção.
  const analyticsPeriodQuery = `analyticsPreset=${analyticsPreset}${
    analyticsPreset === "custom"
      ? `&analyticsStart=${analyticsStartParam ?? analyticsPeriod.start}&analyticsEnd=${analyticsEndParam ?? analyticsPeriod.end}`
      : ""
  }`;
  const analyticsPlatformQuery = `analyticsPlatform=${analyticsPlatform}`;
  const analyticsNavBaseHref = `${analyticsBaseHref}&${analyticsPeriodQuery}&${analyticsPlatformQuery}`;
  const analyticsHeaderBaseHref = `${analyticsBaseHref}&analyticsSection=${analyticsSection}&${analyticsPlatformQuery}`;
  const analyticsPlatformSwitchBaseHref = `${analyticsBaseHref}&${analyticsPeriodQuery}&analyticsSection=${analyticsSection}`;
  // AnalyticsReport (Fase 3) — mesmo período E plataforma selecionados no
  // hub, nunca um segundo seletor pro relatório; o download é um `<a>`
  // normal, o navegador trata o `Content-Disposition: attachment` nativamente.
  const exportHref = `/api/clients/${id}/analytics-report?${analyticsPeriodQuery}&${analyticsPlatformQuery}`;

  // Módulo de Criativos (Creative Analytics) — mesmo período único do hub
  // acima (antes tinha seletor próprio). Nunca gated por
  // `client.performance_goal` (pedido explícito do usuário) — a
  // consolidação por criativo roda igual pra qualquer cliente, mostrando só
  // os indicadores que a fonte entrega. Buscado uma vez só, reaproveitado
  // por Criativos E Resumo (Destaques do período reaproveita os mesmos
  // agregados — ver `lib/period-highlights.ts`). Integração Google Ads:
  // Criativos continua exclusivamente Meta (pedido explícito do usuário:
  // "não implementar criativos Google") — nunca busca nada quando a
  // plataforma selecionada é Google, `ad_creative_daily_metrics` nunca
  // ganha canal. Campanhas NÃO depende mais desta busca (ver bloco abaixo).
  const needsAdCreativeRows =
    isAnalyticsArea && analyticsPlatform === "meta" && (analyticsSection === "resumo" || analyticsSection === "criativos");
  const adCreativeRows = needsAdCreativeRows ? await getAdCreativeDailyMetricsForPeriod(supabase, id, analyticsPeriod) : [];
  const creativeSummaries =
    analyticsSection === "resumo" || analyticsSection === "criativos" ? buildCreativeSummaries(adCreativeRows) : [];
  const creativeDetail =
    isAnalyticsArea && analyticsSection === "criativos" && creativeParam ? buildCreativeDetail(adCreativeRows, creativeParam) : null;
  // Preserva período+plataforma (nunca reseta ao entrar no detalhe de um
  // criativo) — mesmo cuidado de `customStart`/`customEnd` já usado pro
  // seletor de período em si.
  const buildCreativeDetailHref = (creativeName: string) => {
    const params = new URLSearchParams({ analyticsPreset, analyticsSection: "criativos", analyticsPlatform });
    if (analyticsPreset === "custom") {
      params.set("analyticsStart", analyticsStartParam ?? analyticsPeriod.start);
      params.set("analyticsEnd", analyticsEndParam ?? analyticsPeriod.end);
    }
    params.set("creative", creativeName);
    return `${analyticsBaseHref}&${params.toString()}`;
  };

  // Seção "Campanhas" — Integração Google Ads: camada independente de
  // Criativos desde a origem (`campaign_daily_metrics`, channel-aware,
  // populada sempre que `campaign_name_column` existir, nunca condicionada
  // a `ad_name_column`). Etapa "Resumo Executivo": sem variação % vs
  // período anterior (removida a pedido do usuário), por isso não busca
  // mais um segundo período aqui. Filtragem por `analyticsPlatform` ocorre
  // aqui, na camada de dados, antes das funções puras de agregação — nunca
  // mistura Meta e Google na mesma leitura.
  const needsCampaignRows =
    isAnalyticsArea && (analyticsSection === "resumo" || analyticsSection === "campanhas") && !showPlatformNotConnected;
  const campaignDailyMetricRows = needsCampaignRows
    ? (await getCampaignDailyMetricsForPeriod(supabase, id, analyticsPeriod)).filter((row) => row.channel === analyticsPlatform)
    : [];
  const campaignSummaries =
    (analyticsSection === "resumo" || analyticsSection === "campanhas") && !showPlatformNotConnected
      ? buildCampaignSummaries(campaignDailyMetricRows)
      : [];

  // Etapa "MITZA 2.0 — Refinamento da Experiência do Cliente" — "Resumo
  // consolidado do mês": nenhum dado novo, só uma leitura de fechamento
  // reunindo números já calculados acima (investimento, performance,
  // tarefas do mês inteiro — sprints + soltas), como se fosse "mais uma
  // sprint", representando o mês inteiro.
  const monthKpiTexts = deriveMonthlyKpiTexts(performanceGoal, monthPerformanceSummary, formatCurrency);
  const monthTaskRows = [...sortedSprints.flatMap((sprint) => tasksBySprintId.get(sprint.sprintId) ?? []), ...unlinkedTasks];
  const monthTasksTotal = monthTaskRows.length;
  const monthTasksDone = monthTaskRows.filter((task) => effectiveTaskStatus(task, today) === "feito").length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <ScrollRestoreOnMount />

      {/* 1. Identificação do cliente — substitui o antigo ClientContextBar
          (subheader sticky compartilhado por toda /clients/[id]/**).
          Hierarquia inspirada no Relatório: avatar + nome em destaque +
          badge de status na mesma linha, contexto secundário (gestor/
          conta Meta/tempo de relacionamento) abaixo, ações agrupadas à
          direita. Nenhuma "Semana atual" aqui — já aparece no seletor de
          período, logo abaixo.
          Etapa "MITZA 2.0 — Refinamento da Identidade do Cliente": o
          avatar (foto ou iniciais, ClientAvatar já usado na Operação) e os
          atalhos "Dashboard"/"Saldo" (links externos configuráveis no
          cadastro, abrem em nova aba, só aparecem quando configurados)
          passam a fazer parte desta mesma identificação — nenhum botão
          solto em outro lugar da página. */}
      <ClientWorkspaceContext name={client.name} />
      {/* Etapa "Cabeçalho: hierarquia visual" — três blocos claramente
          separados (identidade → estado operacional → atualização da
          performance), reproduzindo a distribuição do mockup aprovado:
          identidade + ações à esquerda, dois cards compactos à direita.
          Nenhum dado novo: os dois cards só reempacotam as variáveis
          lastOptimization e lastPerformanceUpdate (já calculadas acima)
          num cartão com a mesma borda/cantos/fundo (border-border +
          rounded-lg + bg-card) usada no resto da plataforma (ver
          AccountFollowUpPanel), em vez de texto solto no cabeçalho. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ClientAvatar name={client.name} imageUrl={client.avatar_url} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{client.name}</h1>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}
                >
                  {CLIENT_STATUS_LABEL[client.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{identitySecondaryLine}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {client.dashboard_url && (
              <a
                href={client.dashboard_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Dashboard
              </a>
            )}
            {client.balance_url && (
              <a
                href={client.balance_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Saldo
              </a>
            )}
            <Link
              href={reportHref}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Ver relatório
            </Link>
            {canManageClient && (
              <Link
                href={`/clients/${client.id}/edit`}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                Editar
              </Link>
            )}
            {canOperate && (
              <form action={syncClientMetaAction.bind(null, client.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Atualizar Meta
                </button>
              </form>
            )}
            {canOperate && stractImportSourceIds.length > 0 && (
              <form action={syncClientStractSourcesAction.bind(null, client.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Sincronizar agora
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="w-full rounded-lg border border-border bg-card p-3 sm:w-56">
            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <ClipboardCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
              {lastOptimizationLabel}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">{lastOptimizationValue}</p>
            {lastOptimization && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {ACCOUNT_REVIEW_OUTCOME_LABEL[lastOptimization.outcome]}
                {lastOptimizationDetail ? ` · ${lastOptimizationDetail}` : ""}
              </p>
            )}
          </div>
          <div className="w-full rounded-lg border border-border bg-card p-3 sm:w-56">
            <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <BarChart3 className="h-3 w-3 shrink-0" aria-hidden="true" />
              {lastPerformanceUpdateLabel}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">{lastPerformanceUpdateValue}</p>
            {lastPerformanceUpdateSourceLabel && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">Origem: {lastPerformanceUpdateSourceLabel}</p>
            )}
          </div>
        </div>
      </div>

      {/* Identificação mínima durante a rolagem — avatar + nome + status,
          some sozinha ao voltar pro topo (ver client-identity-sticky.tsx). */}
      <ClientIdentitySticky
        clientName={client.name}
        avatarUrl={client.avatar_url}
        statusLabel={CLIENT_STATUS_LABEL[client.status]}
        statusBadgeClass={CLIENT_STATUS_BADGE_CLASSES[client.status]}
      />

      {banners.length > 0 && (
        <div className="flex flex-col gap-2">
          {banners.map((banner, index) => (
            <p
              key={index}
              className={
                banner.tone === "red"
                  ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                  : banner.tone === "amber"
                    ? "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
              }
            >
              {banner.text}
            </p>
          ))}
        </div>
      )}

      {/* Etapa 59, seção 16: ação rápida depois de registrar uma análise —
          opcional, nunca gera a atualização automaticamente. */}
      {reviewSaved && !clientUpdatesByReviewId.has(reviewSaved) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-foreground">Revisão de conta registrada com sucesso.</span>
          <div className="flex items-center gap-2">
            <form action={generateClientUpdateAction.bind(null, reviewSaved, withParam(returnTo, `reviewDetail=${reviewSaved}`))}>
              <button
                type="submit"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                Gerar atualização
              </button>
            </form>
            <Link
              href={returnTo}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Fechar
            </Link>
          </div>
        </div>
      )}

      {/* 0. Seletor de mês (Etapa 62, seção 6) — contexto temporal de toda
          a página; mesmo padrão de navegação mensal já usado em
          Relatórios/Visão Geral/Sprints (`?month=YYYY-MM` + shiftMonthParam),
          nenhum componente novo de seletor. Etapa 75: removido o texto
          "Período em análise" — o próprio seletor já comunica o período,
          sem precisar de rótulo. Fica fora das abas — é contexto de toda a
          página, não de uma área específica. */}
      <div className="mt-3 flex items-center justify-end gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 text-sm">
          <Link
            href={prevMonthHref}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Mês anterior"
          >
            &lsaquo;
          </Link>
          <span className="px-1.5 text-sm font-medium text-foreground">{monthLabel}</span>
          <Link
            href={nextMonthHref}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Próximo mês"
          >
            &rsaquo;
          </Link>
        </div>
      </div>

      {/* Etapa "MITZA 2.0 — Fase F": Cliente como Prontuário — abas (mesmo
          padrão visual/estrutural já usado em Sprints: Link + role="tab",
          nenhum componente de aba novo). Cada área abaixo é um bloco já
          existente, só reorganizado — nenhum cálculo, prop ou comportamento
          interno de componente foi alterado. */}
      <div role="tablist" className="mt-3 flex items-center gap-4 overflow-x-auto border-b border-border text-sm">
        {AREA_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={buildAreaHref(tab.key)}
            scroll={false}
            role="tab"
            aria-selected={tab.key === activeArea}
            className={`-mb-px shrink-0 border-b-2 pb-1.5 font-medium transition-colors ${
              tab.key === activeArea
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Etapa "MITZA 2.0 — Refinamento da Experiência do Cliente": a Visão
          Geral deixou de ser uma aba entre outras e passou a ser o
          prontuário completo — uma única leitura contínua, na ordem em que
          o trabalho de fato acontece (indicadores → financeiro → execução
          → sprints → fechamento do mês → próximas ações). Nenhum
          componente, cálculo ou prop mudou — só deixaram de estar
          espalhados em abas próprias (Performance/Execução/Financeiro
          foram o mesmo trabalho diário fatiado em telas diferentes, o que
          a Fase F já tinha identificado como fragmentação). */}
      {activeArea === "visao-geral" && (
        <>
          {/* Indicadores do mês — investimento, resultados, custo por
              resultado e meta (as 4 métricas principais, mesmo peso
              visual), diagnóstico de meta, resultados por canal, última
              otimização e tracking operacional. A meta do mês (antes numa
              aba própria, depois um card "Performance do mês" à parte)
              agora é só mais uma destas métricas — nunca um fluxo
              separado. */}
          <div className="mt-3">
            <AccountFollowUpPanel
              monthLabel={monthLabel}
              monthActual={monthActual}
              performanceGoal={performanceGoal}
              performanceSummary={monthPerformanceSummary}
              targetCostPerResult={targetCostPerResult}
              channelBreakdown={monthPerformanceChannelBreakdown}
              configureObjectiveHref={`/clients/${client.id}/edit`}
              historyRows={recentHistoryRows}
              hasMoreHistory={hasMoreHistory}
              historyHref={reviewsHistoryHref}
              buildReviewDetailHref={buildReviewDetailHref}
            />
          </div>

          {/* Financeiro — informação de contexto (orçamento vigente,
              ritmo, edição de orçamento), não um fluxo de trabalho à
              parte. */}
          <div className="mt-3">
            <MonthInvestmentSummary
              planned={monthPlanned}
              actual={monthActual}
              expectedToDate={monthExpectedToDate}
              status={monthStatus}
              clientId={client.id}
              monthParam={monthParam}
              monthLabel={monthLabel}
              sprints={budgetSprints}
              monthRange={{ firstDay, lastDay }}
              effectiveDate={effectiveDate}
              isAdmin={isAdmin}
              isClosedMonth={isClosedMonth}
              isFutureMonth={isFutureMonth}
              lastChange={lastChange}
              historyHref={historyDrawerHref}
              performanceGoal={performanceGoal}
              targetResultCount={targetResultCount}
              targetCostPerResult={targetCostPerResult}
            />
          </div>

          {/* Tarefas do mês (Etapa "Tarefas e Sprints separadas") — novo
              módulo principal: substitui "Foco agora" (`SprintFocusBar`,
              removida sem substituto — a responsabilidade de indicar a
              próxima atividade agora é deste módulo) e absorve "Outras
              tarefas" (tarefas soltas). Reúne as tarefas de TODAS as
              sprints do mês + as soltas numa lista só, com a sprint de
              cada uma como referência (nunca agrupamento) — ver doc de
              `MonthTasksPanel`. */}
          <div className="mt-3">
            <MonthTasksPanel
              key={monthParam}
              monthLabel={monthLabel}
              tasks={monthTaskRows}
              clientId={client.id}
              managers={managers ?? []}
              isAdmin={isAdmin}
              canOperate={canOperate}
              recurringTasks={recurringTasksForCurrentSprint}
              recurringTaskHrefPrefix={
                currentSprintForRecurring
                  ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}recurringTaskSprint=${currentSprintForRecurring.sprintId}&recurringTaskDetail=`
                  : undefined
              }
            />
          </div>

          {/* Sprints do mês — Etapa "Sprint como relatório semanal": cada
              card virou um pequeno relatório da semana (KPIs → Performance
              → Registro), não mais área de execução — `hideTaskList`/
              `hideNextAction` trocam o corpo inteiro (a tela Sprints, que
              usa o mesmo `SprintCard`, continua exatamente como antes,
              sem essas props). Sem "Última execução" (sinal operacional,
              sem sentido num relatório) e sem otimizações (migraram pra
              a aba de Tarefas) — nem no resumo fechado nem dentro do
              card. */}
          <div className="mt-3">
            <Section title={`Sprints de ${monthLabel}`}>
              <div className="flex flex-col gap-2">
                {sortedSprints.length > 0 ? (
                  sortedSprints.map((sprint) => (
                    <SprintCard
                      key={sprint.sprintId}
                      sprint={sprint}
                      comments={sprintCommentsById.get(sprint.sprintId) ?? []}
                      clientId={client.id}
                      isAdmin={isAdmin}
                      canEditPerformance={canManageClient}
                      tasks={tasksBySprintId.get(sprint.sprintId) ?? []}
                      manualSpendUpdatedAt={manualSpendUpdatedAtBySprintId.get(sprint.sprintId) ?? null}
                      metaSyncedAt={lastSync?.synced_at ?? null}
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
                  <EmptyState>
                    Nenhuma sprint encontrada para este período — verifique se as sprints do mês já foram geradas.
                  </EmptyState>
                )}
              </div>
            </Section>
          </div>

          {/* Resumo consolidado do mês — como se fosse "mais uma sprint",
              só que representando o fechamento do período inteiro. Nenhum
              dado novo: mesmos números de investimento/performance/tarefas
              já calculados acima, só lidos juntos como fechamento. */}
          <div className="mt-3">
            <Section title={`Fechamento de ${monthLabel}`}>
              <div className="rounded-lg border border-border bg-card p-3">
                {/* Facelift "Fechamento do mês no mobile": abaixo de `sm`, a
                    mesma linha única (flex-wrap) espremia status/investido/
                    planejado/resultados/custo/tarefas competindo pelo mesmo
                    espaço horizontal. Mobile ganha uma segunda apresentação
                    em blocos verticais (mesmos dados, mesmas variáveis,
                    nenhum cálculo novo) — nunca mais de 2 informações
                    importantes por linha. Desktop (`sm:` e acima) continua
                    exatamente a linha única de sempre. */}
                <div className="flex flex-col gap-2.5 text-xs sm:hidden">
                  <span
                    className={`inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[monthStatus]}`}
                  >
                    {SPEND_STATUS_LABEL[monthStatus]}
                  </span>

                  <div>
                    <p className="text-muted-foreground">Investido</p>
                    <p className="text-base font-semibold text-foreground">{formatCurrency(monthActual)}</p>
                    <p className="text-muted-foreground">de {formatCurrency(monthPlanned)} planejados</p>
                  </div>

                  <div>
                    <p className="text-muted-foreground">Resultados</p>
                    <p className="font-semibold text-foreground">{monthKpiTexts.resultsValue}</p>
                  </div>

                  <div>
                    <p className="text-muted-foreground">Custo por resultado</p>
                    <p className="font-semibold text-foreground">{monthKpiTexts.costValue}</p>
                  </div>

                  <div>
                    <p className="text-muted-foreground">Tarefas do mês</p>
                    <p className="font-semibold text-foreground">
                      {monthTasksDone}/{monthTasksTotal}
                    </p>
                  </div>
                </div>

                <div className="hidden flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:flex">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[monthStatus]}`}
                  >
                    {SPEND_STATUS_LABEL[monthStatus]}
                  </span>

                  <span className="text-border" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-muted-foreground">Investido:</span>
                  <span className="font-semibold text-foreground">{formatCurrency(monthActual)}</span>
                  <span className="text-muted-foreground">de {formatCurrency(monthPlanned)} planejados</span>

                  <span className="text-border" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-muted-foreground">Resultados:</span>
                  <span className="font-semibold text-foreground">{monthKpiTexts.resultsValue}</span>

                  <span className="text-border" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-muted-foreground">Custo por resultado:</span>
                  <span className="font-semibold text-foreground">{monthKpiTexts.costValue}</span>

                  <span className="text-border" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-muted-foreground">Tarefas do mês:</span>
                  <span className="font-semibold text-foreground">
                    {monthTasksDone}/{monthTasksTotal}
                  </span>
                </div>
              </div>
            </Section>
          </div>

          {/* Dados estruturais do cliente (briefing) — informação de
              referência sobre a conta, não faz parte do fluxo diário de
              trabalho (não muda por mês selecionado), por isso fica no
              fim, depois de toda a operação. */}
          <div className="mt-3">
            <EssentialInfoPanel
              mainObjective={client.main_objective}
              mainProductOrService={client.main_product_or_service}
              operationRegion={client.operation_region}
              primaryAudience={client.primary_audience}
              clientDifferentials={client.client_differentials}
              clientRestrictions={client.client_restrictions}
              importantSeasonalDates={client.important_seasonal_dates}
              operationalSummary={client.operational_summary}
              importantNotes={client.important_notes}
              isAdmin={isAdmin}
              editHref={`/clients/${client.id}/edit`}
            />
          </div>
        </>
      )}

      {/* Etapa "Resumo Executivo": Analytics é o único centro de inteligência
          da conta — Resumo Executivo/Criativos/Campanhas/Insights vivem
          aqui dentro, navegados por `analyticsSection`, nunca abas irmãs
          próprias. Cabeçalho e período são ÚNICOS pra todo o hub — nenhuma
          sub-seção tem seletor de período próprio. */}
      {isAnalyticsArea && (
        <div className="mt-3">
          <AnalyticsHubHeader
            baseHref={analyticsHeaderBaseHref}
            activePreset={analyticsPreset}
            periodStart={analyticsPeriod.start}
            periodEnd={analyticsPeriod.end}
            customStart={analyticsStartParam ?? analyticsPeriod.start}
            customEnd={analyticsEndParam ?? analyticsPeriod.end}
            exportHref={exportHref}
            platformSwitch={
              <AnalyticsPlatformSwitch baseHref={analyticsPlatformSwitchBaseHref} activePlatform={analyticsPlatform} />
            }
          />
          <AnalyticsHubNav baseHref={analyticsNavBaseHref} activeSection={analyticsSection} />

          {analyticsSection === "resumo" &&
            (showPlatformNotConnected ? (
              <GoogleNotConnectedState />
            ) : analyticsData ? (
              <AnalyticsSection
                data={analyticsData}
                creativeSummaries={creativeSummaries}
                campaignSummaries={campaignSummaries}
                configureObjectiveHref={`/clients/${client.id}/edit`}
              />
            ) : (
              <EmptyState>Não foi possível carregar o Analytics deste cliente.</EmptyState>
            ))}

          {analyticsSection === "criativos" &&
            (analyticsPlatform === "google" ? (
              <div className="mx-auto max-w-2xl">
                <EmptyState>{CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE}</EmptyState>
              </div>
            ) : (
              <CreativeAnalyticsSection
                summaries={creativeSummaries}
                detail={creativeDetail}
                baseHref={analyticsBaseHref}
                buildDetailHref={buildCreativeDetailHref}
              />
            ))}

          {analyticsSection === "campanhas" &&
            (showPlatformNotConnected ? (
              <GoogleNotConnectedState />
            ) : (
              <AnalyticsCampaignsSection summaries={campaignSummaries} />
            ))}

          {analyticsSection === "insights" && <AnalyticsInsightsSection />}
        </div>
      )}

      {/* Etapa "MITZA 2.0 — Refinamento da Experiência do Cliente": a
          Timeline deixou de ser um link redirecionando pro mesmo drawer
          "Ver todos de {mês}" da Visão Geral — agora é o conteúdo real da
          aba, mostrando o histórico completo direto, sem overlay e sem
          voltar pra Visão Geral. Reaproveita a mesma consulta paginada
          (`fetchClientOperationalHistory`) e a mesma lista de eventos
          (`ClientHistoryList`, extraída do drawer) — nenhuma fonte de dado
          ou lógica nova. */}
      {activeArea === "timeline" && (
        <div className="mt-3">
          <Section title={`Histórico de ${monthLabel}`}>
            <ClientHistoryList
              rows={fullHistory.rows}
              buildReviewDetailHref={buildReviewDetailHref}
              emptyLabel={`Nenhum evento registrado em ${monthLabel}.`}
            />

            {(historyPage > 0 || fullHistory.hasMore) && (
              <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
                {historyPage > 0 ? (
                  <Link
                    href={buildTimelineHistoryPageHref(historyPage - 1)}
                    scroll={false}
                    className="font-medium text-brand hover:underline"
                  >
                    &larr; Mais recentes
                  </Link>
                ) : (
                  <span />
                )}
                {fullHistory.hasMore && (
                  <Link
                    href={buildTimelineHistoryPageHref(historyPage + 1)}
                    scroll={false}
                    className="font-medium text-brand hover:underline"
                  >
                    Mais antigos &rarr;
                  </Link>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      {openTask && (
        <TaskDrawerPanel
          task={openTask}
          clientId={client.id}
          clientName={client.name}
          sprintPeriodLabel={openTaskSprintPeriodLabel}
          comments={taskCommentsById.get(openTask.id) ?? []}
          closeHref={returnTo}
          returnTo={returnTo}
          isAdmin={isAdmin}
          managers={managers ?? []}
          canOperate={canOperate}
        />
      )}

      {isAdmin && historicoOrcamento && (
        <MonthlyBudgetHistoryDrawer
          monthLabel={monthLabel}
          changes={(budgetChanges ?? []).map((change) => ({
            id: change.id,
            effectiveDate: change.effective_date,
            changedAt: change.changed_at,
            changedByName: change.changed_by_profile?.name ?? null,
            previousAmount: change.previous_amount,
            newAmount: change.new_amount,
            consolidatedAmount: change.consolidated_amount,
            futureAmountDistributed: change.future_amount_distributed,
            resultingTotal: change.resulting_total,
            isBelowConsolidated: change.is_below_consolidated,
            reason: change.reason,
          }))}
          closeHref={historyDrawerCloseHref}
        />
      )}

      {reviewsHistory && (
        <ClientOperationalHistoryDrawer
          monthLabel={monthLabel}
          rows={fullHistory.rows}
          hasMore={fullHistory.hasMore}
          page={historyPage}
          buildPageHref={buildHistoryPageHref}
          buildReviewDetailHref={buildReviewDetailHref}
          closeHref={returnTo}
        />
      )}

      {openReview === "new" && (
        <RecordAccountReviewDrawer
          clientId={client.id}
          closeHref={returnTo}
          managers={managers ?? []}
          error={reviewError}
        />
      )}

      {reviewDetail && (
        <AccountReviewDetailDrawer review={reviewDetail} clientId={client.id} closeHref={returnTo} />
      )}

      {recurringTaskDetail && (
        <RecurringTaskDrawer detail={recurringTaskDetail} clientId={client.id} closeHref={returnTo} reportHref={recurringTaskReportHref} />
      )}

      {isNewClientReport && (
        <ClientReportWizard
          clientId={client.id}
          clientName={client.name}
          closeHref={returnTo}
          initialPeriodStart={suggestedReportPeriod.start}
          initialPeriodEnd={suggestedReportPeriod.end}
          recurringTaskId={reportRecurringTaskId ?? null}
        />
      )}

      {clientReportDetail && (
        <ClientReportWizard
          clientId={client.id}
          clientName={client.name}
          closeHref={returnTo}
          reportId={clientReportDetail.id}
          initialPeriodStart={clientReportDetail.periodStart}
          initialPeriodEnd={clientReportDetail.periodEnd}
          initialMetrics={clientReportDetail.metrics}
          initialObservations={clientReportDetail.observations}
          initialStatus={clientReportDetail.status}
          initialSentAt={clientReportDetail.sentAt}
          initialSentByName={clientReportDetail.sentByName}
        />
      )}
    </div>
  );
}
