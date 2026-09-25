import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  assertSingleCurrentSprint,
  currentMonthRange,
  monthRangeFromParam,
  shiftMonthParam,
  sumActualSpendForMonth,
  sumPlannedForMonth,
} from "@/lib/sprint-financials";
import { classifySpendStatus } from "@/lib/spend-status";
import { resolveBudgetEffectiveDate, computeMonthlyExpectedToDateByCalendar, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, primaryGoalResultTypeFilter } from "@/lib/client-plan";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { ensureClosedSprintSnapshots } from "@/lib/sprint-snapshot";
import { sumChannelEffectiveSpend, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
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
import { ConversionRateCard } from "../conversion-rate-card";
import { listClientGoals, fetchGoalDisplaySummaries } from "@/lib/client-goals";
import { fetchSecondaryGoalsPerformance } from "@/lib/secondary-goal-performance";
import { computePerformanceSummary, aggregatePerformanceResults, computeConversionRate } from "@/lib/performance";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { AVAILABLE_TRAFFIC_CHANNELS, resolveClientChannelScopeOptions, resolveSelectedChannelScope, type TrafficChannel } from "@/lib/traffic-channels";
import { VisaoGeralChannelSwitch, type VisaoGeralMetricsChannel } from "../visao-geral-channel-switch";
import { countOpenDemandas } from "@/lib/pendencias";
import { loadPendenciasRawData } from "@/app/demandas/pendencias-data";
import { formatDueDate } from "../task-row";
import { TASK_PRIORITY_DOT_CLASS } from "../task-labels";
import { fetchClientFunnels, listCampaignsForFunnelClassification } from "@/lib/client-funnels-data";
import { FunnelsSection } from "../funnels-section";
import { Section } from "../section";
import { loadOperationSectionData } from "../operation-section-data";
import { OperationSection } from "../operation-section";
import { generateClientUpdateAction } from "../client-update-actions";
import { SubmitButton } from "@/app/submit-button";
import { WorkspaceContainer } from "../workspace-container";
import { IconButton } from "@/components/workspace/button";

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * `/clients/[id]` — PAINEL PRINCIPAL do cliente (Etapa "Correção de
 * Direção do Workspace" — sucede e corrige a Etapa "Correção de UX do
 * Workspace" anterior). A pergunta que esta página responde: "como está
 * esse cliente e o que preciso fazer, sem sair daqui?".
 *
 * A rodada anterior tinha reduzido Performance/Operação/Demandas a
 * resumos, com links de aprofundamento como única forma de trabalhar o
 * cliente de fato. Validação de uso real mostrou que isso fragmentou a
 * experiência de novo —
 * pedido explícito: "página completa do cliente como era antes + novo
 * header/navegador + nova largura generosa". Esta é essa restauração.
 *
 * Auditoria feita via `git show 402e0af:src/app/clients/[id]/page.tsx`
 * (commit imediatamente anterior à Fase 1, arquivo monolítico de 1944
 * linhas) — comparação completa entregue à parte no relatório desta
 * rodada. Restaura a COMPLETUDE daquela página (KPIs/Ritmo/Objetivos
 * secundários/Conversão/Funis/Tarefas/Sprints/Histórico/Revisões/drawers)
 * SEM voltar ao arquivo único: o corpo de Operação (Tarefas `origin=
 * 'template'`/Sprints/Histórico/revisões/drawers) foi extraído pra
 * `../operation-section-data.ts`/`../operation-section.tsx` — MESMO
 * módulo usado por `/operation` (rota de aprofundamento, nunca deletada).
 * Funis reaproveita `fetchClientFunnels`/`listCampaignsForFunnelClassification`/
 * `FunnelsSection`, os MESMOS de `/relatorio`. Demandas reaproveita
 * `loadPendenciasRawData`/`countOpenDemandas`, os MESMOS de
 * `/clients/[id]/demandas` — nunca uma terceira implementação de nenhuma
 * regra.
 *
 * Correção que NÃO volta ao bug antigo: a página anterior a 402e0af
 * buscava `tasks` inteira (sem filtro de `origin`), misturando Demandas
 * (`manual`) com rotina operacional (`template`) no mesmo `MonthTasksPanel`
 * — o bug real que a Fase 1 corrigiu. Aqui, Operação (via
 * `loadOperationSectionData`) filtra SEMPRE `origin='template'`; Demandas
 * (via `loadPendenciasRawData`) filtra SEMPRE `origin='manual'` — cada uma
 * com sua própria seção, nunca mais misturadas.
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
    error,
    synced,
    saved,
    month: monthQueryParam,
    historicoOrcamento,
    metricsChannel: metricsChannelParam,
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
    .select(
      "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(name), performance_goal, target_cost_per_result, avatar_url, media_channels, dashboard_url, balance_url, monthly_closing_sheet_url",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[ClientPage] falha ao buscar cliente ${id}:`, clientQueryError);
  if (!client) notFound();

  const canOperate = client.status === "ativo";
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
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const prevMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, 1)}`;
  const returnTo = `/clients/${id}${monthQuery}`;
  const metricsChannelBaseHref = `/clients/${id}${monthQuery}`;
  const taskHrefPrefix = `/clients/${id}${monthQuery ? `${monthQuery}&` : "?"}task=`;

  // Funis e a seção Operação (sprint/tarefas `origin='template'`/histórico/
  // revisões — `../operation-section-data.ts`) são independentes do bloco
  // de Performance abaixo — disparados AGORA, em paralelo com o
  // Promise.all de Performance mais adiante (seção 18 do pedido: nenhuma
  // cascata desnecessária, tudo que não depende de outra coisa corre
  // junto). `await`s ficam só onde o valor é de fato consumido.
  const funnelsPromise = Promise.all([fetchClientFunnels(supabase, id), listCampaignsForFunnelClassification(supabase, id, todayStr)]);
  const operationSectionDataPromise = loadOperationSectionData(supabase, {
    id,
    firstDay,
    lastDay,
    today,
    todayStr,
    isCurrentMonth,
    performanceGoal: client.performance_goal,
    targetCostPerResultFallback: client.target_cost_per_result,
    returnTo,
    openTaskId,
    openReviewDetailId,
    openRecurringTaskId,
    openRecurringTaskSprintId,
    historyPageParam,
  });

  const [sprintsRaw, dailySpend, plannedAllocations, budgetChanges, performanceTargetHistory, channelSpendRows, planningEndDate] = await Promise.all([
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
    requireQuery(
      supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").eq("client_id", id),
      "sprint_channel_spend",
    ),
    getClientMonthHorizon(supabase, id, firstDay),
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

  // Taxa de conversão (vendas ÷ carrinhos) — mesma leitura de sempre sobre
  // `performanceRecords` já buscado acima, nenhuma query nova.
  const cartsResultCount = performanceRecords
    .filter((r) => (r.resultType as string) === "carts")
    .reduce((sum, r) => sum + r.resultCount, 0);
  const salesResultCount = performanceRecords.filter((r) => r.resultType === "sales").reduce((sum, r) => sum + r.resultCount, 0);
  const conversionRate = computeConversionRate(salesResultCount, cartsResultCount);

  // Objetivos secundários — mesmo bloco de sempre, `await` sequencial
  // isolado (nenhuma dependência do Promise.all das queries do mês acima).
  const allClientGoals = await listClientGoals(supabase, id);
  const secondaryClientGoals = allClientGoals.filter((g) => !g.isPrimary);
  const secondaryGoalTargets = await fetchGoalDisplaySummaries(supabase, id, secondaryClientGoals, firstDay);
  const secondaryGoalsPerformance = await fetchSecondaryGoalsPerformance(
    supabase,
    id,
    secondaryClientGoals,
    { firstDay, lastDay },
    new Map(Array.from(secondaryGoalTargets.entries()).map(([goal, summary]) => [goal, summary.targetResultCount])),
  );

  const monthPlannedAllocationRows = (plannedAllocations ?? []).map((a) => ({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount }));
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

  const monthPlanned = clientPlan.consolidated.investment ?? sumPlannedForMonth(monthPlannedAllocationRows, { firstDay, lastDay });
  const monthActual = sumActualSpendForMonth(sprints ?? [], { firstDay, lastDay }, dailySpend ?? []);

  await ensureClosedSprintSnapshots(supabase, {
    clientId: id,
    today,
    monthRange: planningHorizon,
    sprints: sprints ?? [],
    dailySpend: dailySpend ?? [],
    budgetChanges: (budgetChanges ?? []).map((c) => ({ channel: c.channel as TrafficChannel, newAmount: c.new_amount, changedAt: c.changed_at })),
    plannedAllocations: monthPlannedAllocationRows,
    currentMonthlyBudget: monthPlanned,
  });

  const monthExpectedToDate = computeMonthlyExpectedToDateByCalendar(monthPlanned, planningHorizon, todayStr).expectedToDate;
  const monthStatus = classifySpendStatus(monthActual, monthExpectedToDate, monthPlanned);

  const visaoGeralMonthActual =
    metricsChannel === "consolidated"
      ? monthActual
      : sumChannelEffectiveSpend(
          sprints.map((s) => ({ sprintId: s.id, start_date: s.start_date, end_date: s.end_date })),
          metricsChannel,
          dailySpendChannelRows,
          channelSpendOverrideRows,
        );
  const visaoGeralPlanned = metricsChannel === "consolidated" ? monthPlanned : (clientPlan.byChannel[metricsChannel]?.investment ?? 0);
  const visaoGeralExpectedToDate =
    metricsChannel === "consolidated"
      ? monthExpectedToDate
      : computeMonthlyExpectedToDateByCalendar(visaoGeralPlanned, planningHorizon, todayStr).expectedToDate;
  const visaoGeralStatus =
    metricsChannel === "consolidated" ? monthStatus : classifySpendStatus(visaoGeralMonthActual, visaoGeralExpectedToDate, visaoGeralPlanned);

  const performanceGoal = client.performance_goal;
  const scopedTargetCostPerResult = resolveTargetCostPerResult({ channel: metricsChannel, plan: clientPlan, legacyFallback: client.target_cost_per_result });
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
    metricsChannel === "consolidated" ? clientPlan.consolidated.resultCount : (clientPlan.byChannel[metricsChannel]?.resultCount ?? null);
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
  const lastBudgetChange = budgetChanges[0] ?? null;
  const lastChange = lastBudgetChange
    ? {
        lastEffectiveDate: lastBudgetChange.effective_date,
        lastPreviousAmount: lastBudgetChange.previous_amount,
        lastNewAmount: lastBudgetChange.new_amount,
        changeCountThisMonth: budgetChanges.length,
      }
    : null;

  // Funis — seção completa (não mais preview), MESMOS loaders/componente
  // de `/relatorio` (`fetchClientFunnels`/`listCampaignsForFunnelClassification`/
  // `FunnelsSection`), independente do mês em exibição (cadastro do
  // cliente, não um recorte de data).
  const [clientFunnels, funnelClassificationCampaigns] = await funnelsPromise;

  // Operação — seção completa (não mais resumo): sprint/tarefas
  // `origin='template'`/histórico/revisões, via `loadOperationSectionData`
  // (MESMO loader que `/operation` usa) — disparado em paralelo acima,
  // resolvido aqui.
  const operationSectionData = await operationSectionDataPromise;

  // Demandas — seção completa (todas as abertas, não mais só 3), MESMA
  // fonte/regra de `/clients/[id]/demandas` e da área global
  // (`loadPendenciasRawData`/`countOpenDemandas`, `origin='manual'`).
  const { items: demandaItems } = await loadPendenciasRawData(supabase, id);
  const { openCount: demandasOpenCount, overdueCount: demandasOverdueCount } = countOpenDemandas(
    demandaItems.map((item) => ({ origin: "manual" as const, client_id: id, status: item.rawStatus, due_date: item.dueDate })),
    () => true,
    today,
  );
  const demandasOpenItems = demandaItems
    .filter((item) => item.status !== "feito" && item.status !== "nao_realizado")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

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

      {/* CONTEXTO — mês/canal/planejamento em exibição, compartilhado pelos
          blocos de Performance abaixo. Links externos (Dashboard/Saldo/
          Fechamento) restaurados da página antiga — viviam na barra de
          navegação de então, sem lugar equivalente após a Fase 1. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-b border-overview-border pb-2 text-sm">
        <div className="flex items-center gap-0.5">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[6rem] px-1 text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <VisaoGeralChannelSwitch baseHref={metricsChannelBaseHref} active={metricsChannel} options={metricsChannelOptions} />
        {isAdmin && !isClosedMonth && effectiveDate && (
          <ChannelPlanEditor
            clientId={client.id}
            monthParam={monthParam}
            monthLabel={monthLabel}
            monthRange={{ firstDay, lastDay }}
            currentPlanningEndDate={planningEndDate}
            channels={AVAILABLE_TRAFFIC_CHANNELS}
            byChannel={clientPlan.byChannel}
            performanceGoal={performanceGoal}
          />
        )}
        {externalLinks.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            {externalLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-overview-text-secondary hover:underline">
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* PERFORMANCE — "o que está acontecendo?": KPIs + ritmo do mês +
          metas secundárias + conversão + Funis, na mesma ordem/composição
          da página antiga (auditoria via git). CTA pro Relatório completo
          é aprofundamento SECUNDÁRIO — nunca substitui este conteúdo. */}
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

      <ConversionRateCard conversionRate={conversionRate} />

      <Section title="Funis">
        <FunnelsSection clientId={id} returnTo={returnTo} funnels={clientFunnels} campaigns={funnelClassificationCampaigns} isAdmin={isAdmin} />
      </Section>

      <div className="mt-2 flex justify-end">
        <Link href={`/clients/${client.id}/relatorio`} className="text-xs font-medium text-brand hover:underline">
          Ver relatório completo →
        </Link>
      </div>

      {/* OPERAÇÃO — "estamos executando corretamente?": sprint/tarefas
          (`origin='template'`)/histórico/revisões por completo, via
          `OperationSection` (MESMO componente/loader de `/operation`).
          "Saúde"/motivo do CPA (Motor de Diagnóstico Único, já carregado
          acima) continua como sinal rápido — não duplicado em nenhum
          outro lugar da página. */}
      <div className="mt-6 border-t border-overview-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Operação</h2>
          <div className="flex items-center gap-3">
            <Link href={withParam(returnTo, "review=new")} scroll={false} className="text-xs font-medium text-brand hover:underline">
              + Registrar revisão
            </Link>
            <Link href={`/clients/${client.id}/operation`} className="shrink-0 text-xs font-medium text-overview-text-secondary hover:underline">
              Ver operação completa →
            </Link>
          </div>
        </div>
        {primaryReasonText && (
          <p className="mt-1 text-xs text-overview-text-secondary" title={primaryReasonText}>
            {emphasizeDeviationText(primaryReasonText, primaryReasonTone)}
          </p>
        )}

        {(taskError || reviewError || recurringTaskError || clientUpdateError) && (
          <div className="mt-2 flex flex-col gap-2">
            {[taskError, reviewError, recurringTaskError, clientUpdateError].filter(Boolean).map((message, index) => (
              <p key={index} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {message}
              </p>
            ))}
          </div>
        )}

        {reviewSaved && !operationSectionData.clientUpdatesByReviewId.has(reviewSaved) && (
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

        <OperationSection
          data={operationSectionData}
          clientId={id}
          clientName={client.name}
          primaryManagerName={client.primary_manager?.name ?? null}
          monthLabel={monthLabel}
          isAdmin={isAdmin}
          canOperate={canOperate}
          returnTo={returnTo}
          taskHrefPrefix={taskHrefPrefix}
          openReview={openReview}
          reviewError={reviewError}
        />
      </div>

      {/* DEMANDAS — "o que precisa ser feito?": todas as demandas abertas
          deste cliente (nunca preview de 3), MESMA fonte/regra de
          `/clients/[id]/demandas` e da área global (`origin='manual'`).
          "Ver todas →" continua útil pra edição em lote/filtros/histórico
          de concluídas — nunca a única forma de ver o que está aberto. */}
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
        {demandasOpenItems.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {demandasOpenItems.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_PRIORITY_DOT_CLASS[item.priority]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-overview-text-primary">{item.title}</span>
                {item.assignee && <span className="shrink-0 text-xs text-overview-text-muted">{item.assignee.name}</span>}
                <span className="shrink-0 text-xs text-overview-text-muted">{formatDueDate(item.dueDate)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-overview-text-secondary">Nenhuma demanda aberta.</p>
        )}
      </div>

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
          closeHref={returnTo}
        />
      )}
    </WorkspaceContainer>
  );
}
