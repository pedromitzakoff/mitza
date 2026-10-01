import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  assertSingleCurrentSprint,
  currentMonthRange,
  findSprintForDate,
  getSprintTemporalStatus,
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { formatSprintPeriodLabel } from "@/lib/sprint-week";
import { classifySpendStatus } from "@/lib/spend-status";
import { resolveBudgetEffectiveDate, computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { resolveClientMonthlyGoals, resolveTargetCostPerResult, type ClientPlanChangeRow } from "@/lib/client-plan";
import type { ChannelMetrics } from "@/lib/channel-metrics";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel, formatRelativeDateTime, formatDueDate } from "@/lib/format";
import { contractStatusBannerText } from "@/lib/client-fields";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { resolveOperationPriorityGroup } from "@/lib/operation-triage";
import { PRIORITY_GROUP_TONE } from "@/app/operation/operation-client-card";
import { emphasizeDeviationText } from "@/components/workspace/status-dot";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { MonthInvestmentPaceNote } from "../month-investment-summary";
import { MonthlyBudgetHistoryDrawer } from "../monthly-budget-history-drawer";
import { ChannelPlanEditor } from "../channel-plan-editor";
import { AccountFollowUpPanel } from "../account-follow-up-panel";
import { SecondaryGoalsPerformance } from "../secondary-goals-performance";
import { listClientGoals, resolvePrimaryGoal, fetchGoalDisplaySummaries, type ClientGoal } from "@/lib/client-goals";
import { fetchSecondaryGoalsPerformance } from "@/lib/secondary-goal-performance";
import { computePerformanceSummary, aggregatePerformanceResults } from "@/lib/performance";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { AVAILABLE_TRAFFIC_CHANNELS, resolveClientChannelScopeOptions, resolveSelectedChannelScope, type TrafficChannel } from "@/lib/traffic-channels";
import { VisaoGeralChannelSwitch, type VisaoGeralMetricsChannel } from "../visao-geral-channel-switch";
import { MonthSelect } from "../month-select";
import { GoalSelect } from "../goal-select";
import { countOpenDemandas } from "@/lib/pendencias";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { TASK_PRIORITY_DOT_CLASS } from "../task-labels";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
import { WorkspaceContainer } from "../workspace-container";
import { IconButton } from "@/components/workspace/button";

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * Objetivo em exibição na Performance (`?goal=`) — núcleo puro extraído de
 * dentro do componente (Etapa "Primeira Rodada Visual — Contexto +
 * Performance", seção 6/18 do pedido), mesmo padrão de
 * `resolveOperationGoal` (`app/operation/page.tsx`): valor inválido/ausente
 * NUNCA quebra a página, sempre cai num default seguro. Aqui o default é o
 * objetivo PRINCIPAL do cliente (nunca `"todos"` como em Operação — a
 * Performance sempre mostra EXATAMENTE um objetivo por vez), e "válido"
 * significa literalmente "está entre os objetivos que ESTE cliente tem
 * configurado" — nunca um objetivo de outro cliente sobrevivendo a uma
 * troca (seção 6: "compatível com troca de cliente").
 */
export function resolveSelectedGoal(
  goalParam: string | undefined,
  availableGoalTypes: PerformanceGoal[],
  primaryResultType: PerformanceGoal | null,
): PerformanceGoal | null {
  return goalParam && availableGoalTypes.includes(goalParam as PerformanceGoal) ? (goalParam as PerformanceGoal) : primaryResultType;
}

/**
 * Monta a URL de um dos 3 dropdowns de contexto (Mês/Meta-Planejamento/
 * Canal) — núcleo puro extraído de dentro do componente, mesmo motivo de
 * `resolveSelectedGoal` acima (testável sem Next/Supabase). Preserva
 * SEMPRE os 3 parâmetros juntos — nunca um dropdown reseta o estado dos
 * outros dois (seção 6 do pedido). `undefined` num campo de `overrides`
 * mantém o valor atual (`current`); `null` limpa o param explicitamente
 * (usado pelo objetivo PRINCIPAL, que navega pra uma URL SEM `goal` —
 * ausência é o estado "default", nunca um valor reservado).
 */
export function buildClientContextHref(
  clientId: string,
  current: { month?: string; metricsChannel?: string; goal?: string },
  overrides: { month?: string; metricsChannel?: string | null; goal?: string | null },
): string {
  const params = new URLSearchParams();
  const monthValue = overrides.month ?? current.month;
  if (monthValue) params.set("month", monthValue);
  const channelValue = overrides.metricsChannel !== undefined ? overrides.metricsChannel : current.metricsChannel;
  if (channelValue) params.set("metricsChannel", channelValue);
  const goalValue = overrides.goal !== undefined ? overrides.goal : current.goal;
  if (goalValue) params.set("goal", goalValue);
  const qs = params.toString();
  return `/clients/${clientId}${qs ? `?${qs}` : ""}`;
}

/**
 * `/clients/[id]` — PAINEL PRINCIPAL do cliente (Etapa "Correção de UX do
 * Workspace", que corrige — sem desfazer — a Etapa "MITZA — Reformulação
 * Estrutural" anterior). A pergunta que esta página responde: "como está
 * esse cliente e o que preciso saber/fazer agora?".
 *
 * A Fase 1 tinha transformado esta rota só na "Visão geral", uma de 5 abas
 * equivalentes (Visão geral/Performance/Operação/Demandas/Configurações)
 * — na prática, 5 mini-sistemas. Validação visual no deploy mostrou que
 * isso fragmentou demais a experiência. Esta correção reintegra Performance
 * + Operação + Demandas numa ÚNICA visão de trabalho, sem desfazer nenhuma
 * rota/loader/pipeline da Fase 1:
 *
 * 1. PERFORMANCE — `AccountFollowUpPanel` (KPIs + ritmo do mês, já existia
 *    aqui) + `SecondaryGoalsPerformance`. Taxa de conversão (carrinho→venda)
 *    saiu daqui — pedido explícito de simplificação, fica só dentro de
 *    `/relatorio` (`report-filterable-tables.tsx`), nunca duplicada. O CTA
 *    de aprofundamento que ficava no fim deste bloco também foi removido —
 *    o link "Relatório" na barra de contexto (topo, junto de Dashboard/
 *    Saldo/Fechamento) cobre o mesmo destino (`/relatorio`, que continua
 *    existindo intacto — mesma Camada
 *    1/2, nenhum cálculo duplicado).
 * 2. OPERAÇÃO — resumo leve (sprint atual, última otimização, saúde/motivo
 *    do CPA — os MESMOS dados/funções já usados por `/operation` e pela
 *    fila global de Operação, nunca uma segunda implementação) com CTA
 *    "Ver operação completa →" pra `/operation`.
 * 3. DEMANDAS — contagem + até 3 itens mais urgentes, reaproveitando
 *    `loadPendenciasRawData`/`countOpenDemandas` (MESMA fonte/regra de
 *    `/demandas` e da Home — `origin='manual'`), com CTA "Ver todas →"
 *    pra `/clients/[id]/demandas`.
 *
 * `/relatorio`, `/operation`, `/clients/[id]/demandas` e `/edit` continuam
 * existindo como rotas de APROFUNDAMENTO (seção 15 do pedido de correção:
 * "as rotas da Fase 1 não foram um erro") — só deixaram de competir como
 * abas iguais no header; a barra `role="tablist"` saiu de
 * `client-workspace-header.tsx`.
 *
 * Nenhum cálculo de investimento/performance mudou nesta correção — só a
 * composição visual e a largura (`WorkspaceContainer`, ver doc-comment de
 * `workspace-container.tsx` pra a causa raiz do `max-w-5xl` estreito).
 *
 * ROLLBACK DE INCIDENTE (2026-09-29): a rodada seguinte ("Correção de
 * Direção do Workspace") tinha substituído os resumos abaixo pelo conteúdo
 * completo de Performance/Operação/Demandas/Funis na própria página — isso
 * causou uma quebra em produção (Não foi possível carregar esta página)
 * restrita a alguns gestores/clientes (padrão consistente com RLS/permissão
 * numa das tabelas novas — `client_funnels`/`campaign_funnel_assignments`
 * do bloco de Funis, ou algo em `operation-section-data.ts`, ambos agora
 * carregados sempre em vez de só sob demanda em `/relatorio`/`/operation`).
 * Nunca diagnosticado com certeza (sem acesso a logs/RLS de produção neste
 * ambiente) — restaurado este arquivo pro último estado confirmado
 * funcionando pra TODOS os usuários antes de reinvestigar com calma.
 * `operation-section-data.ts`/`operation-section.tsx` (extração usada por
 * `/operation`) e a Etapa de conclusão de Demandas continuam intactos —
 * só esta página voltou atrás.
 */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    synced?: string;
    saved?: string;
    month?: string;
    historicoOrcamento?: string;
    metricsChannel?: string;
    goal?: string;
  }>;
}) {
  const { id } = await params;
  const {
    error,
    synced,
    saved,
    month: monthQueryParam,
    historicoOrcamento,
    metricsChannel: metricsChannelParam,
    goal: goalParam,
  } = await searchParams;

  function buildContextHref(overrides: { month?: string; metricsChannel?: string | null; goal?: string | null }): string {
    return buildClientContextHref(id, { month: monthQueryParam, metricsChannel: metricsChannelParam, goal: goalParam }, overrides);
  }

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(name), performance_goal, target_cost_per_result, avatar_url, media_channels, dashboard_url, balance_url, monthly_closing_sheet_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[ClientPage] falha ao buscar cliente ${id}:`, clientQueryError);
  if (!client) notFound();

  const metricsChannelOptions = resolveClientChannelScopeOptions(client.media_channels);
  const metricsChannel: VisaoGeralMetricsChannel = resolveSelectedChannelScope(metricsChannelParam, client.media_channels);

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;

  const [clientOperationalState] = await loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, id);
  const primaryReasonText = clientOperationalState?.evaluation.primaryDimension ? clientOperationalState.evaluation.primaryReason : null;
  const primaryReasonTone = clientOperationalState ? PRIORITY_GROUP_TONE[resolveOperationPriorityGroup(clientOperationalState.evaluation)] : "neutral";

  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const prevMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, -1) });
  const nextMonthHref = buildContextHref({ month: shiftMonthParam({ firstDay }, 1) });
  // Preserva mês + canal + objetivo juntos (antes só preservava mês) — mesma
  // URL usada pro fechamento de drawers (histórico de orçamento,
  // Planejamento) e por qualquer CTA que precise "voltar pro estado atual".
  const returnTo = buildContextHref({});

  const [sprintsRaw, dailySpend, plannedAllocations, budgetChangesRaw, performanceTargetHistoryRaw, channelSpendRows, planningEndDate, allClientGoals] =
    await Promise.all([
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
        supabase.from("daily_spend").select("date, spend, channel").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "daily_spend",
      ),
      requireQuery(
        supabase.from("sprint_planned_allocations").select("sprint_id, date, planned_amount").eq("client_id", id).gte("date", firstDay).lte("date", lastDay),
        "sprint_planned_allocations",
      ),
      // Etapa "Primeira Rodada Visual — Contexto + Performance" (seção 5 do
      // pedido): busca TODOS os objetivos do mês (não mais só o principal
      // via `.or(primaryGoalResultTypeFilter(...))`) — `result_type` agora
      // selecionado explicitamente, a separação por objetivo acontece em
      // JS logo abaixo (`primaryBudgetChanges`/`selectedBudgetChanges`),
      // nunca duas queries por objetivo.
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select(
            "id, channel, result_type, effective_date, changed_at, previous_amount, new_amount, consolidated_amount, future_amount_distributed, resulting_total, is_below_consolidated, reason, changed_by_profile:team_members!monthly_budget_changes_changed_by_fkey(name)",
          )
          .eq("client_id", id)
          .eq("month", firstDay)
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:current-month",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("channel, result_type, month, changed_at, new_amount, target_result_count, target_cost_per_result")
          .eq("client_id", id)
          .lte("month", firstDay)
          .order("month", { ascending: false })
          .order("changed_at", { ascending: false }),
        "monthly_budget_changes:target-history",
      ),
      requireQuery(
        supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
        "sprint_channel_spend",
      ),
      getClientMonthHorizon(supabase, id, firstDay),
      listClientGoals(supabase, id),
    ]);

  const planningHorizon = resolvePlanningHorizon({ firstDay, lastDay }, planningEndDate);

  const channelSpendOverrideRows: SprintChannelSpendOverrideRow[] = (channelSpendRows ?? []).map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    spend_source: r.spend_source,
    manual_actual_spend: r.manual_actual_spend,
  }));
  const dailySpendChannelRows = (dailySpend ?? []).map((d) => ({ date: d.date, channel: d.channel as TrafficChannel, spend: d.spend }));
  const sprints = sprintsRaw.map((sprint) => ({
    ...sprint,
    manual_actual_spend: resolveManualActualSpend(
      sprint.manual_actual_spend,
      channelSpendOverrideRows.filter((r) => r.sprintId === sprint.id),
    ),
  }));
  assertSingleCurrentSprint(sprints, today);

  const performanceRecordRows = await resolvePerformanceRowsForSprints(
    supabase,
    sprints.map((s) => ({ id: s.id, client_id: id, start_date: s.start_date, end_date: s.end_date })),
  );
  const performanceRecords = performanceRecordRows.map((r) => ({
    sprintId: r.sprint_id,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));

  // Múltiplos Objetivos (Etapa "Primeira Rodada Visual — Contexto +
  // Performance", seção 5 do pedido): ZERO migration — reaproveita
  // `client_goals`/`monthly_budget_changes.result_type`/
  // `resolveClientMonthlyGoals`, exatamente a estrutura que a auditoria
  // confirmou já existir. Cliente legado sem nenhuma linha em
  // `client_goals` (não deveria acontecer — todo `performance_goal`
  // configurado foi backfilled na Etapa "Múltiplos Objetivos" — mas sem
  // depender dessa garantia aqui) cai num objetivo "virtual" só com o
  // `performance_goal` legado, pra `resolveClientMonthlyGoals` continuar
  // funcionando sem um caso especial espalhado pela página inteira.
  const effectiveClientGoals: ClientGoal[] =
    allClientGoals.length > 0
      ? allClientGoals
      : client.performance_goal
        ? [{ id: "", clientId: id, resultType: client.performance_goal, channels: [], isPrimary: true, resultSource: "automatic" }]
        : [];
  const primaryResultType = resolvePrimaryGoal(effectiveClientGoals)?.resultType ?? null;

  // Objetivo em exibição — `resolveSelectedGoal` (núcleo puro acima, mesmo
  // padrão de `resolveOperationGoal`). Substitui a antiga
  // `performanceGoal = client.performance_goal` — todo o resto da página
  // continua lendo esta MESMA variável, nenhum outro nome novo espalhado
  // pela função.
  const performanceGoal = resolveSelectedGoal(
    goalParam,
    effectiveClientGoals.map((g) => g.resultType),
    primaryResultType,
  );

  // Objetivos secundários — agora exclui o que está SELECIONADO (nunca mais
  // só "não-principal"), pra nunca duplicar o mesmo objetivo no bloco
  // principal E no card de "Outros objetivos" ao mesmo tempo (seção 8 do
  // pedido). Quando o selecionado É o principal (caso comum, default), o
  // resultado é idêntico ao de antes desta etapa.
  const secondaryClientGoals = effectiveClientGoals.filter((g) => g.resultType !== performanceGoal);
  const secondaryGoalTargets = await fetchGoalDisplaySummaries(supabase, id, secondaryClientGoals, firstDay);
  const secondaryGoalsPerformance = await fetchSecondaryGoalsPerformance(
    supabase,
    id,
    secondaryClientGoals,
    { firstDay, lastDay },
    new Map(Array.from(secondaryGoalTargets.entries()).map(([goal, summary]) => [goal, summary.targetResultCount])),
  );

  // `performanceTargetHistoryRaw` agora vem SEM filtro de objetivo (busca
  // acima) — linha histórica com `result_type IS NULL` (de antes da Etapa
  // "Múltiplos Objetivos") é sempre do objetivo PRINCIPAL (única leitura
  // possível: só existia um objetivo por cliente nessa época), nunca do
  // secundário — mesma regra que `primaryGoalResultTypeFilter` já
  // codificava, só que resolvida aqui em JS pra poder atender QUALQUER
  // objetivo selecionado na mesma passada, não só o principal.
  const performanceTargetHistoryRows: ClientPlanChangeRow[] = (performanceTargetHistoryRaw ?? []).map((row) => ({
    channel: row.channel as TrafficChannel,
    month: row.month,
    changedAt: row.changed_at,
    investment: row.new_amount,
    targetResultCount: row.target_result_count,
    resultType: (row.result_type ?? primaryResultType) as PerformanceGoal | null,
  }));
  const clientGoalsPlan = resolveClientMonthlyGoals({
    channels: AVAILABLE_TRAFFIC_CHANNELS,
    changes: performanceTargetHistoryRows,
    selectedMonth: firstDay,
    clientGoals: effectiveClientGoals,
  });
  const EMPTY_GOAL_PLAN: { byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>; consolidated: ChannelMetrics } = {
    byChannel: {},
    consolidated: { investment: null, resultCount: null, cpa: null },
  };
  const primaryGoalPlan = clientGoalsPlan.goals.find((g) => g.resultType === primaryResultType) ?? EMPTY_GOAL_PLAN;
  const selectedGoalPlan = clientGoalsPlan.goals.find((g) => g.resultType === performanceGoal) ?? EMPTY_GOAL_PLAN;

  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount }));
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);

  // Congelamento de sprint (`ensureClosedSprintSnapshots`) SEMPRE usa o
  // orçamento do objetivo PRINCIPAL, nunca o que está em exibição no
  // momento — é uma escrita permanente (`sprints.original_planned_amount`/
  // `final_recommended_amount`), não pode depender de qual objetivo um
  // gestor específico escolheu olhar quando uma sprint fechou. Quando o
  // objetivo selecionado É o principal (default), `primaryMonthPlanned`/
  // `primaryBudgetChanges` são idênticos ao que a página já usava antes
  // desta etapa — zero mudança de comportamento no caminho comum.
  const primaryMonthPlanned = primaryGoalPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const primaryBudgetChanges = (budgetChangesRaw ?? []).filter((c) => (c.result_type ?? primaryResultType) === primaryResultType);
  const selectedBudgetChanges = (budgetChangesRaw ?? []).filter((c) => (c.result_type ?? primaryResultType) === performanceGoal);

  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: planningHorizon,
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: primaryBudgetChanges.map((c) => ({ channel: c.channel as TrafficChannel, newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: primaryMonthPlanned,
  });

  // Daqui pra baixo, "o mês" pro PAINEL (Ritmo/KPIs/diagnóstico) é o
  // orçamento do objetivo EM EXIBIÇÃO — responde ao seletor "Meta /
  // Planejamento" (seção 7 do pedido), nunca mais travado no principal.
  const selectedMonthPlanned = selectedGoalPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(selectedMonthPlanned, planningHorizon, todayStr).expectedToDate;
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, selectedMonthPlanned);

  const visaoGeralMonthActual =
    metricsChannel === "consolidated"
      ? monthActual
      : sumChannelEffectiveSpend(
          sprints.map((s) => ({ sprintId: s.id, start_date: s.start_date, end_date: s.end_date })),
          metricsChannel,
          dailySpendChannelRows,
          channelSpendOverrideRows,
        );
  const visaoGeralPlanned = metricsChannel === "consolidated" ? selectedMonthPlanned : (selectedGoalPlan.byChannel[metricsChannel]?.investment ?? 0);
  const visaoGeralExpectedToDate =
    metricsChannel === "consolidated"
      ? monthExpectedToDate
      : computeMonthlyExpectedToDateByCalendar(visaoGeralPlanned, planningHorizon, todayStr).expectedToDate;
  const visaoGeralStatus =
    metricsChannel === "consolidated" ? monthStatus : classifySpendStatus(visaoGeralMonthActual, visaoGeralExpectedToDate, visaoGeralPlanned);

  // `legacyFallback` (coluna antiga `clients.target_cost_per_result`) só se
  // aplica ao objetivo PRINCIPAL — nunca inventa a meta de custo de um
  // objetivo secundário a partir do campo legado do principal.
  const scopedTargetCostPerResult = resolveTargetCostPerResult({
    channel: metricsChannel,
    plan: selectedGoalPlan,
    legacyFallback: performanceGoal === primaryResultType ? client.target_cost_per_result : null,
  });
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
  const scopedTargetResultCount =
    metricsChannel === "consolidated" ? selectedGoalPlan.consolidated.resultCount : (selectedGoalPlan.byChannel[metricsChannel]?.resultCount ?? null);
  const expectedResultsToDate =
    scopedTargetResultCount !== null ? computeMonthlyExpectedToDateByCalendar(scopedTargetResultCount, planningHorizon, todayStr).expectedToDate : null;
  const monthPerformanceChannelBreakdown =
    performanceGoal && metricsChannel === "consolidated"
      ? AVAILABLE_TRAFFIC_CHANNELS.map((channel) => ({
          channel,
          resultCount: aggregatePerformanceResults(performanceRecords, performanceGoal, channel).resultCount,
        })).filter((entry) => entry.resultCount > 0)
      : [];

  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);
  const isFutureMonth = !isCurrentMonth && !isClosedMonth;
  const budgetSprints = sprints.map((sprint) => ({ sprintId: sprint.id, startDate: sprint.start_date, endDate: sprint.end_date }));
  const lastBudgetChange = selectedBudgetChanges[0] ?? null;
  const lastChange = lastBudgetChange
    ? {
        lastEffectiveDate: lastBudgetChange.effective_date,
        lastPreviousAmount: lastBudgetChange.previous_amount,
        lastNewAmount: lastBudgetChange.new_amount,
        changeCountThisMonth: selectedBudgetChanges.length,
      }
    : null;

  // Demandas — resumo (Etapa "Correção de UX do Workspace", seção 10 do
  // pedido): contagem + até 3 itens mais urgentes, nunca a List View
  // inteira. Reaproveita `loadPendenciasRawData` (MESMA fonte/regra de
  // `/clients/[id]/demandas` e da área global — `origin='manual'`), nunca
  // uma terceira implementação da regra nem uma query paralela.
  const { items: demandaItems } = await loadPendenciasRawData(supabase, id);
  const { openCount: demandasOpenCount, overdueCount: demandasOverdueCount } = countOpenDemandas(
    demandaItems.map((item) => ({ origin: "manual" as const, client_id: id, status: item.rawStatus, due_date: item.dueDate })),
    () => true,
    today,
  );
  const demandasPreview = demandaItems
    .filter((item) => item.status !== "feito" && item.status !== "nao_realizado")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);

  // Operação — resumo (seção 9 do pedido): sprint atual, última otimização,
  // saúde/motivo do CPA. MESMOS dados/funções já usados por `/operation` e
  // pela fila global de Operação — nenhum cálculo novo, nunca tasks (isso
  // é Demandas×Operação de novo — ver bug corrigido na Fase 1). Sprint
  // atual só quando a Performance está no mês corrente (`isCurrentMonth`)
  // — fora dele o resumo operacional não reaproveitaria o `sprints` já
  // buscado pro mês em exibição, e buscar um segundo conjunto só pra isso
  // violaria "não duplicar dados" (seção 19).
  const currentSprint = isCurrentMonth ? findSprintForDate(sprints, todayStr) : null;
  const currentSprintLabel = currentSprint
    ? `${formatSprintPeriodLabel(currentSprint.start_date, currentSprint.end_date)} · ${
        getSprintTemporalStatus(currentSprint, today) === "atual" ? "em andamento" : "concluída"
      }`
    : null;

  const [lastReviewRow] = await requireQuery(
    supabase
      .from("account_reviews")
      .select("reviewed_at, outcome, team_member:team_members!account_reviews_team_member_id_fkey(name)")
      .eq("client_id", id)
      .order("reviewed_at", { ascending: false })
      .limit(1),
    "account_reviews:painel-operacao-resumo",
  );
  const lastOptimizationLabel = lastReviewRow
    ? `${ACCOUNT_REVIEW_OUTCOME_LABEL[lastReviewRow.outcome]} · ${formatRelativeDateTime(lastReviewRow.reviewed_at, new Date())}${lastReviewRow.team_member?.name ? ` · ${lastReviewRow.team_member.name}` : ""}`
    : "Nenhuma otimização registrada";

  // Sinal de sincronização com problema real agora vive só em "Informações
  // da conta" (drawer global do workspace) — nunca mais duplicado aqui.
  const contractBannerText = contractStatusBannerText(client.status);
  const banners = [
    contractBannerText && { tone: "amber", text: `${contractBannerText} A página continua acessível apenas para consulta de histórico.` },
    error && { tone: "red", text: error },
    synced && { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` },
    saved && { tone: "green", text: "Dados do cliente atualizados." },
  ].filter((banner): banner is { tone: "red" | "green" | "amber"; text: string } => Boolean(banner));

  const historyDrawerHref = withParam(returnTo, "historicoOrcamento=1");

  // Links externos (Dashboard/Saldo/Fechamento) — existiam na barra de
  // navegação da página antiga (auditoria via git show 402e0af), tinham
  // sumido sem substituto na Fase 1; restaurados aqui na correção de
  // direção (c707395) e removidos por engano no rollback de incidente
  // (a252f78, que revertia só a composição de Performance/Operação/
  // Demandas). Nunca tiveram relação com o bug real do incidente
  // (`formatDueDate` chamada do server, corrigido em 54f451d) — seguros
  // pra restaurar de volta.
  const externalLinks = [
    client.dashboard_url && { label: "Dashboard", href: client.dashboard_url },
    client.balance_url && { label: "Saldo", href: client.balance_url },
    client.monthly_closing_sheet_url && { label: "Fechamento", href: client.monthly_closing_sheet_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  return (
    <WorkspaceContainer>
      <ScrollRestoreOnMount />
      <ClientWorkspaceContext name={client.name} />

      {banners.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
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

      {/* CONTEXTO — mês/objetivo/canal em exibição, compartilhados pelo bloco
          de performance abaixo (Etapa "Primeira Rodada Visual — Contexto +
          Performance", seção 3 do pedido: hierarquia Cliente, depois Mês,
          depois Meta/Objetivo, depois Canal, depois o conteúdo de
          performance em si — visualmente homogênea entre os 3 dropdowns —
          `ClientContextSelect`,
          `month-select.tsx`/`goal-select.tsx`/`visao-geral-channel-switch.tsx`).
          Prev/next continuam como atalho discreto ao lado do mês (seção 4:
          "pode manter"). */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-overview-border pb-3 text-sm">
        <div className="flex items-center gap-0.5">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <MonthSelect today={today} selectedMonthParam={monthParam} buildHref={(value) => buildContextHref({ month: value })} />
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <GoalSelect goals={effectiveClientGoals} selectedResultType={performanceGoal} buildHref={(goal) => buildContextHref({ goal })} />
        <VisaoGeralChannelSwitch
          buildHref={(channel) => buildContextHref({ metricsChannel: channel })}
          active={metricsChannel}
          options={metricsChannelOptions}
        />
        {/* Planejamento continua restrito ao objetivo PRINCIPAL nesta rodada
            — editar o plano de um objetivo SECUNDÁRIO exigiria mexer em
            `channel-plan-editor.tsx` (fora do escopo de arquivos desta
            etapa) pra gravar o `result_type` certo; sem essa mudança,
            arriscaria salvar no lugar errado. Ver relatório final, item M. */}
        {isAdmin && !isClosedMonth && effectiveDate && performanceGoal === primaryResultType && (
          <ChannelPlanEditor
            clientId={client.id}
            monthParam={monthParam}
            monthLabel={monthLabel}
            monthRange={{ firstDay, lastDay }}
            currentPlanningEndDate={planningEndDate}
            channels={AVAILABLE_TRAFFIC_CHANNELS}
            byChannel={selectedGoalPlan.byChannel}
            performanceGoal={performanceGoal}
          />
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/clients/${client.id}/relatorio`} className="text-xs font-medium text-overview-text-secondary hover:underline">
            Relatório
          </Link>
          {externalLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-overview-text-secondary hover:underline"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* PERFORMANCE — "o que está acontecendo?" (seção 7 do pedido de
          correção): KPIs + ritmo do mês (já existia aqui) + metas
          secundárias/conversão — rótulos "Performance do mês"/"Ritmo do mês"
          e o CTA de relatório completo que ficava aqui embaixo foram
          removidos (pedido explícito de simplificação); o link "Relatório"
          na barra de contexto acima cobre o mesmo destino (`/relatorio`,
          reaproveitado 100%, nenhum cálculo duplicado). */}
      <div className="mt-6">
        <AccountFollowUpPanel
          monthActual={visaoGeralMonthActual}
          performanceGoal={performanceGoal}
          performanceSummary={visaoGeralPerformanceSummary}
          targetCostPerResult={scopedTargetCostPerResult}
          targetResultCount={scopedTargetResultCount}
          expectedResultsToDate={expectedResultsToDate}
          channelBreakdown={monthPerformanceChannelBreakdown}
          configureObjectiveHref={`/clients/${client.id}/edit`}
          investmentPlanned={visaoGeralPlanned}
          investmentExpectedToDate={visaoGeralExpectedToDate}
          investmentStatus={visaoGeralStatus}
          investmentMonthLabel={monthLabel}
          investmentMonthRange={planningHorizon}
          isFutureMonth={isFutureMonth}
          isClosedMonth={isClosedMonth}
          currentPlanningEndDate={planningEndDate}
          investmentPaceNote={
            <MonthInvestmentPaceNote
              planned={visaoGeralPlanned}
              actual={visaoGeralMonthActual}
              expectedToDate={visaoGeralExpectedToDate}
              sprints={budgetSprints}
              monthRange={planningHorizon}
              effectiveDate={effectiveDate}
              isClosedMonth={isClosedMonth}
              isFutureMonth={isFutureMonth}
              isAdmin={isAdmin}
              lastChange={lastChange}
              historyHref={historyDrawerHref}
            />
          }
        />
      </div>

      <SecondaryGoalsPerformance goals={secondaryGoalsPerformance} />

      {/* OPERAÇÃO — "estamos executando corretamente?" (seção 9 do pedido de
          correção): resumo leve (sprint atual, última otimização, saúde do
          CPA) — MESMOS dados/funções de `/operation` e da fila global de
          Operação, nunca tasks aqui (Demandas×Operação nunca se misturam —
          correção da Fase 1 permanece intacta). */}
      <div className="mt-6 border-t border-overview-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Operação</h2>
          <Link href={`/clients/${client.id}/operation`} className="shrink-0 text-xs font-medium text-brand hover:underline">
            Ver operação completa →
          </Link>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-overview-text-muted">Sprint atual</p>
            <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{currentSprintLabel ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-overview-text-muted">Última otimização</p>
            <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{lastOptimizationLabel}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[11px] text-overview-text-muted">Saúde</p>
            {primaryReasonText ? (
              <p className="mt-0.5 text-sm font-medium" title={primaryReasonText}>
                {emphasizeDeviationText(primaryReasonText, primaryReasonTone)}
              </p>
            ) : (
              <p className="mt-0.5 text-sm font-medium text-overview-text-primary">Sem sinais de atenção</p>
            )}
          </div>
        </div>
      </div>

      {/* DEMANDAS — "o que precisa ser feito?" (seção 10 do pedido de
          correção): contagem + até 3 itens mais urgentes, nunca a List View
          inteira. MESMA fonte/regra de `/clients/[id]/demandas` e da área
          global (`origin='manual'`). */}
      <div className="mt-6 border-t border-overview-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Demandas</h2>
            <p className="mt-1 text-[13px] text-overview-text-secondary">
              {demandasOpenCount} em aberto
              {demandasOverdueCount > 0 && ` · ${demandasOverdueCount} atrasada${demandasOverdueCount !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Link href={`/clients/${client.id}/demandas`} className="shrink-0 text-xs font-medium text-brand hover:underline">
            Ver todas →
          </Link>
        </div>
        {demandasPreview.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {demandasPreview.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_PRIORITY_DOT_CLASS[item.priority]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-overview-text-primary">{item.title}</span>
                <span className="shrink-0 text-xs text-overview-text-muted">{formatDueDate(item.dueDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isAdmin && historicoOrcamento && (
        <MonthlyBudgetHistoryDrawer
          monthLabel={monthLabel}
          changes={selectedBudgetChanges.map((change) => ({
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
          closeHref={returnTo}
        />
      )}
    </WorkspaceContainer>
  );
}
