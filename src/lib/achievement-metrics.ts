import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DataSyncRunStatusDb, OperationalEventType as OperationalEventTypeValue, TrafficChannelDb } from "@/lib/supabase/database.types";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { AVAILABLE_TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { safeDivide, computeRoas } from "@/lib/performance";
import { resolveCostScopeComparability, type ChannelMetrics } from "@/lib/channel-metrics";
import { resolveClientMonthlyPlan, type ClientPlanChangeRow } from "@/lib/client-plan";
import { addDays, firstDayOfMonth, isLastDayOfMonth, lastDayOfMonth, listDatesInclusive, yearMonthOf } from "@/lib/achievement-dates";
import type { ClientDailyPoint } from "@/lib/achievement-sample";
import type { ClientAchievementContext, ClientMonthlyGoalInfo } from "@/lib/achievement-client-rules";

/**
 * Camada de I/O do motor de Conquistas — monta os contextos puros
 * (`ClientAchievementContext`/etc.) a partir do banco. Nenhuma decisão de
 * "isso é uma conquista?" mora aqui — só leitura e montagem de dado.
 * Sempre chamada com o client ADMIN (service role, mesmo padrão de
 * `stract-sync.ts`) — o motor roda num cron, nunca no contexto de um
 * usuário logado.
 *
 * V1 = só clientes com granularidade diária confiável
 * (`import_sources.enabled = true`, ver Auditoria seção 2/17) — cliente
 * só-manual (`performance_records`, sem coluna de data) nunca entra aqui.
 */

const HISTORY_LOOKBACK_DAYS = 730; // ~2 anos — baseline suficiente pra recordes sem carregar "todo o histórico" sem limite

export interface EligibleClient {
  id: string;
  name: string;
  performanceGoal: PerformanceGoal | null;
  fallbackTargetCostPerResult: number | null;
  primaryManagerId: string | null;
  /** `clients` não tem coluna `organization_id` própria — resolvida via
   * `primary_manager_id -> team_members.organization_id` (o mesmo caminho
   * que `complete_task_and_record_event`/`apply_monthly_budget_change` já
   * usam em SQL pra achar `v_org_id`). `null` quando o cliente não tem
   * gestor principal: sem isso não há como saber a organização de forma
   * confiável — o motor pula esse cliente (nunca adivinha), ver
   * `achievement-engine.ts`. */
  organizationId: string | null;
}

/** IDs de todas as organizações — usado pelo motor pra rodar as regras de
 * Agência/Pessoa por organização (na prática, hoje, sempre 1 — nenhum
 * outro lugar do produto lida com mais de uma). */
export async function listOrganizationIds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await supabase.from("organizations").select("id");
  return (data ?? []).map((r) => r.id);
}

/** Clientes elegíveis pra Conquistas de Cliente na V1: ativos, não
 * excluídos, com pelo menos uma integração automática ligada (a única
 * fonte com granularidade diária confiável, ver Auditoria seção 2). */
export async function listEligibleClientsForAchievements(supabase: SupabaseClient<Database>): Promise<EligibleClient[]> {
  const { data: activeSources } = await supabase.from("import_sources").select("client_id").eq("enabled", true);
  const eligibleIds = Array.from(new Set((activeSources ?? []).map((r) => r.client_id)));
  if (eligibleIds.length === 0) return [];

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, performance_goal, target_cost_per_result, primary_manager_id, status, deleted_at")
    .in("id", eligibleIds)
    .is("deleted_at", null)
    .eq("status", "ativo");

  const managerIds = Array.from(new Set((clients ?? []).map((c) => c.primary_manager_id).filter((id): id is string => id !== null)));
  const { data: managers } = managerIds.length > 0 ? await supabase.from("team_members").select("id, organization_id").in("id", managerIds) : { data: [] };
  const orgIdByManagerId = new Map((managers ?? []).map((m) => [m.id, m.organization_id]));

  return (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    performanceGoal: c.performance_goal,
    fallbackTargetCostPerResult: c.target_cost_per_result,
    primaryManagerId: c.primary_manager_id,
    organizationId: c.primary_manager_id ? (orgIdByManagerId.get(c.primary_manager_id) ?? null) : null,
  }));
}

export async function resolveClientActiveChannels(supabase: SupabaseClient<Database>, clientId: string): Promise<TrafficChannelDb[]> {
  const { data } = await supabase.from("import_sources").select("channel").eq("client_id", clientId).eq("enabled", true);
  return Array.from(new Set((data ?? []).map((r) => r.channel)));
}

export interface ClientSyncTrust {
  trusted: boolean;
  reason: "success" | "no_active_source" | "partial" | "failed" | "running" | "no_run_yet";
}

/** Determinação de aprovação nº3: `partial` bloqueia igual a `failed` —
 * `success`/`empty` liberam, qualquer outra coisa (inclusive nenhum run
 * ainda) trava. Um `data_sync_run` cobre a fonte inteira (o Import Service
 * relê o histórico completo a cada execução, nunca um dia isolado) — por
 * isso o veredito é por CLIENTE (o pior status entre as fontes ativas
 * dele), nunca por dia individual: "Meta entrou, Google não entrou" vira
 * `partial` numa das fontes e já invalida o consolidado inteiro daquele
 * ciclo. */
export async function resolveClientSyncTrust(supabase: SupabaseClient<Database>, clientId: string): Promise<ClientSyncTrust> {
  const { data: sources } = await supabase.from("import_sources").select("id").eq("client_id", clientId).eq("enabled", true);
  const importSourceIds = (sources ?? []).map((r) => r.id);
  if (importSourceIds.length === 0) return { trusted: false, reason: "no_active_source" };

  const { data: runs } = await supabase
    .from("data_sync_runs")
    .select("import_source_id, status, started_at")
    .in("import_source_id", importSourceIds)
    .order("started_at", { ascending: false });

  const latestStatusBySource = new Map<string, DataSyncRunStatusDb>();
  for (const run of runs ?? []) {
    if (!latestStatusBySource.has(run.import_source_id)) latestStatusBySource.set(run.import_source_id, run.status);
  }

  if (latestStatusBySource.size < importSourceIds.length) return { trusted: false, reason: "no_run_yet" };

  for (const status of latestStatusBySource.values()) {
    if (status === "running") return { trusted: false, reason: "running" };
    if (status === "partial") return { trusted: false, reason: "partial" };
    if (status === "failed") return { trusted: false, reason: "failed" };
  }

  return { trusted: true, reason: "success" };
}

/** Pontos diários consolidados (soma dos canais ATIVOS do cliente) —
 * `dataPresent` reflete só `daily_spend` (mesma convenção de
 * `buildDailyResultSeries`, `lib/daily-results.ts`): dia sem nenhuma linha
 * de investimento é desconhecido, nunca um `0` fabricado; dia com
 * investimento mas sem `daily_performance` é um `0` real de resultado. */
export async function fetchClientDailyPoints(
  supabase: SupabaseClient<Database>,
  clientId: string,
  activeChannels: TrafficChannelDb[],
  fromDate: string,
  toDate: string,
): Promise<ClientDailyPoint[]> {
  const activeSet = new Set(activeChannels);

  const [{ data: spendRows }, { data: perfRows }] = await Promise.all([
    supabase.from("daily_spend").select("date, channel, spend").eq("client_id", clientId).gte("date", fromDate).lte("date", toDate),
    supabase
      .from("daily_performance")
      .select("date, channel, result_count, revenue")
      .eq("client_id", clientId)
      .gte("date", fromDate)
      .lte("date", toDate),
  ]);

  const spendByDate = new Map<string, number>();
  const spendPresentDates = new Set<string>();
  for (const row of spendRows ?? []) {
    if (!activeSet.has(row.channel)) continue;
    spendPresentDates.add(row.date);
    spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + row.spend);
  }

  const resultByDate = new Map<string, number>();
  const revenueByDate = new Map<string, number>();
  const revenuePresentDates = new Set<string>();
  for (const row of perfRows ?? []) {
    if (!activeSet.has(row.channel)) continue;
    resultByDate.set(row.date, (resultByDate.get(row.date) ?? 0) + row.result_count);
    if (row.revenue !== null) {
      revenuePresentDates.add(row.date);
      revenueByDate.set(row.date, (revenueByDate.get(row.date) ?? 0) + row.revenue);
    }
  }

  return listDatesInclusive(fromDate, toDate).map((date) => ({
    date,
    dataPresent: spendPresentDates.has(date),
    spend: spendByDate.get(date) ?? 0,
    resultCount: resultByDate.get(date) ?? 0,
    revenue: revenuePresentDates.has(date) ? (revenueByDate.get(date) ?? 0) : null,
  }));
}

async function fetchMonthlyBudgetChangeRows(supabase: SupabaseClient<Database>, clientId: string, uptoYearMonth: string): Promise<ClientPlanChangeRow[]> {
  const { data } = await supabase
    .from("monthly_budget_changes")
    .select("channel, month, changed_at, new_amount, target_result_count")
    .eq("client_id", clientId)
    .lte("month", firstDayOfMonth(uptoYearMonth));

  return (data ?? []).map((r) => ({
    channel: r.channel as TrafficChannel,
    month: r.month,
    changedAt: r.changed_at,
    investment: r.new_amount,
    targetResultCount: r.target_result_count,
  }));
}

/** Realizado por canal de UM mês, direto de `daily_spend`/`daily_performance`
 * (nunca `resolveClientMonthlyActuals`/`performance_records` — essa fonte é
 * sprint-level e não é a que clientes Stract usam, ver Auditoria seção 2).
 * Mesmo formato (`ChannelMetrics`) que o lado Planejado, pra reaproveitar
 * `resolveCostScopeComparability` sem adaptação. */
async function fetchClientMonthActualByChannel(
  supabase: SupabaseClient<Database>,
  clientId: string,
  activeChannels: TrafficChannelDb[],
  yearMonth: string,
): Promise<Partial<Record<TrafficChannel, ChannelMetrics>>> {
  const from = firstDayOfMonth(yearMonth);
  const to = lastDayOfMonth(yearMonth);

  const [{ data: spendRows }, { data: perfRows }] = await Promise.all([
    supabase.from("daily_spend").select("channel, spend").eq("client_id", clientId).gte("date", from).lte("date", to),
    supabase.from("daily_performance").select("channel, result_count, revenue").eq("client_id", clientId).gte("date", from).lte("date", to),
  ]);

  const byChannel: Partial<Record<TrafficChannel, ChannelMetrics>> = {};
  for (const channel of activeChannels as TrafficChannel[]) {
    const spendForChannel = (spendRows ?? []).filter((r) => r.channel === channel);
    const perfForChannel = (perfRows ?? []).filter((r) => r.channel === channel);
    if (spendForChannel.length === 0 && perfForChannel.length === 0) continue;

    const investment = spendForChannel.length > 0 ? spendForChannel.reduce((s, r) => s + r.spend, 0) : null;
    const resultCount = perfForChannel.length > 0 ? perfForChannel.reduce((s, r) => s + r.result_count, 0) : null;
    const revenueRows = perfForChannel.filter((r) => r.revenue !== null);
    const revenue = revenueRows.length > 0 ? revenueRows.reduce((s, r) => s + (r.revenue ?? 0), 0) : null;

    byChannel[channel] = {
      investment,
      resultCount,
      revenue,
      cpa: safeDivide(investment, resultCount),
      roas: computeRoas(revenue, investment),
    };
  }

  return byChannel;
}

/** Meta de CPA/resultado consolidada de UM mês + comparabilidade de escopo
 * (`resolveCostScopeComparability`, `channel-metrics.ts` — reaproveitado,
 * nunca reimplementado). Fallback pra `clients.target_cost_per_result`
 * (meta global, sempre comparável) quando nenhum canal tem plano — mesma
 * regra já usada pelo Motor de Saúde. */
export async function resolveClientMonthlyGoalInfo(
  supabase: SupabaseClient<Database>,
  clientId: string,
  activeChannels: TrafficChannelDb[],
  yearMonth: string,
  fallbackTargetCostPerResult: number | null,
): Promise<ClientMonthlyGoalInfo> {
  const channels = (activeChannels.length > 0 ? activeChannels : AVAILABLE_TRAFFIC_CHANNELS) as TrafficChannel[];
  const changes = await fetchMonthlyBudgetChangeRows(supabase, clientId, yearMonth);
  const plan = resolveClientMonthlyPlan({ channels, changes, selectedMonth: firstDayOfMonth(yearMonth) });

  const consolidatedTargetCameFromChannelPlan = plan.consolidated.cpa !== null;
  const targetCostPerResult = plan.consolidated.cpa ?? fallbackTargetCostPerResult;

  if (!consolidatedTargetCameFromChannelPlan) {
    // Meta global (sem plano por canal nenhum) — sempre comparável, mesma
    // regra de `resolveCostScopeComparability`.
    return { targetCostPerResult, targetResultCount: plan.consolidated.resultCount, scopeComparable: true };
  }

  const actualByChannel = await fetchClientMonthActualByChannel(supabase, clientId, activeChannels, yearMonth);
  const scopeComparable = resolveCostScopeComparability(true, plan.byChannel, actualByChannel);

  return { targetCostPerResult, targetResultCount: plan.consolidated.resultCount, scopeComparable };
}

export interface ClientAchievementBundle {
  context: ClientAchievementContext;
  syncTrust: ClientSyncTrust;
}

/** Monta o `ClientAchievementContext` completo de UM cliente pra UM dia
 * fechado — a única função que `achievement-engine.ts` chama por cliente.
 * `null` quando o cliente não passa no gate de frescor (determinação de
 * aprovação nº3): nenhuma regra roda sobre dado não confiável. */
export async function buildClientAchievementContext(
  supabase: SupabaseClient<Database>,
  client: EligibleClient,
  yesterday: string,
): Promise<ClientAchievementBundle> {
  const syncTrust = await resolveClientSyncTrust(supabase, client.id);

  const activeChannels = await resolveClientActiveChannels(supabase, client.id);
  const fromDate = addDays(yesterday, -(HISTORY_LOOKBACK_DAYS - 1));
  const dailyPoints = syncTrust.trusted ? await fetchClientDailyPoints(supabase, client.id, activeChannels, fromDate, yesterday) : [];

  const currentMonth = yearMonthOf(yesterday);
  const previousMonth = yearMonthOf(addDays(firstDayOfMonth(yesterday), -1));
  const goalByMonth = new Map<string, ClientMonthlyGoalInfo>();
  if (syncTrust.trusted) {
    const [currentGoal, previousGoal] = await Promise.all([
      resolveClientMonthlyGoalInfo(supabase, client.id, activeChannels, currentMonth, client.fallbackTargetCostPerResult),
      resolveClientMonthlyGoalInfo(supabase, client.id, activeChannels, previousMonth, client.fallbackTargetCostPerResult),
    ]);
    goalByMonth.set(currentMonth, currentGoal);
    goalByMonth.set(previousMonth, previousGoal);
  }

  return {
    syncTrust,
    context: {
      clientId: client.id,
      clientName: client.name,
      yesterday,
      performanceGoal: client.performanceGoal,
      tracksRevenue: client.performanceGoal === "sales",
      dailyPoints,
      goalByMonth,
    },
  };
}

// ---------------------------------------------------------------------------
// Agência
// ---------------------------------------------------------------------------

export interface AgencyMetricsBundle {
  organizationId: string;
  evaluatedOnDate: string;
  activeClientsCount: number;
  /** `null` na V1 de propósito: a "carteira saudável" precisaria rodar o
   * Motor de Saúde inteiro (sprints/tarefas/orçamento/cadência de revisão)
   * por cliente — uma segunda dependência pesada, fora do escopo barato e
   * determinístico deste cron. `ruleAgencyHealthyWalletMilestone` continua
   * definida (pronta pra uma próxima etapa), só não é chamada pelo motor
   * ainda — ver relatório final. */
  healthyWalletFraction: null;
  noCriticalWallet: false;
  totalReviewsCount: number;
  totalOptimizationsCount: number;
  totalReportsSentCount: number;
  closedMonthTotalSpend: number | null;
}

async function countOperationalEvents(supabase: SupabaseClient<Database>, organizationId: string, eventType: OperationalEventTypeValue): Promise<number> {
  const { count } = await supabase
    .from("operational_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("event_type", eventType);
  return count ?? 0;
}

/** `clients` não tem coluna `organization_id` (nenhum consumidor da base
 * filtra por ela — RLS/single-tenant já resolve isso pra qualquer leitura
 * via client normal; aqui, rodando com client admin, o filtro equivalente
 * é simplesmente "todos os clientes ativos", mesmo padrão de todo o resto
 * do produto). */
async function fetchClosedMonthTotalSpend(supabase: SupabaseClient<Database>, yesterday: string): Promise<number | null> {
  if (!isLastDayOfMonth(yesterday)) return null;

  const { data: clients } = await supabase.from("clients").select("id").is("deleted_at", null).eq("status", "ativo");
  const clientIds = (clients ?? []).map((c) => c.id);
  if (clientIds.length === 0) return null;

  const { data: spendRows } = await supabase
    .from("daily_spend")
    .select("spend")
    .in("client_id", clientIds)
    .gte("date", firstDayOfMonth(yesterday))
    .lte("date", yesterday);

  if (!spendRows || spendRows.length === 0) return null;
  return spendRows.reduce((sum, r) => sum + r.spend, 0);
}

export async function fetchAgencyMetrics(supabase: SupabaseClient<Database>, organizationId: string, yesterday: string): Promise<AgencyMetricsBundle> {
  const [{ count: activeClientsCount }, totalReviewsCount, totalOptimizationsCount, totalReportsSentCount, closedMonthTotalSpend] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "ativo"),
    countOperationalEvents(supabase, organizationId, "account_review_recorded"),
    countOperationalEvents(supabase, organizationId, "account_optimization_recorded"),
    countOperationalEvents(supabase, organizationId, "client_report_sent"),
    fetchClosedMonthTotalSpend(supabase, yesterday),
  ]);

  return {
    organizationId,
    evaluatedOnDate: yesterday,
    activeClientsCount: activeClientsCount ?? 0,
    healthyWalletFraction: null,
    noCriticalWallet: false,
    totalReviewsCount,
    totalOptimizationsCount,
    totalReportsSentCount,
    closedMonthTotalSpend,
  };
}

// ---------------------------------------------------------------------------
// Pessoa
// ---------------------------------------------------------------------------

export interface EligibleTeamMember {
  id: string;
  name: string;
  createdAt: string;
}

export async function listEligibleTeamMembersForAchievements(supabase: SupabaseClient<Database>, organizationId: string): Promise<EligibleTeamMember[]> {
  const { data } = await supabase
    .from("team_members")
    .select("id, name, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "ativo");
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export interface PersonMetricsBundle {
  teamMemberId: string;
  teamMemberName: string;
  evaluatedOnDate: string;
  reviewsCount: number;
  optimizationsCount: number;
  distinctClientsServedCount: number;
  reportsSentCount: number;
  tenureMonths: number;
  firstMeetingCompleted: boolean;
  firstCreativeDeliveryCompleted: boolean;
}

async function countOperationalEventsByActor(supabase: SupabaseClient<Database>, teamMemberId: string, eventType: OperationalEventTypeValue): Promise<number> {
  const { count } = await supabase
    .from("operational_events")
    .select("id", { count: "exact", head: true })
    .eq("actor_team_member_id", teamMemberId)
    .eq("event_type", eventType);
  return count ?? 0;
}

async function hasAnyOperationalEventByActor(supabase: SupabaseClient<Database>, teamMemberId: string, eventType: OperationalEventTypeValue): Promise<boolean> {
  const { data } = await supabase
    .from("operational_events")
    .select("id")
    .eq("actor_team_member_id", teamMemberId)
    .eq("event_type", eventType)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

function tenureMonthsSince(createdAt: string, today: string): number {
  const created = new Date(createdAt);
  const now = new Date(`${today}T00:00:00Z`);
  const months = (now.getUTCFullYear() - created.getUTCFullYear()) * 12 + (now.getUTCMonth() - created.getUTCMonth());
  return Math.max(0, months);
}

export async function fetchPersonMetrics(supabase: SupabaseClient<Database>, member: EligibleTeamMember, yesterday: string): Promise<PersonMetricsBundle> {
  const [reviewsCount, optimizationsCount, reportsSentCount, firstMeetingCompleted, firstCreativeDeliveryCompleted, distinctClientsServedCount] =
    await Promise.all([
      countOperationalEventsByActor(supabase, member.id, "account_review_recorded"),
      countOperationalEventsByActor(supabase, member.id, "account_optimization_recorded"),
      countOperationalEventsByActor(supabase, member.id, "client_report_sent"),
      hasAnyOperationalEventByActor(supabase, member.id, "meeting_completed"),
      hasAnyOperationalEventByActor(supabase, member.id, "creative_delivery_completed"),
      countDistinctClientsForActorReviews(supabase, member.id),
    ]);

  return {
    teamMemberId: member.id,
    teamMemberName: member.name,
    evaluatedOnDate: yesterday,
    reviewsCount,
    optimizationsCount,
    distinctClientsServedCount,
    reportsSentCount,
    tenureMonths: tenureMonthsSince(member.createdAt, yesterday),
    firstMeetingCompleted,
    firstCreativeDeliveryCompleted,
  };
}

async function countDistinctClientsForActorReviews(supabase: SupabaseClient<Database>, teamMemberId: string): Promise<number> {
  const { data } = await supabase
    .from("operational_events")
    .select("client_id")
    .eq("actor_team_member_id", teamMemberId)
    .eq("event_type", "account_review_recorded")
    .not("client_id", "is", null);
  return new Set((data ?? []).map((r) => r.client_id)).size;
}
