import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, BarChart3, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { Button, IconButton } from "@/components/workspace/button";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  getActiveImportSourceChannelsForClient,
  getClientIdsWithActiveImportSource,
  getDailyPerformanceForPeriod,
  getDailyPerformanceRowsForPeriod,
  getDailySpendRowsForPeriod,
  getEnabledImportSourceIdsForClient,
  getLatestDailySpendDate,
  getRecentSyncRunsForClient,
  resolvePerformanceRowsForSprints,
  type SyncRunSummary,
} from "@/lib/performance-queries";
import { lastNDaysEndingToday, buildDailyResultSeries } from "@/lib/daily-results";
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
import { classifySpendStatus } from "@/lib/spend-status";
import { resolveBudgetEffectiveDate, computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, primaryGoalResultTypeFilter } from "@/lib/client-plan";
import { listClientGoals, fetchGoalDisplaySummaries } from "@/lib/client-goals";
import { fetchSecondaryGoalsPerformance } from "@/lib/secondary-goal-performance";
import { SecondaryGoalsPerformance } from "../secondary-goals-performance";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import {
  groupChannelSpendBySprintId,
  buildEditableInvestmentValues,
  sumChannelEffectiveSpend,
  computeSprintChannelEffectiveSpend,
  type SprintChannelSpendOverrideRow,
} from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel, formatRelativeDateTime, formatShortDate } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import { fetchClientOperationalHistory } from "@/lib/client-operational-history";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL, contractStatusBannerText, isWorkspaceClient } from "@/lib/client-fields";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { resolveOperationPriorityGroup } from "@/lib/operation-triage";
import { PRIORITY_GROUP_TONE } from "@/app/operation/operation-client-card";
import { emphasizeDeviationText } from "@/components/workspace/status-dot";
import { SubmitButton } from "@/app/submit-button";
import { syncClientStractSourcesAction } from "../stract-sync-actions";
import { getLatestSyncRunStatusForSources } from "@/lib/stract-sync";
import { ClientIdentitySticky } from "../client-identity-sticky";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { MonthInvestmentSummary, MonthInvestmentActions } from "../month-investment-summary";
import { SprintCard } from "../sprint-card";
import { MonthTasksPanel } from "../month-tasks-panel";
import { Section } from "../section";
import { AccountFollowUpPanel, type LastOptimizationInfo } from "../account-follow-up-panel";
import { ClientOperationalHistoryDrawer } from "../client-operational-history-drawer";
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
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel, type ChannelScope } from "@/lib/traffic-channels";
import { VisaoGeralChannelSwitch, type VisaoGeralMetricsChannel } from "../visao-geral-channel-switch";

const SYNC_RUN_STATUS_LABEL: Record<SyncRunSummary["status"], string> = {
  // Só fica presa em "running" além de alguns minutos se travou num timeout
  // — o próprio Import Service já fecha automaticamente como falha ao
  // iniciar a próxima tentativa (ver STALE_RUNNING_RUN_THRESHOLD_MS em
  // `lib/stract-sync.ts`), então na prática isso quase sempre é uma
  // execução genuinamente em andamento agora.
  running: "Em andamento",
  success: "Sucesso",
  partial: "Parcial",
  empty: "Vazio",
  failed: "Falha",
};

/** Etapa "Unificação visual da página do cliente": botão secundário compacto
 * pros dois únicos casos que não podem usar o `Button` do design system
 * (`@/components/workspace/button`) — ele renderiza `type="button"` fixo, e
 * "Sincronizar agora"/"Atualizar Meta" precisam de `type="submit"` dentro de
 * um `<form action>`. Mesma classe visual que `Button` variant="secondary"
 * size="sm" produz, nunca uma aparência nova — só o único jeito de ter um
 * botão de submit com a mesma cara. */
// Etapa "Navegação única do cliente": mesmo peso visual do `Button
// variant="ghost"` do design system (sem borda/fundo, só texto + hover
// discreto) — "Atualizar Meta"/"Sincronizar agora" são ações, não deveriam
// chamar mais atenção que o nome do cliente. `SubmitButton` não usa
// `Button` (precisa de `type="submit"`, que `Button` não permite), por isso
// essa classe existe separada — mesma altura/padding/tipografia do
// `Button` sm, só copiada aqui em vez de importar as constantes internas
// de `button.tsx` (não exportadas).
// Etapa "Navegação única do cliente": mesma linguagem visual pros 6
// destinos do cliente (Visão geral/Analytics/Timeline — abas de verdade,
// `role="tab"` — e Saldo/Fechamento/Relatório — links comuns, um deles
// externo) — texto + indicador de estado ativo por sublinhado, nunca
// pill/botão com borda (pedido explícito do usuário). Extraído em vez de
// repetido em cada item pra nunca dessincronizar o visual entre os dois
// grupos, que precisam parecer EXATAMENTE equivalentes.
const NAV_ITEM_BASE_CLASSES =
  "-mb-px shrink-0 rounded-t border-b-2 pb-1.5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const NAV_ITEM_ACTIVE_CLASSES = "border-brand text-brand";
const NAV_ITEM_INACTIVE_CLASSES = "border-transparent text-overview-text-secondary hover:text-overview-text-primary";

const HEADER_SUBMIT_BUTTON_CLASSES =
  "mitza-pressable inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const SYNC_RUN_STATUS_BADGE_CLASSES: Record<SyncRunSummary["status"], string> = {
  running: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  success: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  partial: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  empty: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/** "36 lidas · 36 investimento · 12 performance" — só lista as contagens que
 * a execução de fato preencheu (cada tabela de destino é opcional: uma fonte
 * sem `ad_name_column`, por exemplo, nunca escreve `creativeRowsWritten`). */
function formatSyncRunCounts(run: SyncRunSummary): string {
  const parts: string[] = [];
  if (run.rowsRead !== null) parts.push(`${run.rowsRead} lidas`);
  if (run.spendRowsWritten !== null) parts.push(`${run.spendRowsWritten} investimento`);
  if (run.performanceRowsWritten !== null) parts.push(`${run.performanceRowsWritten} performance`);
  if (run.creativeRowsWritten !== null) parts.push(`${run.creativeRowsWritten} criativos`);
  if (run.campaignRowsWritten !== null) parts.push(`${run.campaignRowsWritten} campanhas`);
  return parts.join(" · ");
}

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
    metricsChannel?: string;
  }>;
}) {
  const { id } = await params;
  const {
    error,
    synced,
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
    metricsChannel: metricsChannelParam,
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

  // Seletor "Consolidado | Meta | Google" da Visão Geral (pedido explícito
  // do usuário) — só vale pra essa aba; nunca lido fora do bloco
  // `activeArea === "visao-geral"` abaixo. Inválido/ausente cai pro padrão
  // consolidado, mesmo padrão de `activeArea`/`analyticsPlatform`.
  const metricsChannel: VisaoGeralMetricsChannel =
    metricsChannelParam === "meta" || metricsChannelParam === "google" ? metricsChannelParam : "consolidated";
  const metricsChannelBaseHref = `/clients/${id}?area=visao-geral${monthQueryParam ? `&month=${monthQueryParam}` : ""}`;

  // RLS já garante que um gestor só recebe o cliente se estiver em
  // client_managers; para quem não tem acesso o select simplesmente não
  // retorna linha, o que aqui vira 404 (sem revelar que o cliente existe).
  const { data: client } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, contract_start_date, primary_manager_id, primary_manager:team_members!clients_primary_manager_id_fkey(name), main_objective, main_product_or_service, operation_region, primary_audience, client_differentials, client_restrictions, important_seasonal_dates, operational_summary, important_notes, performance_goal, target_cost_per_result, avatar_url, dashboard_url, balance_url, monthly_closing_sheet_url",
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

  // Etapa "Consolidação do status de sincronização": antes existiam 3
  // pedaços soltos (banner vermelho binário, botão longe de tudo, histórico
  // fechado por padrão sem nenhum resumo antes de abrir) — viraram UM bloco
  // só (ver render mais abaixo), com dois níveis de acesso:
  //
  // - `latestSyncStatus`: status/horário da execução mais recente, SEM
  //   detalhe (nunca error_message/contagens) — lido com o client ADMIN
  //   (bypassa RLS) de propósito: quem já vê esta página (admin ou gestor
  //   responsável, garantido pela RLS de `clients` no `select` acima) deve
  //   saber se a integração está saudável, mesmo sem poder ver o histórico
  //   técnico completo (isso continua admin-only).
  // - `recentSyncRuns`: histórico completo (linhas lidas/gravadas, erro
  //   bruto) — client normal (RLS), só populado pra admin de propósito.
  const latestSyncStatus = stractImportSourceIds.length > 0 ? await getLatestSyncRunStatusForSources(stractImportSourceIds) : null;
  // "Até quando os números são reais?" — diferente de `latestSyncStatus`
  // (que só diz quando a sincronização RODOU). Ver comentário completo em
  // `getLatestDailySpendDate` — deliberadamente só a data, nunca um horário
  // (ver nota lá sobre por que `synced_at` não serve pra isso).
  const latestSpendDate = stractImportSourceIds.length > 0 ? await getLatestDailySpendDate(supabase, id) : null;
  const recentSyncRuns = isAdmin && stractImportSourceIds.length > 0 ? await getRecentSyncRunsForClient(supabase, stractImportSourceIds) : [];

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

  // Etapa "Motivo da Operação no Cliente": a mesma conclusão que a
  // Operação já mostra ("Crítico — CPL 58% acima da meta") passa a
  // aparecer aqui também — sempre a do MÊS CORRENTE (independente de qual
  // mês o gestor está navegando nesta página agora), porque a pergunta que
  // isso responde é "por que a Operação me trouxe até aqui HOJE", não "como
  // estava a conta no mês que estou olhando". `loadClientOperationalStates`
  // é a MESMA pipeline que alimenta `/operation` (Motor de Saúde da Conta,
  // `lib/account-health-engine.ts`) — só escopada a este único cliente, via
  // o parâmetro `clientId` (ver `lib/client-operational-state-data.ts`).
  // Nenhuma severidade recalculada aqui, nenhuma regra nova: só lemos
  // `evaluation.primaryReason`/`primaryDimension` já prontos. Cliente
  // pausado/encerrado não passa pelo filtro de `status` desta pipeline
  // (mesmo filtro que a Operação já usa) — `clientOperationalState` fica
  // `null` e a linha simplesmente não aparece, sem tratamento especial
  // aqui.
  const [clientOperationalState] = await loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, id);
  const primaryReasonText = clientOperationalState?.evaluation.primaryDimension
    ? clientOperationalState.evaluation.primaryReason
    : null;
  const primaryReasonTone = clientOperationalState
    ? PRIORITY_GROUP_TONE[resolveOperationPriorityGroup(clientOperationalState.evaluation)]
    : "neutral";

  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const prevMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, 1)}`;

  // Etapa "Evolução diária de resultados": janela dos últimos 7 dias
  // CORRIDOS terminando em hoje real (`todayStr`) — deliberadamente
  // independente do mês selecionado no seletor (`firstDay`/`lastDay` acima),
  // já que "Hoje"/"Ontem" só fazem sentido em relação ao dia real, nunca ao
  // mês que o gestor está navegando. Por isso busca `daily_performance`/
  // `daily_spend` num período PRÓPRIO em vez de reaproveitar `dailySpend`
  // (que é escopado ao mês selecionado, podendo nem cobrir esta janela).
  const dailyResultWindowDates = lastNDaysEndingToday(todayStr, 7);
  const dailyResultWindow = { firstDay: dailyResultWindowDates[0], lastDay: todayStr };

  // Etapa 50 (correção): a geração de sprints não roda mais durante o
  // carregamento da página — só via /api/cron/ensure-sprints.
  const [
    sprintsRaw,
    dailySpend,
    lastSync,
    plannedAllocations,
    budgetChanges,
    performanceTargetHistory,
    channelSpendRows,
    planningEndDate,
    activeImportClientIds,
    dailyResultPerformanceRows,
    dailyResultSpendRows,
  ] = await Promise.all([
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
      // `channel` incluído aqui (Visão Geral — seletor Consolidado/Meta/
      // Google) pra nunca precisar de uma segunda query igual só pra
      // decompor por canal — a mesma linha já serve pro consolidado
      // (`dailySpend`, campos `date`/`spend`) e pro breakdown por canal
      // (`dailySpendChannelRows`, abaixo).
      requireQuery(
        supabase.from("daily_spend").select("date, spend, channel").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
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
      // Etapa "Múltiplos Objetivos": `.or(primaryGoalResultTypeFilter(...))`
      // em toda consulta a `monthly_budget_changes` desta página — nunca
      // deixa a meta/histórico de um objetivo SECUNDÁRIO (ex.: Seguidores)
      // aparecer aqui, que é sempre sobre o objetivo PRINCIPAL. Aceita
      // `result_type is null` (linhas legadas) OU igual ao `performance_goal`
      // vigente do cliente.
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select(
            "id, channel, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
          )
          .eq("client_id", id)
          .eq("month", firstDay)
          .or(primaryGoalResultTypeFilter(client.performance_goal))
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:current-month",
      ),
      // Etapa "Planejamento por Canal": plano vigente por canal — `.lte` (não
      // `.eq`): a versão vigente de um canal pro mês selecionado pode ter
      // sido definida num mês anterior (mesma regra que já existia só pras
      // metas de performance, agora unificada com investimento — os dois são
      // sempre o mesmo objeto/snapshot, nunca dois conceitos com regra de
      // vigência diferente). Sem `.limit(1)`: cada canal tem sua própria
      // versão vigente, `resolveClientMonthlyPlan` resolve por canal.
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("channel, month, changed_at, new_amount, target_result_count, target_cost_per_result")
          .eq("client_id", id)
          .lte("month", firstDay)
          .or(primaryGoalResultTypeFilter(client.performance_goal))
          .order("month", { ascending: false })
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:target-history",
      ),
      // Investimento manual multicanal (`sprint_channel_spend`, adotada como
      // fonte de verdade — ver `resolveManualActualSpend`, lib/effective-spend.ts).
      requireQuery(
        supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
        "sprint_channel_spend",
      ),
      // Etapa "Horizonte de Planejamento": cliente de evento (campanha que
      // termina antes do fim do mês) — null pra qualquer cliente sem
      // horizonte configurado, comportamento idêntico a antes desta etapa.
      getClientMonthHorizon(supabase, id, firstDay),
      // Etapa "Evolução diária de resultados": mesmo gate de sempre
      // (`resolvePerformanceRowsForSprints`/`analytics-data.ts`) — só
      // cliente com Stract ativo tem granularidade diária de resultado.
      getClientIdsWithActiveImportSource(supabase, [id]),
      getDailyPerformanceRowsForPeriod(supabase, id, dailyResultWindow),
      getDailySpendRowsForPeriod(supabase, id, dailyResultWindow),
    ]);

  // Etapa "Horizonte de Planejamento": todo cálculo OPERACIONAL (ritmo, dias
  // restantes, esperado até hoje, redistribuição, recomendações) passa a
  // receber `planningHorizon` em vez de `{ firstDay, lastDay }` cru — pra um
  // cliente sem `planning_end_date` (o padrão), os dois são idênticos.
  // `{ firstDay, lastDay }` continua sendo usado pras QUERIES acima (nunca
  // encurtadas — dado histórico nunca é ocultado).
  const planningHorizon = resolvePlanningHorizon({ firstDay, lastDay }, planningEndDate);

  // Investimento manual multicanal — resolve `manual_actual_spend` de cada
  // sprint ANTES de qualquer uso downstream (ver `resolveManualActualSpend`,
  // lib/effective-spend.ts), pra todo cálculo financeiro desta página
  // (cartão de cada sprint, total do mês, congelamento de snapshot) herdar
  // o valor certo sem duplicar a regra.
  // Flat array reaproveitada tanto pra resolução consolidada (agrupada
  // abaixo) quanto pro breakdown por canal do seletor Consolidado/Meta/
  // Google da Visão Geral (`sumChannelEffectiveSpend`/
  // `computeSprintChannelEffectiveSpend`, mais abaixo) — nunca uma segunda
  // busca igual só pra decompor por canal.
  const channelSpendOverrideRows: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));
  const channelSpendBySprintId = groupChannelSpendBySprintId(channelSpendOverrideRows);
  // Mesmo motivo do `channel` incluído na query de `daily_spend` acima —
  // versão com a dimensão de canal da MESMA lista já buscada, pro
  // breakdown por canal (seletor Consolidado/Meta/Google) nunca precisar de
  // uma segunda query.
  const dailySpendChannelRows = (dailySpend ?? []).map((d) => ({ date: d.date, channel: d.channel as TrafficChannel, spend: d.spend }));
  const sprints = sprintsRaw.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(sprint.manual_actual_spend, channelSpendBySprintId.get(sprint.id) ?? []),
  }));
  const legacyManualActualSpendBySprintId = new Map(sprintsRaw.map((sprint) => [sprint.id, sprint.manual_actual_spend]));

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
  // fallback de `resolveClientMonthlyPlan`, abaixo.
  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({
    date: a.date,
    sprintId: a.sprint_id,
    amount: a.planned_amount,
  }));
  // Etapa "Planejamento por Canal": plano vigente do cliente — sempre a
  // soma dos canais (Meta + Google), cada um resolvido pra sua própria
  // versão mais recente elegível (`resolveClientMonthlyPlan`). `sumPlannedForMonth`
  // só entra como fallback pra cliente que nunca passou pelo planejamento
  // por canal (sem nenhuma linha em monthly_budget_changes ainda).
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
  // Etapa "Múltiplos Objetivos": objetivos SECUNDÁRIOS (nunca o principal,
  // que continua 100% pelo fluxo de sempre acima) — bloco adicional,
  // sozinho quando o cliente só tem 1 objetivo (caso comum hoje). Await
  // sequencial deliberado (não entra no Promise.all grande acima) pra
  // manter o diff desta etapa isolado e fácil de revisar.
  const allClientGoals = await listClientGoals(supabase, client.id);
  const secondaryClientGoals = allClientGoals.filter((g) => !g.isPrimary);
  const secondaryGoalTargets = await fetchGoalDisplaySummaries(supabase, client.id, secondaryClientGoals, firstDay);
  const secondaryGoalsPerformance = await fetchSecondaryGoalsPerformance(
    supabase,
    client.id,
    secondaryClientGoals,
    { firstDay, lastDay },
    new Map(Array.from(secondaryGoalTargets.entries()).map(([goal, summary]) => [goal, summary.targetResultCount])),
  );

  const monthPlanned = clientPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);
  // Etapa 73: a camada de planejamento/recomendação POR SPRINT saiu da
  // interface operacional (fica só no nível mensal) — `computeOriginalSprintPlans`/
  // `monthPlan.sprintPlans` deixaram de alimentar qualquer componente aqui.
  // `ensureClosedSprintSnapshots` continua rodando (preserva o congelamento
  // histórico em `sprints.original_planned_amount`/`final_recommended_amount`
  // pra uma eventual reativação futura), só o valor devolvido não é mais
  // lido por ninguém nesta página. Etapa "Migração Multicanal dos
  // Consumidores": todos os canais (nunca mais só `channel = 'meta'`) — o
  // congelamento de snapshot histórico agora reconstrói o total consolidado
  // por canal NAQUELE momento (`computeSprintClosedSnapshot`, via
  // `resolveConsolidatedMonthlyPlanned`), nunca a fatia de um canal só.
  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: planningHorizon,
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: (budgetChanges ?? []).map((c) => ({
      channel: c.channel as TrafficChannel,
      newAmount: c.new_amount,
      changedAt: c.changed_at,
    })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: monthPlanned,
  });
  // Etapa 67: "esperado até hoje" nunca mais soma sprint_planned_allocations
  // — é só o avanço do calendário do mês aplicado ao orçamento vigente,
  // independente de sprints/planejamentos antigos (mesma função central
  // usada em toda a Visão Geral/Sprints/Relatório — ver operation-data.ts).
  // Etapa "Horizonte de Planejamento": `planningHorizon`, não `{firstDay,
  // lastDay}` cru — pra cliente de evento, "hoje" avança proporcionalmente
  // aos dias da CAMPANHA, não do mês inteiro.
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(
    monthPlanned,
    planningHorizon,
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

  // Seletor Consolidado/Meta/Google da Visão Geral — investido do mês
  // recalculado pra UM canal só, mesma fonte de verdade de sempre
  // (`sumChannelEffectiveSpend`, lib/channel-spend.ts — mesma regra
  // sincronizado×manual do consolidado, só filtrada por canal).
  const visaoGeralMonthActual =
    metricsChannel === "consolidated"
      ? monthActual
      : sumChannelEffectiveSpend(
          sortedSprints.map((s) => ({ sprintId: s.sprintId, start_date: s.startDate, end_date: s.endDate })),
          metricsChannel,
          dailySpendChannelRows,
          channelSpendOverrideRows,
        );
  // QA multicanal: `MonthInvestmentSummary` ("Investimento do mês") também
  // escopado pelo seletor — planejado do canal vem de `clientPlan.byChannel`
  // (mesma arquitetura de sempre, nenhum resolvedor novo); `0` quando o
  // canal não tem plano ainda é só o sinal que o próprio componente já
  // entende como "sem planejamento configurado" (`planned <= 0`, gate
  // existente), nunca um número exibido/dividido — nunca cai pro
  // consolidado como fallback (senão voltaria a comparar canal contra
  // consolidado). "Esperado até hoje"/status reaproveitam as MESMAS funções
  // centrais de `monthExpectedToDate`/`monthStatus` acima, só alimentadas
  // com o planejado/realizado do canal em vez do consolidado.
  const visaoGeralPlanned = metricsChannel === "consolidated" ? monthPlanned : (clientPlan.byChannel[metricsChannel]?.investment ?? 0);
  const visaoGeralExpectedToDate =
    metricsChannel === "consolidated"
      ? monthExpectedToDate
      : computeMonthlyExpectedToDateByCalendar(visaoGeralPlanned, planningHorizon, todayStr).expectedToDate;
  const visaoGeralStatus =
    metricsChannel === "consolidated"
      ? monthStatus
      : classifySpendStatus(visaoGeralMonthActual, visaoGeralExpectedToDate, visaoGeralPlanned);

  // Etapa 71 — camada de PERFORMANCE: consome `monthActual`/`sprint.actualSpend`
  // já calculados acima, nunca uma segunda fonte de investimento. Consolidado
  // do mês é sempre a soma direta dos registros já escopados às sprints do
  // mês selecionado (nenhum lançamento manual mensal independente).
  const performanceGoal = client.performance_goal;
  // Etapa "Planejamento por Canal": meta de resultado/custo vigente vem do
  // mesmo `clientPlan` resolvido acima (investimento e meta são sempre o
  // mesmo objeto agora, nunca dois resolvedores separados) — soma dos
  // canais pro resultado, custo por resultado sempre derivado (nunca uma
  // coluna própria). `clients.target_cost_per_result` como fallback só
  // quando nenhum canal tem plano nenhum ainda.
  const targetCostPerResult = clientPlan.consolidated.cpa ?? client.target_cost_per_result;
  const monthPerformanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: "consolidated",
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult,
      })
    : null;
  // QA multicanal: a meta de custo por resultado (CPA-alvo) também é
  // resolvida por canal em `clientPlan.byChannel` (Etapa "Planejamento
  // Mensal por Canal") — quando um canal específico está selecionado, usar
  // a meta DAQUELE canal, nunca a consolidada (senão o card "Meta" mostraria
  // o CPA-alvo combinado enquanto todo o resto do painel já está escopado a
  // um canal só). Cai pra `targetCostPerResult` consolidado só quando o
  // canal selecionado ainda não tem meta própria definida.
  const scopedTargetCostPerResult =
    metricsChannel === "consolidated" ? targetCostPerResult : (clientPlan.byChannel[metricsChannel]?.cpa ?? targetCostPerResult);
  // Versão do resumo do mês escopada ao seletor Consolidado/Meta/Google —
  // alimenta só `AccountFollowUpPanel`/"Fechamento do mês" (abaixo, dentro
  // do bloco `visao-geral`); `monthPerformanceSummary` acima continua
  // SEMPRE consolidado porque também alimenta o indicador de "Última
  // atualização da performance" do cabeçalho (fora da aba Visão Geral, sem
  // noção de canal selecionado).
  const visaoGeralPerformanceSummary = performanceGoal
    ? computePerformanceSummary({
        scope: metricsChannel,
        records: performanceRecords,
        resultType: performanceGoal,
        consolidatedActualSpend: monthActual,
        targetCostPerResult: scopedTargetCostPerResult,
        channelActualSpend: metricsChannel !== "consolidated" ? { [metricsChannel]: visaoGeralMonthActual } : undefined,
      })
    : null;
  // Etapa "Evolução diária de resultados": mesma janela dos últimos 7 dias
  // (`dailyResultWindowDates`, calculada acima independente do mês
  // selecionado), escopada ao MESMO seletor Consolidado/Meta/Google de todo
  // o resto do painel (`metricsChannel`) — nenhum cálculo paralelo ao de
  // `visaoGeralPerformanceSummary` acima, só a mesma filtragem por canal
  // (`aggregatePerformanceResults`) aplicada dia a dia.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- nenhum componente da Visão Geral lê mais a série diária (a granularidade diária virou responsabilidade só do Analytics); a busca continua intacta, só sem consumidor por enquanto.
  const dailyResultSeries = performanceGoal
    ? buildDailyResultSeries({
        windowDates: dailyResultWindowDates,
        hasActiveIntegration: activeImportClientIds.has(id),
        goal: performanceGoal,
        scope: metricsChannel,
        performanceRows: dailyResultPerformanceRows,
        spendRows: dailyResultSpendRows,
      })
    : undefined;
  // "Esperado até hoje" de RESULTADO — mesma fórmula central já usada pro
  // investimento (`computeMonthlyExpectedToDateByCalendar`), só aplicada à
  // meta de QUANTIDADE (`targetResultCount`) em vez do orçamento. Meta por
  // canal vem do mesmo `clientPlan.byChannel` já resolvido acima (nenhum
  // resolvedor novo); `null` quando o escopo selecionado não tem meta de
  // quantidade definida (nunca mostra "X/undefined").
  const scopedTargetResultCount =
    metricsChannel === "consolidated" ? clientPlan.consolidated.resultCount : (clientPlan.byChannel[metricsChannel]?.resultCount ?? null);
  const expectedResultsToDate =
    scopedTargetResultCount !== null
      ? computeMonthlyExpectedToDateByCalendar(scopedTargetResultCount, planningHorizon, todayStr).expectedToDate
      : null;
  const monthPerformanceChannelBreakdown =
    performanceGoal && metricsChannel === "consolidated"
      ? AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({
          channel,
          resultCount: aggregatePerformanceResults(performanceRecords, performanceGoal, channel).resultCount,
        })).filter((entry) => entry.resultCount > 0)
      : []; // Escopado a um canal só: o breakdown por canal vira redundante (o painel inteiro já É o canal selecionado).
  const sprintPerformanceBySprintId = new Map<string, SprintPerformanceProps>();
  // Investido de CADA sprint no canal selecionado — só usado pra sobrepor
  // `sprint.actualSpend` na hora de renderizar `SprintCard` (mesmo padrão
  // de `visaoGeralMonthActual` acima, um nível mais fundo). Vazio quando
  // consolidado (o card usa `sprint.actualSpend` normalmente).
  const sprintActualSpendByChannelBySprintId = new Map<string, number>();
  for (const sprint of sprintFinancials) {
    const sprintRecords = performanceRecords.filter((r) => r.sprintId === sprint.sprintId);
    const scopedActualSpend =
      metricsChannel === "consolidated"
        ? sprint.actualSpend
        : computeSprintChannelEffectiveSpend(
            { sprintId: sprint.sprintId, start_date: sprint.startDate, end_date: sprint.endDate },
            metricsChannel,
            dailySpendChannelRows,
            channelSpendOverrideRows,
          );
    sprintActualSpendByChannelBySprintId.set(sprint.sprintId, scopedActualSpend);
    const scopedRecords = metricsChannel === "consolidated" ? sprintRecords : sprintRecords.filter((r) => r.channel === metricsChannel);
    sprintPerformanceBySprintId.set(sprint.sprintId, {
      view: buildSprintPerformanceView({
        performanceGoal,
        isFuture: sprint.temporalStatus === "futura",
        records: scopedRecords,
        actualSpend: scopedActualSpend,
        targetCostPerResult: scopedTargetCostPerResult,
      }),
      // Formulário de edição sempre trabalha com TODOS os canais,
      // independente do seletor de exibição (`sprintRecords`/consolidado
      // aqui, nunca `scopedRecords`) — o seletor só filtra o que É EXIBIDO,
      // nunca o que pode ser editado.
      editableChannels: performanceGoal ? buildEditableChannelValues(sprintRecords, performanceGoal, AVAILABLE_TRAFFIC_CHANNELS) : [],
      editableInvestment: buildEditableInvestmentValues(
        AVAILABLE_TRAFFIC_CHANNELS,
        legacyManualActualSpendBySprintId.get(sprint.sprintId) ?? null,
        channelSpendBySprintId.get(sprint.sprintId) ?? [],
      ),
      performanceGoal,
    });
  }

  // Etapa "Horizonte de Planejamento": "mês encerrado" passa a significar
  // "depois do fim do horizonte" — pra cliente de evento, isso pode ser bem
  // antes do dia 31 (a campanha acabou, não existe mais saldo pra investir
  // nem redistribuir, mesmo com dias sobrando no calendário).
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);
  // Etapa 64: mês selecionado ainda não começou — usado só pra escolher o
  // texto da seção "Investimento do mês" (nunca uma segunda comparação de
  // datas: "não é o mês corrente" + "não está encerrado" já implica futuro,
  // dado que todo mês é ou passado, ou corrente, ou futuro).
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  // Etapa "Horizonte de Planejamento": distingue POR QUE o período está
  // encerrado — o mês civil realmente acabou (`todayStr > lastDay`) ou só o
  // horizonte de evento (`todayStr` ainda dentro do mês civil, mas depois
  // do `planning_end_date`) — só pra escolher o texto certo ("Mês
  // encerrado" x "Período de planejamento encerrado"), nunca pra mudar
  // nenhum cálculo (isso já é só `isClosedMonth`, derivado do horizonte).
  const isClosedByHorizonOnly = isClosedMonth && todayStr <= lastDay;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Etapa "Remover histórico da Visão Geral": o resumo de 5 recentes saiu da apresentação padrão (Timeline/drawer "Histórico" já cobrem o histórico completo); a busca continua intacta, só sem consumidor por enquanto.
  const [{ rows: recentHistoryRows, hasMore: hasMoreHistory }, fullHistory] = await Promise.all([
    fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, 0, 5),
    shouldLoadFullHistory
      ? fetchClientOperationalHistory(supabase, id, { firstDay, lastDay }, historyPage)
      : Promise.resolve({ rows: [], hasMore: false }),
  ]);

  const contractBannerText = contractStatusBannerText(client.status);

  // Etapa "Refinamento Visual 2.0 — Progressive Disclosure": estado normal
  // fica silencioso, exceção fica visível. Sincronização SAUDÁVEL
  // (`status === "success"`) não aparece mais aqui nem em nenhum outro
  // lugar de destaque — vive só, sempre disponível, dentro do disclosure
  // "Informações da conta" (fim da página). Qualquer OUTRO estado (parcial/
  // vazio/falha/em andamento/nunca sincronizado) continua exatamente tão
  // visível quanto sempre foi — mesma classificação de sempre
  // (`SYNC_RUN_STATUS_LABEL`/`SYNC_RUN_STATUS_BADGE_CLASSES`, nenhuma regra
  // nova), só que agora reaproveitando a MESMA superfície de banners de
  // exceção já usada pro resto da página, em vez de uma faixa técnica
  // própria sempre presente.
  const stractSyncNeedsAttention = stractImportSourceIds.length > 0 && latestSyncStatus?.status !== "success";
  const banners = [
    contractBannerText && {
      tone: "amber",
      text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.`,
    },
    error && { tone: "red", text: error },
    taskError && { tone: "red", text: taskError },
    reviewError && { tone: "red", text: reviewError },
    recurringTaskError && { tone: "red", text: recurringTaskError },
    clientUpdateError && { tone: "red", text: clientUpdateError },
    stractSyncNeedsAttention && {
      tone: latestSyncStatus?.status === "failed" ? "red" : "amber",
      text: latestSyncStatus
        ? `Sincronização com o Stract: ${SYNC_RUN_STATUS_LABEL[latestSyncStatus.status]}${latestSpendDate ? ` · dados até ${formatShortDate(latestSpendDate)}` : ""}.`
        : "Esta conta ainda não teve nenhuma sincronização com o Stract.",
    },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
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

  // Etapa "Restaurar Registrar Revisão no Cliente": mesmo drawer/Server
  // Action que `/sprints` já usa (`RecordAccountReviewDrawer`/
  // `recordAccountReviewAction`, abertos via `?review=new`, já renderizados
  // mais abaixo nesta própria página) — aqui só falta o link de entrada,
  // que nunca existiu na página individual. Nenhum formulário novo, nenhuma
  // permissão nova: mesmo gate (`canOperate`) que já protege as outras
  // ações de criação desta página (Atualizar Meta, comentários, tarefas).
  const newReviewHref = withParam(returnTo, "review=new");

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

  // Etapa "Primeira dobra": rótulo mais curto ("Dados atualizados" em vez
  // de "Última atualização da performance") — mesma distinção de sempre
  // pra mês não-atual, só o texto ficou mais compacto pra caber na linha
  // técnica única do cabeçalho.
  const lastPerformanceUpdateLabel = isCurrentMonth ? "Dados atualizados" : `Dados atualizados em ${monthLabel}`;
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

  // Integração Google Ads — seletor de plataforma "Consolidado | Meta Ads |
  // Google Ads" (Etapa "Migração Multicanal dos Consumidores": mesma regra
  // de escopo da Visão Geral, `VisaoGeralChannelSwitch`). Meta continua o
  // padrão quando o parâmetro está ausente/inválido (pedido explícito do
  // usuário original: "manter a experiência atual") — `consolidated` é um
  // valor explícito, nunca o fallback silencioso. Controla TODA a aba de
  // Analytics (Resumo, gráfico, Campanhas, PDF exportado), nunca só uma
  // sub-seção.
  const analyticsPlatform: ChannelScope =
    analyticsPlatformParam === "google" ? "google" : analyticsPlatformParam === "consolidated" ? "consolidated" : "meta";
  // "Conectado" só é uma pergunta real pra Google (Meta pode vir de
  // performance_records manual, sem nenhuma import_sources — sempre
  // continua funcionando como hoje). `import_sources` é a única fonte de
  // verdade pra essa pergunta, nunca inferida de daily_spend/daily_performance.
  const activeImportChannels = isAnalyticsArea ? await getActiveImportSourceChannelsForClient(supabase, id) : new Set<string>();
  const showPlatformNotConnected = isAnalyticsArea && analyticsPlatform === "google" && !activeImportChannels.has("google");

  const analyticsData =
    isAnalyticsArea && analyticsSection === "resumo" && !showPlatformNotConnected
      ? await fetchClientAnalyticsData(supabase, id, analyticsPeriod, analyticsPlatform === "consolidated" ? undefined : analyticsPlatform)
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
  // "não implementar criativos Google") — `ad_creative_daily_metrics` nunca
  // ganha canal, então "Consolidado" aqui é sempre igual a "Meta" (não há
  // dado de Google pra somar); só a visão Google explícita busca nada.
  // Campanhas NÃO depende mais desta busca (ver bloco abaixo).
  const needsAdCreativeRows =
    isAnalyticsArea &&
    (analyticsPlatform === "meta" || analyticsPlatform === "consolidated") &&
    (analyticsSection === "resumo" || analyticsSection === "criativos");
  const adCreativeRows = needsAdCreativeRows ? await getAdCreativeDailyMetricsForPeriod(supabase, id, analyticsPeriod) : [];
  const creativeSummaries =
    analyticsSection === "resumo" || analyticsSection === "criativos" ? buildCreativeSummaries(adCreativeRows) : [];
  // Achado no QA de produção: o total de vendas da Visão Geral/Resumo
  // Executivo (`daily_performance`, `getDailyPerformanceForPeriod` — soma
  // TODA linha do período) pode ser maior que a soma das vendas por
  // criativo aqui. Investigado com dado real (cliente Ateliê): a causa
  // usual NÃO é "anúncio sem nome" (`aggregateAdCreativeDailyRows`,
  // lib/import-sources.ts, ainda existe como possibilidade, mas não foi o
  // caso observado) — é o histórico de `ad_creative_daily_metrics` COMEÇAR
  // DEPOIS do início do período selecionado: a coluna de nome de anúncio
  // de uma fonte pode ser configurada bem depois do cliente já ter
  // histórico de resultado em `daily_performance`, então os dias
  // anteriores à configuração nunca tiveram (e nunca terão
  // retroativamente) nenhuma linha de criativo — não é uma venda "perdida
  // por falta de nome", é um dia que nunca foi sincronizado com
  // detalhamento de criativo. A diferença é real, nunca um erro de soma;
  // só ficava invisível — parecia que a Análise de Criativos "perdia"
  // vendas sem explicação nenhuma.
  const unattributedCreativeResultCount = await (async () => {
    if (!needsAdCreativeRows || analyticsSection !== "criativos" || !client.performance_goal) return null;
    const dailyPerformanceForPeriod = await getDailyPerformanceForPeriod(supabase, id, {
      firstDay: analyticsPeriod.start,
      lastDay: analyticsPeriod.end,
    });
    // "meta" — Criativos é exclusivamente Meta (mesma regra de
    // `needsAdCreativeRows`, ver comentário acima dele); comparar contra o
    // total consolidado inflaria o gap com vendas de Google que nunca
    // poderiam aparecer aqui de qualquer forma.
    const accountLevel = aggregatePerformanceResults(dailyPerformanceForPeriod, client.performance_goal, "meta");
    if (!accountLevel.hasAnyRecord) return null;
    const attributedResultCount = creativeSummaries.reduce((sum, s) => sum + (s.totalResultCount ?? 0), 0);
    const gap = accountLevel.resultCount - attributedResultCount;
    return gap > 0 ? gap : null;
  })();
  // Só é relevante quando REALMENTE explica o gap acima (posterior ao
  // início do período) — `adCreativeRows` já é a mesma busca que alimenta
  // `creativeSummaries`, nenhuma consulta nova.
  const earliestCreativeDate = adCreativeRows.reduce<string | null>(
    (min, row) => (min === null || row.date < min ? row.date : min),
    null,
  );
  const creativeHistoryStartsLaterThanPeriod =
    unattributedCreativeResultCount !== null && earliestCreativeDate !== null && earliestCreativeDate > analyticsPeriod.start
      ? earliestCreativeDate
      : null;
  const creativeDetail =
    isAnalyticsArea && analyticsSection === "criativos" && creativeParam ? buildCreativeDetail(adCreativeRows, creativeParam) : null;
  // Preserva período+plataforma (nunca reseta ao entrar no detalhe de um
  // criativo) — mesmo cuidado de `customStart`/`customEnd` já usado pro
  // seletor de período em si. Só o PREFIXO do href (sem `creative=<nome>`
  // ainda) — `CreativeAnalyticsList` (Client Component) monta o href final
  // de cada criativo, porque uma função não pode atravessar a fronteira
  // Server→Client (só este prefixo, uma string serializável).
  const creativeDetailHrefBase = (() => {
    const params = new URLSearchParams({ analyticsPreset, analyticsSection: "criativos", analyticsPlatform });
    if (analyticsPreset === "custom") {
      params.set("analyticsStart", analyticsStartParam ?? analyticsPeriod.start);
      params.set("analyticsEnd", analyticsEndParam ?? analyticsPeriod.end);
    }
    return `${analyticsBaseHref}&${params.toString()}`;
  })();

  // Seção "Campanhas" — Integração Google Ads: camada independente de
  // Criativos desde a origem (`campaign_daily_metrics`, channel-aware,
  // populada sempre que `campaign_name_column` existir, nunca condicionada
  // a `ad_name_column`). Etapa "Resumo Executivo": sem variação % vs
  // período anterior (removida a pedido do usuário), por isso não busca
  // mais um segundo período aqui. Filtragem por `analyticsPlatform` ocorre
  // aqui, na camada de dados, antes das funções puras de agregação — Meta e
  // Google nunca se misturam numa mesma LINHA (identidade de campanha já é
  // `(channel, campaignName)`, ver `lib/campaign-analytics.ts`), mas
  // "Consolidado" (Etapa "Migração Multicanal dos Consumidores") passa as
  // linhas dos dois canais juntas de propósito — a agregação por
  // `(channel, campaignName)` já soma investimento/resultado corretamente
  // sem duplicar lógica aqui.
  const needsCampaignRows =
    isAnalyticsArea && (analyticsSection === "resumo" || analyticsSection === "campanhas") && !showPlatformNotConnected;
  const campaignDailyMetricRows = needsCampaignRows
    ? (await getCampaignDailyMetricsForPeriod(supabase, id, analyticsPeriod)).filter(
        (row) => analyticsPlatform === "consolidated" || row.channel === analyticsPlatform,
      )
    : [];
  const campaignSummaries =
    (analyticsSection === "resumo" || analyticsSection === "campanhas") && !showPlatformNotConnected
      ? buildCampaignSummaries(campaignDailyMetricRows)
      : [];

  const monthTaskRows = [...sortedSprints.flatMap((sprint) => tasksBySprintId.get(sprint.sprintId) ?? []), ...unlinkedTasks];

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <ScrollRestoreOnMount />

      {/* 1. Identificação do cliente — substitui o antigo ClientContextBar
          (subheader sticky compartilhado por toda /clients/[id]/**).
          Hierarquia inspirada no Relatório: avatar + nome em destaque +
          badge de status na mesma linha, contexto secundário (gestor/
          conta Meta/tempo de relacionamento) abaixo, ações agrupadas
          logo depois. Nenhuma "Semana atual" aqui — já aparece no seletor
          de período, mais abaixo. */}
      <ClientWorkspaceContext name={client.name} />
      {/* Etapa "Barra única de controles do cliente": as ações (Dashboard
          ↗/Editar/Atualizar Meta/Registrar revisão) saíram desta área — não
          vivem mais numa fileira própria abaixo da identidade, agora fazem
          parte da MESMA barra de navegação, logo abaixo (`role="tablist"`),
          separadas por uma divisória sutil. Compacta o header verticalmente
          (uma fileira a menos) sem perder proximidade real: a barra
          continua logo abaixo desta identidade, só não duplica mais a
          altura com uma linha de botões inteira só pra isso.
          Etapa "Refinamento Visual 2.0 — Progressive Disclosure": a
          identidade agora emenda direto na navegação (`role="tablist"`,
          logo abaixo) — "Última otimização"/"Dados atualizados"/status de
          sincronização saudável não aparecem mais aqui nem em nenhuma faixa
          própria; viraram informação disponível sob demanda no disclosure
          "Informações da conta" (fim da página). Só a EXCEÇÃO (sincronização
          com problema real) continua visível perto do topo, junto dos
          demais banners (`stractSyncNeedsAttention`, acima). Nenhum dado,
          cálculo ou permissão mudou nesta etapa, só reorganização e peso
          visual. */}
      <div className="flex min-w-0 items-center gap-3">
        <ClientAvatar name={client.name} imageUrl={client.avatar_url} size="lg" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-overview-text-primary">{client.name}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}>
              {CLIENT_STATUS_LABEL[client.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-overview-text-secondary">{identitySecondaryLine}</p>
          {/* Etapa "Motivo da Operação no Cliente": a mesma frase que
              justifica o balde Crítico/Atenção na Operação
              (`evaluation.primaryReason`, calculado por
              `evaluateAccountHealth()` — nenhuma segunda lógica), com o
              mesmo destaque discreto (`emphasizeDeviationText`, só o
              número em destaque, nunca a frase inteira colorida) já usado
              no card da Operação. Ausente quando o cliente está saudável
              (`primaryDimension === null`, mesma condição de lá) — nenhum
              "Nenhum sinal de atenção" fabricado aqui. */}
          {primaryReasonText && (
            <p className="mt-0.5 text-xs text-overview-text-secondary" title={primaryReasonText}>
              {emphasizeDeviationText(primaryReasonText, primaryReasonTone)}
            </p>
          )}
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-overview-border bg-overview-surface px-3 py-2 text-sm">
          <span className="text-overview-text-primary">Revisão de conta registrada com sucesso.</span>
          <div className="flex items-center gap-2">
            <form action={generateClientUpdateAction.bind(null, reviewSaved, withParam(returnTo, `reviewDetail=${reviewSaved}`))}>
              <SubmitButton
                pendingChildren="Gerando..."
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                Gerar atualização
              </SubmitButton>
            </form>
            <Button href={returnTo} variant="secondary" size="sm">
              Fechar
            </Button>
          </div>
        </div>
      )}

      {/* Etapa "Barra única de controles do cliente": uma ÚNICA fileira,
          nunca mais "navegação embaixo + botões em cima". As 3 abas de
          sempre (mesmo padrão visual/estrutural já usado em Sprints: Link +
          role="tab", nenhum cálculo/prop/comportamento interno alterado) +
          Saldo/Fechamento/Relatório (NAVEGAÇÃO — "pra onde eu quero ir";
          não são abas de verdade, não trocam o conteúdo desta mesma página:
          Saldo/Fechamento abrem planilha externa em nova aba, Relatório é
          outra rota — por isso sem `role="tab"`/`aria-selected`, só a mesma
          classe visual `NAV_ITEM_*`) + uma divisória discreta + Dashboard
          ↗/Editar/Atualizar Meta/Registrar revisão (AÇÃO — "o que eu quero
          fazer"; usam a MESMA classe visual `NAV_ITEM_*` — sempre
          `NAV_ITEM_INACTIVE_CLASSES`, nunca `NAV_ITEM_ACTIVE_CLASSES`, já
          que ação nunca tem estado "selecionado" — pra ficar na mesma
          altura/alinhamento da navegação, sem virar um bloco de botões
          visualmente diferente). Mesmos hrefs/target/rel/condições/
          permissões de sempre em cada item; nenhum drawer virou página nem
          vice-versa. */}
      <div role="tablist" className="mt-3 flex items-center gap-4 overflow-x-auto border-b border-overview-border text-sm">
        {AREA_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={buildAreaHref(tab.key)}
            scroll={false}
            role="tab"
            aria-selected={tab.key === activeArea}
            className={`${NAV_ITEM_BASE_CLASSES} ${tab.key === activeArea ? NAV_ITEM_ACTIVE_CLASSES : NAV_ITEM_INACTIVE_CLASSES}`}
          >
            {tab.label}
          </Link>
        ))}
        {client.balance_url && (
          <a
            href={client.balance_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES}`}
          >
            Saldo
          </a>
        )}
        {client.monthly_closing_sheet_url && (
          <a
            href={client.monthly_closing_sheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES}`}
          >
            Fechamento
          </a>
        )}
        <Link href={reportHref} className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES}`}>
          Relatório
        </Link>

        {/* Divisória — só indica "começa outro grupo" (navegação → ação),
            nunca um container/background/pill. */}
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-overview-border" />

        {client.dashboard_url && (
          <a
            href={client.dashboard_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES} inline-flex items-center gap-1`}
          >
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            Dashboard
          </a>
        )}
        {/* "Atualizar Meta" (syncClientMetaAction, ../meta-actions.ts) fica
            oculto por enquanto — é a sincronização direta com a API do
            Meta, e a operação usa a sincronização do Stract
            ("Sincronizar agora", acima) como fonte de dados por ora. A
            Server Action continua existindo, só sem porta de entrada
            aqui (mesmo padrão já usado nesta página pra rotas/ações que
            saem de navegação sem serem apagadas, ver comentário de
            "Sprints"/"Clientes" em `sidebar.tsx`). */}
        {canOperate && (
          <Link href={newReviewHref} scroll={false} className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES}`}>
            Registrar revisão
          </Link>
        )}
        {/* Etapa "Refinamento Visual 2.0": Editar por último — é a ação
            administrativa menos frequente do grupo, não deveria abrir a
            hierarquia de ações (mesmo href/permissão de sempre, só a
            posição mudou). */}
        {canManageClient && (
          <Link href={`/clients/${client.id}/edit`} className={`${NAV_ITEM_BASE_CLASSES} ${NAV_ITEM_INACTIVE_CLASSES}`}>
            Editar
          </Link>
        )}
      </div>

      {/* 0. Seletor de mês (Etapa 62, seção 6) — contexto temporal de toda
          a página; mesmo padrão de navegação mensal já usado em
          Relatórios/Visão Geral/Sprints (`?month=YYYY-MM` + shiftMonthParam),
          nenhum componente novo de seletor. Etapa 75: removido o texto
          "Período em análise" — o próprio seletor já comunica o período,
          sem precisar de rótulo.
          Etapa "Primeira dobra": perde a caixa (era `border ... px-1 py-1`)
          — só as setas (`IconButton`, clicáveis de sempre) e o mês, sem
          container visível; menos peso pra um controle que é só contexto,
          não uma ação. O seletor de canal (`VisaoGeralChannelSwitch`, só
          existe na Visão Geral) passa a viver na MESMA linha — "período +
          canal" como contexto único dos dados logo abaixo, em vez de dois
          elementos em posições diferentes da página. Nenhuma navegação,
          filtro, href ou estado mudou. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-0.5 text-sm">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[6rem] px-1 text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        {activeArea === "visao-geral" && (
          <VisaoGeralChannelSwitch baseHref={metricsChannelBaseHref} active={metricsChannel} />
        )}
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
          {/* Indicadores do mês — investimento, resultados e custo por
              resultado (com a meta como texto auxiliar discreto do custo,
              nunca mais uma métrica própria), Performance e Investimento
              lado a lado (Etapa "Primeira dobra: Performance e Investimento
              lado a lado" — dois `%` comparáveis de relance, num grid de 2
              colunas a partir de `md:`, empilhado em telas menores) e
              resultados por canal. A meta do mês (antes numa aba própria,
              depois um card "Performance do mês" à parte) agora é só um
              dado a mais de contexto do custo por resultado — nunca um
              fluxo separado.

              Seletor "Consolidado | Meta Ads | Google Ads" — pedido
              explícito do usuário: escopa Indicadores do mês, cada Sprint,
              Fechamento do mês e Investimento do mês (`MonthInvestmentSummary`
              — QA multicanal: passou a receber
              `visaoGeralPlanned`/`visaoGeralExpectedToDate`/`visaoGeralStatus`,
              não mais os valores sempre-consolidados) ao canal escolhido.
              Etapa "Primeira dobra": o seletor saiu daqui — agora vive
              junto do seletor de mês, acima deste bloco ("período + canal"
              como contexto único) — mesmo href/estado ativo de sempre, só
              a posição mudou.

              Etapa "Simetria Performance x Investimento":
              `MonthInvestmentSummary` (core, montado aqui com as MESMAS
              props de sempre) vira o slot `investmentSummary`;
              `MonthInvestmentActions` (disclosure/edição/histórico, extraído
              do core nesta etapa) vira o slot `investmentActions`, numa
              linha compartilhada abaixo do grid — é `AccountFollowUpPanel`
              quem decide o layout, nunca duplicando a lógica/props de
              investimento aqui. */}
          <div className="mt-3 rounded-lg border border-overview-border bg-overview-surface p-3">
            <AccountFollowUpPanel
              monthActual={visaoGeralMonthActual}
              performanceGoal={performanceGoal}
              performanceSummary={visaoGeralPerformanceSummary}
              targetCostPerResult={scopedTargetCostPerResult}
              targetResultCount={scopedTargetResultCount}
              expectedResultsToDate={expectedResultsToDate}
              channelBreakdown={monthPerformanceChannelBreakdown}
              configureObjectiveHref={`/clients/${client.id}/edit`}
              investmentSummary={
                <MonthInvestmentSummary
                  planned={visaoGeralPlanned}
                  actual={visaoGeralMonthActual}
                  expectedToDate={visaoGeralExpectedToDate}
                  status={visaoGeralStatus}
                  monthLabel={monthLabel}
                  sprints={budgetSprints}
                  monthRange={planningHorizon}
                  effectiveDate={effectiveDate}
                  isClosedMonth={isClosedMonth}
                  isFutureMonth={isFutureMonth}
                  currentPlanningEndDate={planningEndDate}
                />
              }
              investmentActions={
                <MonthInvestmentActions
                  planned={visaoGeralPlanned}
                  actual={visaoGeralMonthActual}
                  expectedToDate={visaoGeralExpectedToDate}
                  status={visaoGeralStatus}
                  clientId={client.id}
                  monthParam={monthParam}
                  monthLabel={monthLabel}
                  sprints={budgetSprints}
                  monthRange={planningHorizon}
                  effectiveDate={effectiveDate}
                  isAdmin={isAdmin}
                  isClosedMonth={isClosedMonth}
                  isClosedByHorizonOnly={isClosedByHorizonOnly}
                  isFutureMonth={isFutureMonth}
                  lastChange={lastChange}
                  historyHref={historyDrawerHref}
                  performanceGoal={performanceGoal}
                  channels={AVAILABLE_TRAFFIC_CHANNELS}
                  byChannel={clientPlan.byChannel}
                  calendarMonthRange={{ firstDay, lastDay }}
                  currentPlanningEndDate={planningEndDate}
                />
              }
            />
          </div>

          <SecondaryGoalsPerformance goals={secondaryGoalsPerformance} />

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
                      // Seletor Consolidado/Meta/Google: só o `actualSpend`
                      // exibido muda (`sprintActualSpendByChannelBySprintId`,
                      // acima) — `plannedSpend`/`status`/`progressPct`/
                      // `expectedToDate` continuam os valores consolidados
                      // de sempre, mas nenhum deles é lido pelo card neste
                      // modo (`hideTaskList`, relatório semanal — só o
                      // financeiro/performance aparece, nunca o badge de
                      // ritmo/planejado desta sprint).
                      sprint={
                        metricsChannel === "consolidated"
                          ? sprint
                          : { ...sprint, actualSpend: sprintActualSpendByChannelBySprintId.get(sprint.sprintId) ?? 0 }
                      }
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
                      targetCostPerResult={scopedTargetCostPerResult}
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
                creativeDetailHrefBase={creativeDetailHrefBase}
                unattributedResultCount={unattributedCreativeResultCount}
                creativeHistoryStartsLaterThanPeriod={creativeHistoryStartsLaterThanPeriod}
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
              <div className="mt-3 flex items-center justify-between border-t border-overview-border pt-2 text-xs">
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

      {/* Etapa "Refinamento Visual 2.0 — Progressive Disclosure": única
          superfície pra contexto técnico operacional — antes fragmentado em
          "Última otimização"/"Dados atualizados"/sincronização (uma faixa
          própria no topo do cabeçalho) + "Detalhes e histórico" (sync runs)
          + "Histórico" (drawer de atividades), cada um num lugar diferente.
          Sempre a MESMA informação de sempre (nenhum dado/cálculo/permissão
          novo), só reunida, discreta e FORA do fluxo principal — depois de
          todo o conteúdo prioritário de qualquer aba, nunca competindo com
          KPIs/Performance/Investimento na primeira leitura. Compartilhada
          entre todas as abas (não só Visão Geral) — nenhuma aba perdeu
          acesso a "Sincronizar agora"/histórico, só pararam de aparecer
          sempre abertos por padrão. Estado saudável mora só aqui, silencioso
          — a exceção (sincronização com problema) já apareceu antes, junto
          dos demais banners no topo (ver `stractSyncNeedsAttention`). */}
      <div className="mt-4 border-t border-overview-border pt-3">
        <details className="text-xs text-overview-text-secondary [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer select-none font-medium text-overview-text-primary">Informações da conta</summary>
          <div className="mt-2 flex flex-col items-start gap-2">
            <span className="flex items-center gap-1">
              <ClipboardCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
              {lastOptimizationLabel}:{" "}
              <span
                className="font-medium text-overview-text-primary"
                title={
                  lastOptimization
                    ? `${ACCOUNT_REVIEW_OUTCOME_LABEL[lastOptimization.outcome]}${lastOptimizationDetail ? ` · ${lastOptimizationDetail}` : ""}`
                    : undefined
                }
              >
                {lastOptimizationValue}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <BarChart3 className="h-3 w-3 shrink-0" aria-hidden="true" />
              {lastPerformanceUpdateLabel}: <span className="font-medium text-overview-text-primary">{lastPerformanceUpdateValue}</span>
              {lastPerformanceUpdateSourceLabel && <span>· {lastPerformanceUpdateSourceLabel}</span>}
            </span>

            {stractImportSourceIds.length > 0 ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      latestSyncStatus
                        ? SYNC_RUN_STATUS_BADGE_CLASSES[latestSyncStatus.status]
                        : "bg-overview-surface-subtle text-overview-text-secondary"
                    }`}
                  >
                    {latestSyncStatus ? SYNC_RUN_STATUS_LABEL[latestSyncStatus.status] : "Nunca sincronizado"}
                  </span>
                  <span>
                    Stract{latestSyncStatus ? ` · sincronizado ${formatRelativeDateTime(latestSyncStatus.startedAt, nowInstant)}` : ""}
                    {latestSpendDate ? ` · dados até ${formatShortDate(latestSpendDate)}` : ""}
                  </span>
                </span>
                {canOperate && (
                  <form action={syncClientStractSourcesAction.bind(null, client.id)}>
                    <SubmitButton pendingChildren="Sincronizando..." className={HEADER_SUBMIT_BUTTON_CLASSES}>
                      Sincronizar agora
                    </SubmitButton>
                  </form>
                )}
                {isAdmin && recentSyncRuns.length > 0 && (
                  <details className="w-full [&_summary::-webkit-details-marker]:hidden">
                    <summary className="cursor-pointer select-none font-medium text-overview-text-primary">Detalhes técnicos de sincronização</summary>
                    <ul className="mt-2 flex flex-col gap-2">
                      {recentSyncRuns.map((run) => (
                        <li key={run.id} className="flex flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SYNC_RUN_STATUS_BADGE_CLASSES[run.status]}`}>
                              {SYNC_RUN_STATUS_LABEL[run.status]}
                            </span>
                            <span>{formatRelativeDateTime(run.startedAt, nowInstant)}</span>
                          </div>
                          {formatSyncRunCounts(run) && <p>{formatSyncRunCounts(run)}</p>}
                          {run.errorMessage && <p className="text-overview-danger">{run.errorMessage}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              // Auditoria de Frescor/Confiabilidade de Dados: cliente sem
              // fonte Stract (Meta-only, a maioria) não tinha nenhum
              // indicador manual de frescor nesta página. Sem badge de
              // status (não existe "success/partial/failed" pro Meta, só o
              // timestamp cru) — nenhuma classificação nova, só o fato.
              clientOperationalState?.lastDataSyncAt && (
                <span>Dados sincronizados {formatRelativeDateTime(clientOperationalState.lastDataSyncAt, nowInstant)}</span>
              )
            )}

            <Link href={reviewsHistoryHref} scroll={false} className="font-medium text-brand hover:underline">
              Ver histórico completo de atividades
            </Link>
          </div>
        </details>
      </div>

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
            channel: change.channel as TrafficChannel,
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
