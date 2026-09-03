import { Inter } from "next/font/google";
import { getCurrentProfile } from "@/lib/auth";
import { perfNow, perfLog } from "@/lib/perf-log";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import {
  currentMonthRange,
  findSprintForDate,
  isDateWithinPeriod,
  monthRangeFromParam,
  shiftMonthParam,
} from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { getMonthTemporalStatus, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { getClientMonthHorizons } from "@/lib/client-month-horizons";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { computeFinancialSummary, computeAgencyPeriodTotals, computeAgencyResultsByChannel } from "@/lib/agency-metrics";
import { computeHealthResultsSummary } from "@/lib/agency-health-aggregation";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { isReviewOverdue } from "@/lib/account-health-engine";
import { type OverviewPriorityFilter } from "./overview-client-view";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";
import { resolveOperationPriorityGroup, type OperationPriorityGroup } from "@/lib/operation-triage";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeOperationIndicators } from "@/lib/operation-indicators";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { AgencyFilters, type AgencyClientOption } from "./agency-filters";
import { OperationMetric, COMPARISON_TONE_TEXT_CLASSES } from "./operation-metric";
import { PrimaryInvestmentMetric } from "./investment-metric";
import { PLATFORM_LABEL } from "./client-objective-table";
import { getCompletedReminders, getOpenReminders, getReminderById } from "@/lib/reminders-data";
import { computeReminderCounts, filterReminders, sortReminders, type ReminderFilter } from "@/lib/reminders";
import { RemindersPanel } from "./reminders-panel";
import { RemindersCompletedDrawer } from "./reminders-completed-drawer";
import { ReminderFormDrawer } from "./reminder-form-drawer";
import { EmptyState } from "@/components/workspace/empty-state";
import { Button, IconButton } from "@/components/workspace/button";
import { ProgressBar } from "@/components/workspace/progress-bar";
import { SectionHeader } from "@/components/workspace/section-header";
import { SandRail } from "@/components/workspace/sand-rail";
import type { StatusTone } from "@/components/workspace/status-dot";
import type { TrafficChannelDb } from "@/lib/supabase/database.types";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { resolveClientMonthlyPlan, filterRowsToPrimaryGoal, type ClientPlanChangeRow } from "@/lib/client-plan";
import type { SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { previousEquivalentPeriod } from "@/lib/period-comparison";
import { buildPercentChangeComparison, type AnalyticsKpiComparison } from "@/lib/analytics";

/**
 * Etapa 47: Inter carregada e aplicada SÓ na Visão Geral (className no
 * wrapper raiz da página, não em layout.tsx) — nenhuma outra tela herda
 * essa fonte. O `body` global continua com o font-family de sempre.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-overview" });

type ManagerFilter = "all" | "me" | string;
/** "fora_do_ritmo" é só um atalho de drill-down (abaixo + acima combinados)
 * pro indicador "Contas fora do ritmo" — não aparece como opção no popover
 * de Filtros (que continua com as opções reais), só via link direto,
 * mesmo padrão já usado por `sprintBucket`/`sync`/`meta`. */
type RitmoFilter = "todos" | SpendStatus | "fora_do_ritmo";
/** "Tipo de resultado" (barra de filtros redesenhada) — filtra pelo
 * objetivo de performance estruturado do cliente (`lib/performance-goals.ts`),
 * nunca por `main_objective` (campo descritivo, conceito diferente). */
type ResultTypeFilter = "todos" | PerformanceGoal;
/** Filtro de plataforma (Etapa 3 — MVP plataformas, + TikTok Ads na barra
 * redesenhada): "consolidado" é o estado inicial e o único em que ritmo
 * financeiro/planejado/prioridades fazem sentido (não existe orçamento
 * configurado por canal ainda — só investimento REALIZADO, resultados e
 * CPL/CPA têm uma fonte por canal). `clientUsesChannel`/`monthActualByChannel`
 * já são genéricos sobre `TrafficChannel` (ver `client-channel-breakdown.ts`),
 * por isso adicionar um canal aqui não exige nenhuma mudança na agregação.
 */
type PlatformFilter = "consolidado" | "meta" | "google" | "tiktok";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    manager?: string;
    client?: string;
    diagnostico?: string;
    resultType?: string;
    ritmo?: string;
    sprintBucket?: string;
    sync?: string;
    meta?: string;
    platform?: string;
    pendenciaFiltro?: string;
    pendenciaModal?: string;
    pendenciasConcluidas?: string;
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

  const today = todayUTC();
  const todayStr = todayDateString();
  const monthRange = monthRangeFromParam(params.month, today);
  const currentRange = currentMonthRange(today);

  // Busca sprints/gastos numa janela que cobre o mês selecionado E o mês
  // corrente (union) — assim a sprint atual (de hoje) é sempre encontrada,
  // mesmo quando o usuário está navegando um mês diferente do atual.
  const rangeStart = monthRange.firstDay < currentRange.firstDay ? monthRange.firstDay : currentRange.firstDay;
  const rangeEnd = monthRange.lastDay > currentRange.lastDay ? monthRange.lastDay : currentRange.lastDay;

  const managerFilter: ManagerFilter = params.manager ?? (isAdmin ? "all" : "me");
  const clientParam = params.client;
  const diagnosticFilter = (params.diagnostico ?? "todos") as OverviewPriorityFilter | "todos";
  const resultTypeFilter = (params.resultType ?? "todos") as ResultTypeFilter;
  const ritmoFilter = (params.ritmo ?? "todos") as RitmoFilter;
  const sprintBucketFilter = params.sprintBucket as SprintFilterBucket | undefined;
  const platformFilter = (params.platform ?? "consolidado") as PlatformFilter;
  const pendenciaFiltroFilter = (params.pendenciaFiltro ?? "todas") as ReminderFilter;
  const syncFilter = params.sync;
  const metaFilter = params.meta;

  const supabase = await createSupabaseClient();

  // Etapa "Indicadores da operação": janela do mês selecionado em
  // timestamptz — mesma conversão já usada em account_reviews na página do
  // cliente (`${firstDay}T00:00:00Z` / até o fim do último dia).
  const indicatorsMonthStart = `${monthRange.firstDay}T00:00:00Z`;
  const indicatorsMonthEnd = `${monthRange.lastDay}T23:59:59.999Z`;

  const __perfBlock1Start = perfNow();
  // Etapa "Consolidação da Arquitetura — Fase B": `clientOperationalStates`
  // roda em paralelo com o bloco 1, seu próprio pipeline independente
  // (`lib/client-operational-state-data.ts`, o mesmo que a Operação usa) —
  // duplica algumas queries de propósito (mesmo princípio de isolamento já
  // documentado nesse módulo), nunca reaproveita `rawClients`/`allCards`.
  const [
    [
      clients,
      gestores,
      sprints,
      dailySpend,
      tasks,
      plannedAllocations,
      budgetChanges,
      teamMembersForIndicators,
      completedTasksForIndicators,
      reviewsForIndicators,
      channelSpendOverrides,
      performanceTargetHistory,
    ],
    clientOperationalStates,
    openReminders,
  ] = await Promise.all([
    Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select(
          "id, name, meta_ad_account_id, status, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
        )
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Sobreposição com a janela (não "começa na janela") — uma sprint que
    // atravessa mês (ex.: 27/jul-02/ago) precisa ser encontrada mesmo com
    // start_date fora do intervalo, senão sua parcela do outro mês some.
    requireQuery(
      supabase
        .from("sprints")
        .select(
          "id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at",
        )
        .lte("start_date", rangeEnd)
        .gte("end_date", rangeStart),
      "sprints",
    ),
    requireQuery(
      supabase
        .from("daily_spend")
        .select("client_id, date, channel, spend, synced_at")
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
    // Orçamento vigente (Etapa 66) pro mês SELECIONADO (`monthRange`) —
    // `buildOperationClientCard` só usa `monthRange` pra montar o card,
    // nunca `rangeStart`/`rangeEnd`. Etapa "Migração Multicanal dos
    // Consumidores": todos os canais (nunca mais só `channel = 'meta'`) —
    // esta query alimenta tanto os cards do Dashboard quanto
    // `buildOperationClientCard` (Operação), os dois via
    // `resolveConsolidatedMonthlyPlanned` (soma real dos canais com plano).
    //
    // Fase 1 "Confiabilidade dos Dados" — bug confirmado: `.eq` só trazia a
    // linha de um canal se o orçamento tivesse sido ALTERADO neste mês
    // exato. Um cliente cujo orçamento foi definido num mês anterior e
    // nunca mudou de novo (o caso comum — a maioria dos clientes não muda
    // de orçamento todo mês) vinha com ZERO linhas aqui, resolvendo
    // `monthPlanned = 0`/`hasMonthGoal = false` mesmo tendo um orçamento
    // vigente real — excluindo esse cliente do total da agência
    // (`computeFinancialSummary`) sem nenhuma base semântica. `.lte` (mesma
    // regra já usada pela query "target-history" abaixo, e pelo Motor de
    // Saúde em `client-operational-state-data.ts`) traz todo o histórico
    // até o mês selecionado — `resolveConsolidatedMonthlyPlanned`/
    // `resolveClientMonthlyPlan` já sabem reduzir isso à versão mais
    // recente POR CANAL (`month <= selectedMonth`), nunca soma histórico
    // por engano.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, channel, month, new_amount, changed_at, result_type")
        .lte("month", monthRange.firstDay),
      "monthly_budget_changes:current-month",
    ),
    // Consulta própria (independente de `gestores`, que serve o dropdown de
    // filtro e não pode ter seu comportamento alterado): precisa do papel de
    // cada membro pra nunca contar admin como gestor no indicador "Gestores
    // ativos".
    requireQuery(supabase.from("team_members").select("id, system_role, status"), "team_members:roles"),
    requireQuery(
      supabase
        .from("tasks")
        .select("client_id")
        .not("completed_at", "is", null)
        .gte("completed_at", indicatorsMonthStart)
        .lte("completed_at", indicatorsMonthEnd),
      "tasks:completed-indicators",
    ),
    requireQuery(
      supabase
        .from("account_reviews")
        .select("client_id")
        .gte("reviewed_at", indicatorsMonthStart)
        .lte("reviewed_at", indicatorsMonthEnd),
      "account_reviews:indicators",
    ),
    // Etapa 3 (MVP plataformas): override manual de gasto real por
    // sprint+canal — mesmo padrão de `sprints` acima (sem filtro de data,
    // volume pequeno e escopado por sprint, não por dia).
    requireQuery(
      supabase.from("sprint_channel_spend").select("client_id, sprint_id, channel, spend_source, manual_actual_spend"),
      "sprint_channel_spend",
    ),
    // Metas do planejamento mensal vigente (Etapa "Planejamento Mensal
    // 1.0") — `.lte` (não `.eq`) pelo mesmo motivo da página do Cliente: a
    // versão vigente do mês selecionado pode ter sido definida num mês
    // anterior. Sem filtro por cliente (é a Visão Geral inteira) — resolvido
    // por cliente logo abaixo, com `resolveClientMonthlyPlan`.
    // Etapa "Migração Multicanal dos Consumidores": todos os canais (nunca
    // mais só `channel = 'meta'`) — `resolveClientMonthlyPlan` resolve a
    // meta de resultado e o CPA vigente POR CANAL, e o consolidado é a soma
    // aditiva dos canais (nunca a meta de um canal só).
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, channel, month, changed_at, new_amount, target_result_count, result_type")
        .lte("month", monthRange.firstDay)
        .order("month", { ascending: false })
        .order("changed_at", { ascending: false }),
      "monthly_budget_changes:target-history",
    ),
    ]),
    loadClientOperationalStates(supabase, monthRange.firstDay),
    getOpenReminders(supabase),
  ]);
  perfLog("visão geral bloco 1 (12 queries + ClientOperationalState + Pendências)", __perfBlock1Start);

  const clientIds = (clients ?? []).map((c) => c.id);
  const currentSprintIds = (sprints ?? [])
    .filter((s) => isDateWithinPeriod(todayStr, s.start_date, s.end_date))
    .map((s) => s.id);
  // Etapa 71: registros de performance são sempre por sprint — buscar por
  // sprint_id (não por período) evita depender de duplicar a lógica de
  // sobreposição de datas já usada acima pras sprints em si.
  const monthSprintsForPerformance = (sprints ?? []).filter(
    (s) => s.start_date <= monthRange.lastDay && s.end_date >= monthRange.firstDay,
  );

  const __perfBlock2Start = perfNow();
  const [clientActivity, sprintActivity, performanceRecords, lastReviews, monthHorizonsByClient] = await Promise.all([
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
    // Integração Stract (arquitetura aprovada — ver DECISIONS.md):
    // `resolvePerformanceRowsForSprints` decide, por cliente, entre
    // `performance_records` (manual) e `daily_performance` (Stract) — nunca
    // as duas somadas. Mesmo formato de linha de antes.
    resolvePerformanceRowsForSprints(
      supabase,
      monthSprintsForPerformance.map((s) => ({ id: s.id, client_id: s.client_id, start_date: s.start_date, end_date: s.end_date })),
    ),
    // Etapa 74 — "Última otimização": sempre o dado GLOBAL mais recente por
    // cliente (independe do mês selecionado), por isso uma busca própria
    // sem filtro de data — mesma fonte usada no Acompanhamento da Conta.
    // Navigation Performance & Perceived Speed 1.0: não depende de nada
    // deste Promise.all, só de clientIds (pronto desde o bloco anterior) —
    // por isso entra aqui em vez de ser um round-trip sequencial à parte.
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
    // Etapa "Horizonte de Planejamento": clientes de evento (campanha que
    // termina antes do fim do mês) — mapa vazio pra quem não tem nenhum,
    // comportamento idêntico a antes desta etapa.
    getClientMonthHorizons(supabase, clientIds, monthRange.firstDay),
  ]);
  perfLog("visão geral bloco 2 fundido (atividade/performance/lastReviews, antes lastReviews era sequencial à parte)", __perfBlock2Start);

  // Etapa "Revisão da Visão Geral — Evolução no período": período anterior
  // de MESMA DURAÇÃO (`lib/period-comparison.ts`, escrita desde o início
  // pra ser reaproveitada aqui — nunca uma segunda lógica temporal). Quando
  // o mês selecionado está em andamento (hoje cai dentro dele), o período
  // ATUAL usado na comparação é truncado até hoje antes de calcular o
  // anterior — comparar 1-27 de agosto contra agosto INTEIRO de julho seria
  // uma leitura enganosa. Mês já encerrado ou ainda no futuro usam o mês
  // inteiro (não há "hoje" no meio do intervalo pra truncar).
  const currentPeriodEndForComparison =
    todayStr >= monthRange.firstDay && todayStr < monthRange.lastDay ? todayStr : monthRange.lastDay;
  const previousPeriod = previousEquivalentPeriod({ start: monthRange.firstDay, end: currentPeriodEndForComparison });

  // Consulta ENXUTA (soma direta, mesmas tabelas de sempre) — nunca
  // reconstrói sprint/orçamento/saúde pra um segundo período só pra tirar
  // uma comparação (dobraria o carregamento da página). `resolvePerformanceRowsForSprints`
  // é a mesma função já usada acima pro mês atual, só que sobre as sprints
  // que se sobrepõem ao período anterior.
  const __perfBlock3Start = perfNow();
  const [previousSprintsForPerformance, previousDailySpend] = await Promise.all([
    clientIds.length > 0
      ? requireQuery(
          supabase
            .from("sprints")
            .select("id, client_id, start_date, end_date")
            .in("client_id", clientIds)
            .lte("start_date", previousPeriod.end)
            .gte("end_date", previousPeriod.start),
          "sprints:previous-period",
        )
      : Promise.resolve([]),
    clientIds.length > 0
      ? requireQuery(
          supabase
            .from("daily_spend")
            .select("client_id, spend")
            .in("client_id", clientIds)
            .gte("date", previousPeriod.start)
            .lte("date", previousPeriod.end),
          "daily_spend:previous-period",
        )
      : Promise.resolve([]),
  ]);
  const previousPerformanceRowsRaw = await resolvePerformanceRowsForSprints(
    supabase,
    (previousSprintsForPerformance ?? []).map((s) => ({
      id: s.id,
      client_id: s.client_id,
      start_date: s.start_date,
      end_date: s.end_date,
    })),
  );
  perfLog("visão geral — evolução no período (período anterior)", __perfBlock3Start);
  perfLog("visão geral — dados totais carregados (auth + queries)", __perfPageStart);

  const previousSpendByClientId = new Map<string, number>();
  for (const row of previousDailySpend ?? []) {
    previousSpendByClientId.set(row.client_id, (previousSpendByClientId.get(row.client_id) ?? 0) + row.spend);
  }

  const lastReviewAtByClient = new Map<string, string>();
  for (const row of lastReviews ?? []) {
    if (!lastReviewAtByClient.has(row.client_id)) lastReviewAtByClient.set(row.client_id, row.reviewed_at);
  }

  type SprintRow = {
    id: string;
    client_id: string;
    start_date: string;
    end_date: string;
    planned_spend: number;
    spend_source: "manual" | "meta_api";
    manual_actual_spend: number | null;
    manual_spend_updated_at: string | null;
  };
  const sprintsByClient = new Map<string, SprintRow[]>();
  for (const s of sprints ?? []) {
    const list = sprintsByClient.get(s.client_id) ?? [];
    list.push(s);
    sprintsByClient.set(s.client_id, list);
  }

  const dailySpendByClient = new Map<string, { date: string; spend: number }[]>();
  const dailySpendChannelByClient = new Map<string, { date: string; channel: TrafficChannelDb; spend: number }[]>();
  const lastSyncedByClient = new Map<string, string>();
  for (const d of dailySpend ?? []) {
    const list = dailySpendByClient.get(d.client_id) ?? [];
    list.push({ date: d.date, spend: d.spend });
    dailySpendByClient.set(d.client_id, list);

    const channelList = dailySpendChannelByClient.get(d.client_id) ?? [];
    channelList.push({ date: d.date, channel: d.channel, spend: d.spend });
    dailySpendChannelByClient.set(d.client_id, channelList);

    const current = lastSyncedByClient.get(d.client_id);
    if (!current || d.synced_at > current) {
      lastSyncedByClient.set(d.client_id, d.synced_at);
    }
  }

  const channelOverridesByClient = new Map<string, SprintChannelSpendOverrideRow[]>();
  for (const o of channelSpendOverrides ?? []) {
    const list = channelOverridesByClient.get(o.client_id) ?? [];
    list.push({
      sprintId: o.sprint_id,
      channel: o.channel,
      spend_source: o.spend_source,
      manual_actual_spend: o.manual_actual_spend,
    });
    channelOverridesByClient.set(o.client_id, list);
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

  // Etapa "Múltiplos Objetivos": Dashboard/Operação só conhecem o objetivo
  // PRINCIPAL de cada cliente — nunca deixa a linha de um objetivo
  // secundário ser lida como investimento/meta do principal.
  const primaryGoalByClientId = new Map((clients ?? []).map((c) => [c.id, c.performance_goal]));

  const budgetChangesByClient = new Map<string, OperationClientRawData["monthlyBudgetChanges"]>();
  for (const c of filterRowsToPrimaryGoal(budgetChanges ?? [], primaryGoalByClientId)) {
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

  // Meta de custo VIGENTE (Etapa "Planejamento Mensal 1.0") — primeira
  // ocorrência por cliente já é a mais recente qualificada (query ordenada
  // por month desc, changed_at desc), então um `Map.set` que nunca
  // sobrescreve é suficiente pra "a primeira que eu vir, por cliente, é a
  // vigente". Fallback pro campo permanente de `clients` fica dentro de
  // `resolveMonthlyPerformanceTargets`, chamado por cliente logo abaixo.
  const targetHistoryByClient = new Map<string, ClientPlanChangeRow[]>();
  for (const row of filterRowsToPrimaryGoal(performanceTargetHistory ?? [], primaryGoalByClientId)) {
    const list = targetHistoryByClient.get(row.client_id) ?? [];
    list.push({
      channel: row.channel as TrafficChannel,
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
    });
    targetHistoryByClient.set(row.client_id, list);
  }
  const permanentCostFallbackByClient = new Map((clients ?? []).map((c) => [c.id, c.target_cost_per_result]));
  // Etapa "Migração Multicanal dos Consumidores": CPA consolidado = derivado
  // do investimento/resultado consolidados (nunca média/soma de CPA por
  // canal, ver `consolidateChannelMetrics`) — cai pro campo permanente do
  // cliente só quando NENHUM canal tem meta de resultado definida (mesmo
  // fallback de sempre, agora aplicado ao consolidado em vez de só Meta).
  //
  // Etapa "Comparabilidade de Escopo de Custo", Parte 4: guarda o resultado
  // COMPLETO (`byChannel` + `consolidated`), não só o CPA consolidado — o
  // recorte por canal de "Prioridades de hoje" (abaixo) precisa da meta
  // DAQUELE canal específico, nunca da consolidada disfarçada de "meta do
  // canal" (mesmo padrão já usado pela página do Cliente, `scopedTargetCostPerResult`).
  const clientMonthlyPlanByClient = new Map(
    (clients ?? []).map((c) => [
      c.id,
      resolveClientMonthlyPlan({
        channels: AVAILABLE_TRAFFIC_CHANNELS,
        changes: targetHistoryByClient.get(c.id) ?? [],
        selectedMonth: monthRange.firstDay,
      }),
    ]),
  );
  const resolvedTargetCostByClient = new Map<string, number | null>(
    (clients ?? []).map((c) => [
      c.id,
      clientMonthlyPlanByClient.get(c.id)?.consolidated.cpa ?? permanentCostFallbackByClient.get(c.id) ?? null,
    ]),
  );

  const clientActivityById = new Map((clientActivity ?? []).map((r) => [r.client_id, r.last_activity_at]));
  const sprintActivityById = new Map((sprintActivity ?? []).map((r) => [r.sprint_id, r.last_activity_at]));

  // Convergência da Regra de Revisão de Conta: `clientOperationalStates` já
  // carrega `evaluation.dimensions.review` (Motor de Saúde, cadência
  // configurável) — nenhum cálculo novo aqui, só a mesma decisão já
  // resolvida em paralelo (bloco 1, acima) repassada pro card legado.
  const reviewOverdueByClient = new Map(
    clientOperationalStates.map((state) => [state.clientId, isReviewOverdue(state.evaluation.dimensions.review)]),
  );

  const rawClients: OperationClientRawData[] = (clients ?? []).map((client) => {
    const clientSprints = sprintsByClient.get(client.id) ?? [];
    const currentSprint = findSprintForDate(clientSprints, todayStr);

    return {
      id: client.id,
      name: client.name,
      metaAdAccountId: client.meta_ad_account_id,
      // Etapa 62: fonte única do gestor atribuído (clients.primary_manager_id),
      // nunca mais client_managers (que ficou reservado só pra autorização de
      // escrita — ver relatório desta etapa).
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
      // `?? false` só cobre a impossibilidade estática do Map.get() (todo
      // client.id vem do mesmo `clients` que populou o mapa) — nunca um
      // fallback de comportamento de verdade.
      reviewIsOverdue: reviewOverdueByClient.get(client.id) ?? false,
      performanceGoal: client.performance_goal,
      // Etapa "Planejamento Mensal 1.0": meta de custo VIGENTE (planejamento
      // mensal, com o campo permanente de `clients` só como fallback) —
      // nunca mais o valor cru de `clients.target_cost_per_result` direto.
      // `buildOperationClientCard` (operation-data.ts) não muda: só o valor
      // que entra neste campo passou a ser resolvido aqui.
      targetCostPerResult: resolvedTargetCostByClient.get(client.id) ?? client.target_cost_per_result ?? null,
      performanceRecords: performanceRecordsByClient.get(client.id) ?? [],
      dailySpendChannel: dailySpendChannelByClient.get(client.id) ?? [],
      channelSpendOverrides: channelOverridesByClient.get(client.id) ?? [],
    };
  });

  const allCards = rawClients.map((client) =>
    buildOperationClientCard(client, today, monthRange, resolvePlanningHorizon(monthRange, monthHorizonsByClient.get(client.id) ?? null)),
  );

  // Opções do combobox de cliente: todos os clientes visíveis (mesma regra
  // de RLS que já trouxe `allCards` — Etapa 15 abriu leitura de `clients`
  // pra qualquer usuário autenticado, pra colaboração entre gestores), sem
  // filtrar por carteira — carteira e cliente são eixos independentes.
  const clientOptions: AgencyClientOption[] = [...allCards]
    .map((card) => ({ id: card.clientId, name: card.clientName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Diagnósticos do Motor Único (Core), por cliente — mesmo dado que
  // `clientOperationalStates` já carrega pra Operação, só reaproveitado
  // aqui (nenhum recálculo). Alimenta o filtro "Diagnóstico" abaixo, que
  // substitui o antigo filtro de saúde da conta (Sistema B).
  const diagnosticsByClient = new Map(clientOperationalStates.map((state) => [state.clientId, state.diagnostics]));

  // Filtros que respeitam tudo, exceto gestor — permite comparar gestores
  // no bloco "Resumo por Gestor" com o mesmo recorte de status/atividade
  // aplicado no resto do dashboard.
  let filteredBase = allCards;

  if (diagnosticFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => {
      const diagnostics = diagnosticsByClient.get(card.clientId);
      return diagnostics ? getActiveDiagnosticFilters(diagnostics).includes(diagnosticFilter) : false;
    });
  }
  if (resultTypeFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.performanceGoal === resultTypeFilter);
  }
  // Etapa 3: ritmo financeiro só existe pro orçamento CONSOLIDADO (não há
  // orçamento configurado por canal) — o filtro de ritmo é ignorado fora do
  // recorte Consolidado, nunca aplicado contra um "esperado" que não existe
  // pra Meta/Google isoladamente.
  if (platformFilter === "consolidado") {
    if (ritmoFilter === "fora_do_ritmo") {
      filteredBase = filteredBase.filter((card) => card.monthStatus === "abaixo" || card.monthStatus === "acima");
    } else if (ritmoFilter !== "todos") {
      filteredBase = filteredBase.filter((card) => card.monthStatus === ritmoFilter);
    }
  }
  // Etapa 3: filtro de plataforma — um cliente sem a plataforma configurada
  // nunca aparece no recorte específico dela (nunca uma linha com tudo
  // "—"). Consolidado nunca filtra por esta regra (todo cliente participa
  // do consolidado, mesmo sem nenhuma plataforma com dado ainda).
  if (platformFilter !== "consolidado") {
    filteredBase = filteredBase.filter((card) => card.clientUsesChannel[platformFilter] === true);
  }
  if (sprintBucketFilter) {
    filteredBase = filteredBase.filter((card) => card.sprintFilterBucket === sprintBucketFilter);
  }
  if (syncFilter === "stale") {
    filteredBase = filteredBase.filter((card) => card.alerts.some((a) => a.message.includes("sincronização")));
  }
  if (metaFilter === "sem") {
    filteredBase = filteredBase.filter((card) => !card.hasMonthGoal);
  }

  let cards = filteredBase;
  if (managerFilter === "me") {
    cards = cards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  // Filtro de cliente específico: um ID inválido, inacessível, ou que não
  // pertence mais à carteira selecionada (ex.: usuário trocou o gestor
  // depois de já ter escolhido um cliente) é ignorado com segurança — nunca
  // mantemos uma seleção que não bate mais com o resto do contexto. Como
  // `clientFilter` (validado) é o mesmo valor usado em todos os links da
  // página, a URL se autocorrige assim que o usuário navega de novo.
  const clientFilter = clientParam && cards.some((card) => card.clientId === clientParam) ? clientParam : undefined;
  if (clientFilter) {
    cards = cards.filter((card) => card.clientId === clientFilter);
  }

  // Indicadores da operação: respeitam só mês + carteira + cliente — nunca
  // os filtros de recorte (saúde/ritmo/tarefas/sincronização/meta), que
  // continuam existindo só para a tabela de clientes e "Resumo por Gestor"
  // (`filteredBase`/`cards`). Por isso partem de `allCards` (sem nenhum
  // filtro) e reaplicam só carteira/cliente, em vez de reaproveitar `cards`.
  let indicatorCards = allCards;
  if (managerFilter === "me") {
    indicatorCards = indicatorCards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    indicatorCards = indicatorCards.filter((card) => card.managerIds.includes(managerFilter));
  }
  if (clientFilter) {
    indicatorCards = indicatorCards.filter((card) => card.clientId === clientFilter);
  }

  const clientStatusById = new Map((clients ?? []).map((c) => [c.id, c.status]));
  const operationIndicators = computeOperationIndicators({
    cards: indicatorCards,
    clientStatusById,
    teamMembers: (teamMembersForIndicators ?? []).map((m) => ({ id: m.id, systemRole: m.system_role, status: m.status })),
    completedTaskClientIds: (completedTasksForIndicators ?? []).map((t) => t.client_id),
    reviewClientIds: (reviewsForIndicators ?? []).map((r) => r.client_id),
    hasClientFilter: Boolean(clientFilter),
  });
  // Etapa "Consolidação da Arquitetura — Fase B" (Prioridade 3): "Resultados
  // da agência" migrou pra `computeHealthResultsSummary` — mesmo recorte de
  // mês/carteira/cliente de `operationIndicators` (nunca os filtros de
  // recorte de `cards`), só que sobre `ClientOperationalState[]` em vez do
  // card legado. Paridade verificada via fixtures sintéticos (ver relatório).
  let indicatorStates = clientOperationalStates;
  if (managerFilter === "me") {
    indicatorStates = indicatorStates.filter((state) => state.managerId === profile.id);
  } else if (managerFilter !== "all") {
    indicatorStates = indicatorStates.filter((state) => state.managerId === managerFilter);
  }
  if (clientFilter) {
    indicatorStates = indicatorStates.filter((state) => state.clientId === clientFilter);
  }
  // Fase 1 "Confiabilidade dos Dados" — bug confirmado: `ClientOperationalState`
  // não tem nenhuma dimensão por canal, então `computeHealthResultsSummary`
  // sempre somava Leads/Vendas de TODOS os canais do cliente, mesmo com o
  // filtro de plataforma ativo (a plataforma só filtrava QUAIS clientes
  // entravam — via `filteredBase`/`cards` — nunca o resultado em si). Fora
  // de Consolidado, usa `computeAgencyResultsByChannel` sobre o motor legado
  // (`OperationClientCard`, que já tem `monthPerformanceSummaryByChannel`/
  // `monthActualByChannel` por canal, Etapa 3) — mesmo recorte de
  // mês/carteira/cliente de `indicatorStates` (nunca os filtros de recorte
  // de `cards`), só reaplicando o mesmo critério de "usa este canal"
  // (`clientUsesChannel`) já usado por `filteredBase`.
  let indicatorCardsForResults = indicatorCards;
  if (platformFilter !== "consolidado") {
    indicatorCardsForResults = indicatorCardsForResults.filter((card) => card.clientUsesChannel[platformFilter] === true);
  }
  const agencyResults =
    platformFilter === "consolidado"
      ? computeHealthResultsSummary(indicatorStates)
      : computeAgencyResultsByChannel(indicatorCardsForResults, platformFilter);

  // Etapa "Revisão da Visão Geral — Evolução no período": totais REALIZADOS
  // do período anterior (dado bruto já buscado acima). Escopo de
  // investimento = mesmo de `financial`/`computeFinancialSummary` (`cards`,
  // com os filtros de recorte); escopo de leads/vendas = mesmo de
  // `agencyResults`/`computeHealthResultsSummary` (`indicatorCards`, só
  // mês/carteira/cliente) — cada métrica compara contra o período anterior
  // no MESMO escopo do seu próprio valor absoluto, nunca uma segunda lógica
  // de recorte.
  const previousPerformanceRows = filterRowsToPrimaryGoal(previousPerformanceRowsRaw, primaryGoalByClientId);
  const previousInvestmentTotals = computeAgencyPeriodTotals({
    investmentClientIds: new Set(cards.map((c) => c.clientId)),
    resultsClientIds: new Set(indicatorCards.map((c) => c.clientId)),
    spendByClientId: previousSpendByClientId,
    performanceRows: previousPerformanceRows,
    primaryGoalByClientId,
  });

  // Etapa "Saúde da carteira" (auditoria da Visão Geral): "como está minha
  // carteira agora", um número por balde — mesmo agrupamento de 4 baldes já
  // construído e testado pra Operação (`resolveOperationPriorityGroup`,
  // `lib/operation-triage.ts`), nunca um score/threshold novo aqui. Mesmo
  // recorte de mês/carteira/cliente de `agencyResults`/`operationIndicators`
  // (`indicatorStates`, nunca os filtros de recorte de `cards`) — é um
  // retrato macro da carteira, não uma lista filtrável.
  const portfolioHealthCounts: Record<OperationPriorityGroup, number> = {
    critico: 0,
    atencao: 0,
    saudavel: 0,
    sem_dados: 0,
  };
  for (const state of indicatorStates) {
    portfolioHealthCounts[resolveOperationPriorityGroup(state.evaluation)]++;
  }
  // Operação não filtra por balde via URL (o agrupamento lá é só ordenação/
  // divisor visual, ver `operation-triage-view.tsx`) — o link leva pro mês
  // certo, onde Crítico já aparece primeiro na fila, nunca um filtro
  // fabricado que a tela de destino não suporta.
  const operationHref = `/operation?month=${monthRange.firstDay}`;
  // Etapa "Revisão da Visão Geral": ponte compacta pra Operação — "precisa
  // de atenção" é Crítico + Atenção do mesmo agrupamento acima (nunca um
  // score novo), os 2 baldes que de fato pedem uma ação; Saudável/Sem dados
  // não entram na contagem.
  const needsAttentionCount = portfolioHealthCounts.critico + portfolioHealthCounts.atencao;

  const financial = computeFinancialSummary(cards);
  // Etapa 3: realizado do canal selecionado, somado sobre os clientes já
  // filtrados (que, fora de Consolidado, já são só os que usam essa
  // plataforma — ver filtro acima). `null` quando Consolidado (não usado).
  const channelActualTotal =
    platformFilter !== "consolidado" ? cards.reduce((sum, c) => sum + (c.monthActualByChannel[platformFilter] ?? 0), 0) : null;

  const investmentDiff = financial.actual - financial.expectedToDate;
  const investmentRitmoStatus =
    financial.planned > 0 ? classifySpendStatus(financial.actual, financial.expectedToDate, financial.planned) : "sem_meta";
  const investmentDiffTone: StatusTone =
    investmentRitmoStatus === "acima" ? "danger" : investmentRitmoStatus === "abaixo" ? "warning" : "neutral";
  // Etapa "Refinamento Visão Geral da Agência" (Ponto 4): o diagnóstico de
  // ritmo vira uma frase de STATUS em destaque (`investmentStatusPhrase`),
  // com o valor em reais como apoio secundário abaixo dela — antes o número
  // isolado ("R$ X abaixo") era o único elemento, competindo em peso visual
  // com o próprio status. Nenhum cálculo mudou (`investmentDiff`/
  // `investmentRitmoStatus` intactos), só a apresentação.
  const investmentStatusPhrase =
    investmentRitmoStatus === "abaixo"
      ? "Ritmo abaixo do esperado hoje"
      : investmentRitmoStatus === "acima"
        ? "Ritmo acima do esperado hoje"
        : investmentRitmoStatus === "dentro"
          ? "Dentro do ritmo esperado"
          : "—";
  const investmentDiffValueText = investmentDiff !== 0 ? formatCurrency(Math.abs(investmentDiff)) : null;
  const monthTemporalStatus = getMonthTemporalStatus(monthRange, todayStr);

  // Etapa "Revisão da Visão Geral — Evolução no período": "↑X% vs período
  // anterior" pra cada KPI executivo, reaproveitando a mesma função já usada
  // pelo Hero do Analytics do cliente (`buildPercentChangeComparison`,
  // `lib/analytics.ts`) — nenhuma segunda versão do texto/tom. Investimento é
  // `neutral` (gastar mais/menos não é bom ou ruim em si, mesma decisão já
  // tomada pro Analytics); Leads/Vendas são `higher_is_better`; CPL/CPA são
  // `lower_is_better`. `null` sempre que não há base anterior confiável
  // (`computePercentChange`) — cada indicador exibe (ou não) sua própria
  // variação de forma independente, nunca uma seção inteira condicionada ao
  // "algum dos cinco tem dado".
  //
  // Etapa "Refinamento visual da Visão Geral — Síntese": a variação deixou
  // de ter uma seção própria ("Evolução no período") e passou a viver dentro
  // do próprio big number — `OperationMetric` (`comparison` prop) — pra
  // eliminar a duplicação de mostrar cada indicador duas vezes na mesma
  // tela. Nenhum dos 5 cálculos abaixo mudou.
  // Fase 1 "Confiabilidade dos Dados": `previousInvestmentTotals` (período
  // anterior) é sempre CONSOLIDADO — a query de `daily_spend`/performance do
  // período anterior nunca filtrou por canal (só existe pra alimentar esta
  // comparação, nunca os KPIs absolutos). Comparar um valor ATUAL agora
  // corretamente escopado por canal (ver `agencyResults`/`channelActualTotal`
  // acima) contra um "período anterior" sempre consolidado produziria uma
  // variação sem sentido (dois escopos diferentes) — pior que não mostrar
  // nada. Fora de Consolidado, nenhuma das 5 comparações é exibida (`null`,
  // nunca uma % fabricada); ficam como estavam só no recorte Consolidado, o
  // único onde as duas pontas realmente comparam o mesmo escopo.
  const evolutionInvestment =
    platformFilter === "consolidado" ? buildPercentChangeComparison(financial.actual, previousInvestmentTotals.investment, "neutral") : null;
  const evolutionLeads =
    platformFilter === "consolidado"
      ? buildPercentChangeComparison(agencyResults.leads.count, previousInvestmentTotals.leadsCount, "higher_is_better")
      : null;
  const evolutionLeadsCpl =
    platformFilter === "consolidado" && agencyResults.leads.costPerResult !== null
      ? buildPercentChangeComparison(agencyResults.leads.costPerResult, previousInvestmentTotals.leadsCostPerResult, "lower_is_better")
      : null;
  const evolutionSales =
    platformFilter === "consolidado"
      ? buildPercentChangeComparison(agencyResults.sales.count, previousInvestmentTotals.salesCount, "higher_is_better")
      : null;
  const evolutionSalesCpa =
    platformFilter === "consolidado" && agencyResults.sales.costPerResult !== null
      ? buildPercentChangeComparison(agencyResults.sales.costPerResult, previousInvestmentTotals.salesCostPerResult, "lower_is_better")
      : null;
  // Versão curta ("↑49%") do mesmo texto já pronto de `comparison.text`
  // ("↑49% vs período anterior") — só formatação de exibição pra CPL/CPA
  // não repetirem "vs período anterior" uma segunda vez na mesma linha do
  // indicador principal (Leads/Vendas já mostram a frase inteira acima).
  // Nenhum recálculo: mesma variação, mesmo tom, só o texto mais curto.
  function shortComparisonText(comparison: AnalyticsKpiComparison): string {
    return comparison.text.replace(" vs período anterior", "");
  }

  // Preserva TODOS os filtros ativos — usado na navegação de mês e na
  // ordenação da tabela, que não devem resetar o resto do contexto. Não
  // inclui prioridades/prioridadeSeveridade de propósito — abrir/fechar o
  // drawer não deve "grudar" em outras navegações (ver prioritiesUrl).
  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.month) next.set("month", params.month);
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
    if (diagnosticFilter !== "todos") next.set("diagnostico", diagnosticFilter);
    if (resultTypeFilter !== "todos") next.set("resultType", resultTypeFilter);
    if (ritmoFilter !== "todos") next.set("ritmo", ritmoFilter);
    if (sprintBucketFilter) next.set("sprintBucket", sprintBucketFilter);
    if (syncFilter) next.set("sync", syncFilter);
    if (metaFilter) next.set("meta", metaFilter);
    if (platformFilter !== "consolidado") next.set("platform", platformFilter);
    if (pendenciaFiltroFilter !== "todas") next.set("pendenciaFiltro", pendenciaFiltroFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  };

  // Módulo "Pendências" — independente de mês/gestor/plataforma de
  // propósito (são registros rápidos, não parte do recorte financeiro/
  // operacional). Mesmo espírito de `prioritiesUrl`: abrir/fechar os
  // overlays (drawer de adicionar/editar, "Ver concluídas") nunca "gruda"
  // em outras navegações — só o filtro de chips (Todas/Agência/Clientes/
  // Minhas) é preservado via `buildUrl` (mesmo tratamento de `ritmo`/
  // `tasks`).
  const remindersSorted = sortReminders(openReminders, todayStr);
  const reminderCounts = computeReminderCounts(remindersSorted, todayStr);
  const remindersFiltered = filterReminders(remindersSorted, pendenciaFiltroFilter, profile.id);
  const buildReminderFilterHref = (filter: ReminderFilter) => buildUrl({ pendenciaFiltro: filter === "todas" ? "" : filter });
  const buildReminderEditHref = (reminderId: string) => buildUrl({ pendenciaModal: reminderId });
  const addReminderHref = buildUrl({ pendenciaModal: "new" });
  const closeReminderModalHref = buildUrl({ pendenciaModal: "" });
  const openCompletedRemindersHref = buildUrl({ pendenciasConcluidas: "1" });
  const closeCompletedRemindersHref = buildUrl({ pendenciasConcluidas: "" });

  const isNewReminderModal = params.pendenciaModal === "new";
  const editingReminder =
    params.pendenciaModal && !isNewReminderModal ? await getReminderById(supabase, params.pendenciaModal) : null;
  const showReminderModal = isNewReminderModal || Boolean(editingReminder);
  const showCompletedReminders = params.pendenciasConcluidas === "1";
  const completedReminders = showCompletedReminders ? await getCompletedReminders(supabase) : [];

  const monthLabel = formatMonthLabel(monthRange.firstDay);

  // Etapa "Cabeçalho executivo": o título "Visão Geral" saiu (redundante com
  // a Sidebar + o próprio conteúdo da página) e o seletor de mês — antes uma
  // action do extinto `PageHeader` — virou parte da mesma linha de controles
  // da `AgencyFilters`, ao lado de "Filtros". A toolbar é agora o cabeçalho
  // funcional da página; ganhou o mesmo rail em areia (`SandRail`) dos
  // demais seletores estruturais (escopo/plataforma), consolidando os
  // quatro controles superiores como uma família visual só.
  //
  // Etapa "Microajuste: aliviar Período/Filtros": container/borda/fundo
  // saíram — só a esquerda (escopo/plataforma) continua com superfície
  // própria; mês e Filtros ficam direto sobre o fundo da página, mais leves,
  // com o rail como única assinatura (os `IconButton`/`Button` ghost por
  // baixo já trazem seu próprio hover sutil, então nada muda em interação).
  const monthNav = (
    <div className="relative flex items-center gap-0.5 pl-4">
      <SandRail />
      <IconButton
        href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
        aria-label="Mês anterior"
        variant="ghost"
        size="sm"
      >
        &lsaquo;
      </IconButton>
      <span className="min-w-[8rem] text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
      <IconButton
        href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
        aria-label="Próximo mês"
        variant="ghost"
        size="sm"
      >
        &rsaquo;
      </IconButton>
      {params.month && (
        <Button href={buildUrl({ month: "" })} variant="ghost" size="sm" className="ml-0.5">
          Mês atual
        </Button>
      )}
    </div>
  );

  return (
    <div className={`min-h-[calc(100dvh_-_3rem)] ${inter.variable}`} style={{ fontFamily: "var(--font-overview)" }}>
      <div className="mx-auto max-w-7xl px-6 pt-5 pb-3">
        <AgencyFilters
          defaultManager={isAdmin ? "all" : "me"}
          gestores={gestores ?? []}
          manager={managerFilter}
          clients={clientOptions}
          selectedClientId={clientFilter}
          diagnostico={diagnosticFilter}
          resultType={resultTypeFilter}
          ritmo={ritmoFilter === "fora_do_ritmo" ? "todos" : ritmoFilter}
          platform={platformFilter}
          preserved={{
            month: params.month,
            sprintBucket: sprintBucketFilter,
            sync: syncFilter,
            meta: metaFilter,
          }}
          monthNav={monthNav}
        />

        {/* Etapa "Refinamento visual da Visão Geral — Síntese": a página
            deixa de misturar panorama executivo com diagnóstico operacional
            por cliente (Críticas/Atenção/Saudáveis/Sem dados, Fora do ritmo,
            Gestores vinculados, Tarefas, Revisões e a fila de Prioridades
            saíram daqui — nenhuma dessas regras foi alterada, todas
            continuam existindo em Operação, que também é pra onde o link em
            "Contas ativas" leva). "Desempenho da agência" responde só "como
            está a agência agora": 4 números executivos com sua própria
            variação embutida (nunca mais uma segunda seção "Evolução no
            período" repetindo os mesmos 4-5 indicadores) e o ritmo agregado
            de investimento.
            Superfície aberta (nem `rounded-lg`/`border`/`bg-overview-surface`
            do "card" que existia antes) — só um `border-t` bem sutil separa
            os dois blocos, pedido explícito desta rodada pra reduzir a
            sensação de "vários cards dentro de cards". Rail em areia
            (`SectionHeader accent`, padrão compartilhável novo — ver
            `components/workspace/section-header.tsx`) é a única assinatura
            de marca desta seção. */}
        <div className="mt-6">
          <SectionHeader
            title={platformFilter === "consolidado" ? "Desempenho da agência" : `Desempenho da agência · ${PLATFORM_LABEL[platformFilter]}`}
            accent
          />
          <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Fase 1 "Confiabilidade dos Dados" — bug confirmado: este card
                sempre mostrava `financial.actual` (soma de `monthActual`,
                SEMPRE consolidado — todos os canais do cliente), mesmo com
                o filtro de plataforma ativo — divergindo do "Realizado ·
                Plataforma" corretamente escopado por canal mais abaixo
                (`channelActualTotal`), na MESMA tela. Fora de Consolidado,
                reaproveita esse mesmo `channelActualTotal` (nenhum cálculo
                novo) — "planejado"/comparação vs. período anterior não
                existem por canal ainda (mesma limitação já documentada na
                seção "Ritmo de investimento" abaixo), por isso ficam de
                fora em vez de mostrar uma base errada. */}
            <OperationMetric
              label="Investimento"
              value={formatCurrency(platformFilter === "consolidado" ? financial.actual : (channelActualTotal ?? 0))}
              comparison={evolutionInvestment}
              context={
                platformFilter !== "consolidado"
                  ? "Planejamento disponível só no recorte Consolidado"
                  : financial.planned > 0
                    ? `de ${formatCurrency(financial.planned)} planejados`
                    : "Nenhum planejamento configurado"
              }
            />
            <OperationMetric
              label="Leads"
              value={agencyResults.leads.clientsWithData > 0 ? String(agencyResults.leads.count) : "—"}
              comparison={agencyResults.leads.clientsWithData > 0 ? evolutionLeads : null}
              context={
                agencyResults.leads.clientsWithData > 0 ? (
                  <>
                    {PERFORMANCE_GOALS.leads.costMetricShortLabel}{" "}
                    {agencyResults.leads.costPerResult !== null ? formatCurrency(agencyResults.leads.costPerResult) : "—"}
                    {evolutionLeadsCpl && (
                      <>
                        {" "}
                        · <span className={COMPARISON_TONE_TEXT_CLASSES[evolutionLeadsCpl.tone]}>{shortComparisonText(evolutionLeadsCpl)}</span>
                      </>
                    )}
                  </>
                ) : (
                  "Nenhum cliente com objetivo de leads configurado"
                )
              }
            />
            <OperationMetric
              label="Vendas"
              value={agencyResults.sales.clientsWithData > 0 ? String(agencyResults.sales.count) : "—"}
              comparison={agencyResults.sales.clientsWithData > 0 ? evolutionSales : null}
              context={
                agencyResults.sales.clientsWithData > 0 ? (
                  <>
                    {PERFORMANCE_GOALS.sales.costMetricShortLabel}{" "}
                    {agencyResults.sales.costPerResult !== null ? formatCurrency(agencyResults.sales.costPerResult) : "—"}
                    {evolutionSalesCpa && (
                      <>
                        {" "}
                        · <span className={COMPARISON_TONE_TEXT_CLASSES[evolutionSalesCpa.tone]}>{shortComparisonText(evolutionSalesCpa)}</span>
                      </>
                    )}
                  </>
                ) : (
                  "Nenhum cliente com objetivo de vendas configurado"
                )
              }
            />
            {/* "Contas ativas" reaproveita a mesma fonte central de sempre
                (`operationIndicators.activeClientsCount`, contrato
                `status = "ativo"`) — secundário aos outros 3 (sem
                `comparison`, mesmo tamanho de fonte, papel de contexto da
                carteira). O link substitui a antiga seção "Acompanhamento
                operacional" inteira: mesma contagem (`needsAttentionCount`
                = Crítico + Atenção, resolveOperationPriorityGroup) e mesmo
                destino (`operationHref`), sem precisar de uma faixa própria
                pra uma única linha de informação. */}
            <OperationMetric
              label="Contas ativas"
              value={String(operationIndicators.activeClientsCount)}
              linkHref={operationHref}
              linkLabel={`${needsAttentionCount} conta${needsAttentionCount !== 1 ? "s" : ""} precisa${needsAttentionCount !== 1 ? "m" : ""} de atenção →`}
            />
          </div>

          <div className="mt-5 border-t border-overview-border pt-3">
            <SectionHeader
              title={
                platformFilter === "consolidado"
                  ? "Ritmo de investimento"
                  : `Ritmo de investimento · ${PLATFORM_LABEL[platformFilter]}`
              }
            />

            {platformFilter === "consolidado" ? (
              financial.planned > 0 ? (
                <>
                  <div className="mt-2">
                    <ProgressBar
                      planned={financial.planned}
                      actual={financial.actual}
                      expectedToDate={financial.expectedToDate}
                      monthTemporalStatus={monthTemporalStatus}
                    />
                  </div>

                  {/* Etapa "Refinamento visual da Visão Geral — Síntese"
                      (redução de altura do bloco): status + diferença em uma
                      única linha (era `investmentStatusPhrase` num parágrafo
                      e `investmentDiffValueText` em outro) e a legenda
                      "● Realizado"/"● Esperado hoje" do `ProgressBar` saiu —
                      o rótulo do próprio marcador ("Esperado hoje · X%") já
                      diz isso, e o preenchimento colorido é a única barra na
                      tela, não precisa de legenda pra ser lido como
                      "realizado". Nenhum cálculo mudou (`investmentDiff`/
                      `investmentRitmoStatus`/`investmentStatusPhrase`/
                      `investmentDiffValueText` intactos). */}
                  <p
                    className={`mt-1.5 text-[13px] font-medium ${
                      investmentDiffTone === "danger"
                        ? "text-overview-danger"
                        : investmentDiffTone === "warning"
                          ? "text-overview-warning"
                          : "text-overview-text-secondary"
                    }`}
                  >
                    {investmentStatusPhrase}
                    {investmentDiffValueText ? ` · ${investmentDiffValueText} de diferença` : null}
                  </p>
                </>
              ) : (
                <EmptyState title="Nenhum cliente do recorte tem planejamento mensal configurado." className="mt-3" />
              )
            ) : (
              <>
                {/* Etapa 3: fora do Consolidado só existe investimento
                    REALIZADO por plataforma — planejado/esperado/ritmo
                    dependem de um orçamento que ainda não é configurado por
                    canal (ver decisão registrada no relatório da etapa). */}
                <div className="mt-2 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-3">
                  <PrimaryInvestmentMetric label={`Realizado · ${PLATFORM_LABEL[platformFilter]}`} value={formatCurrency(channelActualTotal ?? 0)} />
                </div>
                <p className="mt-1.5 text-[13px] text-overview-text-muted">
                  Planejado e ritmo financeiro disponíveis só no recorte Consolidado — ainda não há orçamento configurado por plataforma.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Módulo "Pendências": lembretes rápidos e leves (agência/cliente),
            deliberadamente fora de "Desempenho da agência" acima — como
            envolve ações (adicionar/concluir/editar), não pode ficar
            misturado com indicadores read-only. Nunca mistura com
            tarefas/sprints: ver `src/lib/reminders.ts`. */}
        <div className="mt-3">
          <RemindersPanel
            reminders={remindersFiltered}
            todayStr={todayStr}
            counts={reminderCounts}
            filter={pendenciaFiltroFilter}
            buildFilterHref={buildReminderFilterHref}
            addHref={addReminderHref}
            completedHref={openCompletedRemindersHref}
            buildEditHref={buildReminderEditHref}
          />
        </div>

        {showReminderModal && (
          <ReminderFormDrawer
            closeHref={closeReminderModalHref}
            clients={clientOptions}
            teamMembers={gestores ?? []}
            reminderId={editingReminder?.id}
            initialTitle={editingReminder?.title}
            initialScope={editingReminder?.scope}
            initialClientId={editingReminder?.clientId}
            initialAssigneeId={editingReminder?.assigneeId}
            initialDueDate={editingReminder?.dueDate}
            initialNotes={editingReminder?.notes}
          />
        )}

        {showCompletedReminders && (
          <RemindersCompletedDrawer reminders={completedReminders} closeHref={closeCompletedRemindersHref} />
        )}
      </div>
    </div>
  );
}
