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
import { IconButton } from "@/components/workspace/button";

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * `/clients/[id]` — Visão Geral do cliente (Etapa "MITZA — Reformulação
 * Estrutural", seção 8 do pedido): "Como está esse cliente?", executiva e
 * enxuta — investimento, meta, resultados principais, ritmo do mês, saúde
 * operacional, Demandas abertas (contagem + link, nunca a lista inteira).
 * Nunca duplica o Relatório completo (Performance), a lista de tarefas
 * operacionais (Operação) nem a List View de Demandas — cada uma tem sua
 * própria aba agora.
 *
 * Extraído do antigo `[id]/page.tsx` (1944 linhas, quase tudo empilhado
 * numa "Visão geral" só) — Funis/Objetivos secundários/Taxa de conversão
 * foram pra Performance; Tarefas/Sprints/Revisões/Histórico foram pra
 * Operação; header/seletor de cliente/abas agora vivem no `layout.tsx`
 * compartilhado. Nenhum cálculo mudou, só passou a morar na aba certa.
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
  }>;
}) {
  const { id } = await params;
  const { error, synced, saved, month: monthQueryParam, historicoOrcamento, metricsChannel: metricsChannelParam } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select(
      "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(name), performance_goal, target_cost_per_result, avatar_url, media_channels",
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
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const prevMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}?month=${shiftMonthParam({ firstDay }, 1)}`;
  const returnTo = `/clients/${id}${monthQuery}`;
  const metricsChannelBaseHref = `/clients/${id}${monthQuery}`;

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

  // Demandas abertas (seção 8 do pedido: "quantidade de Demandas abertas",
  // nunca a lista inteira aqui) — MESMA regra/função de `/demandas` e da
  // Home (`countOpenDemandas`, `lib/pendencias.ts`), nunca uma terceira
  // implementação. Query mínima e própria (só os 4 campos que a função
  // precisa) — não reaproveita `loadPendenciasRawData` (que traria joins de
  // cliente/responsável desnecessários aqui, só pra um número).
  const demandaTasks = await requireQuery(
    supabase.from("tasks").select("origin, client_id, status, due_date").eq("client_id", id).eq("origin", "manual"),
    "tasks:visao-geral-demandas-count",
  );
  const { openCount: demandasOpenCount, overdueCount: demandasOverdueCount } = countOpenDemandas(demandaTasks ?? [], () => true, todayUTC());

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

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      <ScrollRestoreOnMount />
      <ClientWorkspaceContext name={client.name} />

      {primaryReasonText && (
        <p className="mt-1 text-xs text-overview-text-secondary" title={primaryReasonText}>
          {emphasizeDeviationText(primaryReasonText, primaryReasonTone)}
        </p>
      )}

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
      </div>

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

      {/* Demandas abertas — resumo, nunca a lista inteira (seção 8 do
          pedido). Análise aprofundada → Performance; rotina/processo →
          Operação; trabalho específico → aqui é só a contagem + link. */}
      <div className="mt-6 border-t border-overview-border pt-4">
        <Link href={`/clients/${client.id}/demandas`} className="flex items-center justify-between gap-3 hover:opacity-80">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Demandas</h2>
            <p className="mt-1 text-[13px] text-overview-text-secondary">
              {demandasOpenCount} em aberto
              {demandasOverdueCount > 0 && ` · ${demandasOverdueCount} atrasada${demandasOverdueCount !== 1 ? "s" : ""}`}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-brand">Ver tudo →</span>
        </Link>
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
    </div>
  );
}
