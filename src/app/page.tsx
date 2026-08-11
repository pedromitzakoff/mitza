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
import { formatCurrency, formatMonthLabel, formatPercent } from "@/lib/format";
import { getMonthTemporalStatus, resolveMonthlyPerformanceTargets } from "@/lib/monthly-budget";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { computeFinancialSummary, computeManagerSummary, computeSpendRhythmCounts } from "@/lib/agency-metrics";
import { computeHealthResultsSummary } from "@/lib/agency-health-aggregation";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { resolvePerformanceRowsForSprints } from "@/lib/performance-queries";
import { evaluateClientChannelDiagnostics } from "@/lib/client-operational-state";
import { resolveClientChannelBreakdown, type ClientChannelState } from "@/lib/client-channel-breakdown";
import {
  buildOverviewPriorityItem,
  hasActiveOverviewDiagnostic,
  type OverviewPriorityFilter,
  type OverviewPriorityItem,
} from "./overview-client-view";
import { getActiveDiagnosticFilters, getDiagnosticPriorityRank } from "@/lib/metric-diagnostics";
import { summarizeOperationTriage } from "@/lib/operation-triage";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeOperationIndicators } from "@/lib/operation-indicators";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { AgencyFilters, type AgencyClientOption } from "./agency-filters";
import { PrioritiesDrawer, PrioritiesPanel } from "./priorities-panel";
import { OperationMetric, OperationMiniKpi } from "./operation-metric";
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
import { PageHeader } from "@/components/workspace/page-header";
import { SectionHeader } from "@/components/workspace/section-header";
import type { StatusTone } from "@/components/workspace/status-dot";
import type { TrafficChannelDb } from "@/lib/supabase/database.types";
import type { SprintChannelSpendOverrideRow } from "@/lib/channel-spend";

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
    prioridades?: string;
    prioridadeSeveridade?: string;
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
    // Orçamento vigente (Etapa 66) — só do mês SELECIONADO (`monthRange`),
    // não da janela união com o mês corrente: `buildOperationClientCard` só
    // usa `monthRange` pra montar o card, nunca `rangeStart`/`rangeEnd`.
    // Etapa "Planejamento por Canal": filtrado por channel='meta' de
    // propósito — esta query alimenta tanto os cards do Dashboard quanto
    // `buildOperationClientCard` (Operação), nenhum dos dois migrado pro
    // plano consolidado por canal ainda; filtro preserva o comportamento
    // exato de antes desta etapa nos dois.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, new_amount, changed_at")
        .eq("month", monthRange.firstDay)
        .eq("channel", "meta"),
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
    // por cliente logo abaixo, com `resolveMonthlyPerformanceTargets`.
    // Etapa "Planejamento por Canal": filtrado por channel='meta' de
    // propósito — mesmo motivo da query de investimento acima.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, month, changed_at, new_amount, target_result_count, target_cost_per_result")
        .lte("month", monthRange.firstDay)
        .eq("channel", "meta")
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
  const [clientActivity, sprintActivity, performanceRecords, lastReviews] = await Promise.all([
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
  ]);
  perfLog("visão geral bloco 2 fundido (atividade/performance/lastReviews, antes lastReviews era sequencial à parte)", __perfBlock2Start);
  perfLog("visão geral — dados totais carregados (auth + queries)", __perfPageStart);

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
  const targetHistoryByClient = new Map<
    string,
    { month: string; changedAt: string; investment: number; targetResultCount: number | null; targetCostPerResult: number | null }[]
  >();
  for (const row of performanceTargetHistory ?? []) {
    const list = targetHistoryByClient.get(row.client_id) ?? [];
    list.push({
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
      targetCostPerResult: row.target_cost_per_result,
    });
    targetHistoryByClient.set(row.client_id, list);
  }
  const permanentCostFallbackByClient = new Map((clients ?? []).map((c) => [c.id, c.target_cost_per_result]));
  const resolvedTargetCostByClient = new Map<string, number | null>(
    (clients ?? []).map((c) => [
      c.id,
      resolveMonthlyPerformanceTargets(
        targetHistoryByClient.get(c.id) ?? [],
        monthRange.firstDay,
        permanentCostFallbackByClient.get(c.id) ?? null,
      ).targetCostPerResult,
    ]),
  );

  const clientActivityById = new Map((clientActivity ?? []).map((r) => [r.client_id, r.last_activity_at]));
  const sprintActivityById = new Map((sprintActivity ?? []).map((r) => [r.sprint_id, r.last_activity_at]));
  const primaryManagerNameByClient = new Map(
    (clients ?? []).map((c) => [c.id, c.primary_manager?.name ?? null]),
  );

  // Etapa "Consolidação da Arquitetura — Fase B" (Prioridade 5): recorte por
  // canal (`client-channel-breakdown.ts`) — reaproveita os mesmos dados
  // brutos já buscados acima (`sprintsByClient`/`dailySpendChannelByClient`/
  // `channelOverridesByClient`/`performanceRecordsByClient`), nenhuma query
  // nova só pra canal. Usado hoje pelo diagnóstico do Core recortado por
  // canal de "Prioridades de hoje" (`evaluateClientChannelDiagnostics`,
  // abaixo).
  const channelBreakdownByClient = new Map<string, ClientChannelState[]>(
    (clients ?? []).map((client) => {
      const clientSprintsForChannel = (sprintsByClient.get(client.id) ?? []).map((s) => ({
        sprintId: s.id,
        start_date: s.start_date,
        end_date: s.end_date,
      }));
      const breakdown = resolveClientChannelBreakdown({
        sprints: clientSprintsForChannel,
        dailySpendChannel: dailySpendChannelByClient.get(client.id) ?? [],
        channelSpendOverrides: channelOverridesByClient.get(client.id) ?? [],
        performanceRecords: performanceRecordsByClient.get(client.id) ?? [],
        performanceGoal: client.performance_goal,
        targetCostPerResult: resolvedTargetCostByClient.get(client.id) ?? null,
      });
      return [client.id, breakdown];
    }),
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

  const allCards = rawClients.map((client) => buildOperationClientCard(client, today, monthRange));

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
  const agencyResults = computeHealthResultsSummary(indicatorStates);

  // Etapa "Visão Geral + Reports no Core": "Prioridades de hoje" passa a vir
  // do Motor de Diagnóstico Único (`metric-diagnostics.ts`) — uma linha por
  // CLIENTE, restrito a quem tem ao menos 1 diagnóstico ativo (Planejamento/
  // Investimento/CPA/Pendências; "nenhum diagnóstico" nunca gera prioridade,
  // mesmo espírito do antigo "sem problema não gera item"). Recorte: mesmo
  // conjunto de clientes de `cards` (todos os filtros de recorte já
  // aplicados).
  //
  // Fora do Consolidado, o diagnóstico não pode continuar sendo o
  // CONSOLIDADO disfarçado de "recorte por canal" — Investimento/CPA são
  // reavaliados com `evaluateClientChannelDiagnostics` (mesmas funções do
  // Core, `evaluateInvestmentDiagnostic`/`evaluateCpaDiagnostic`, nunca uma
  // regra nova), usando o investimento/resultado/custo do canal selecionado
  // (`channelBreakdownByClient`, Prioridade 5 da Fase B). Um cliente que não
  // usa o canal selecionado simplesmente não entra (mesma regra que já
  // filtra `cards` pra fora do Consolidado). Planejamento/Pendências são
  // fatos de conta, não de canal — vêm de `state.diagnostics` sem
  // reavaliação em ambos os casos.
  const cardsClientIds = new Set(cards.map((card) => card.clientId));
  const priorityCandidates = clientOperationalStates
    .filter((state) => cardsClientIds.has(state.clientId))
    .flatMap((state) => {
      if (platformFilter === "consolidado") return [{ state, diagnostics: state.diagnostics }];
      const channelState = (channelBreakdownByClient.get(state.clientId) ?? []).find((c) => c.channel === platformFilter);
      if (!channelState) return [];
      const diagnostics = evaluateClientChannelDiagnostics(state, channelState, resolvedTargetCostByClient.get(state.clientId) ?? null);
      return [{ state, diagnostics }];
    })
    .filter(({ diagnostics }) => hasActiveOverviewDiagnostic(diagnostics))
    .sort(
      (a, b) =>
        getDiagnosticPriorityRank(a.diagnostics) - getDiagnosticPriorityRank(b.diagnostics) ||
        a.state.clientName.localeCompare(b.state.clientName),
    );
  const priorityQueue = priorityCandidates
    .map(({ state, diagnostics }) => buildOverviewPriorityItem(state, diagnostics))
    .filter((item): item is OverviewPriorityItem => item !== null);
  const prioritiesTop = priorityQueue.slice(0, 6);
  const prioritiesOpen = params.prioridades === "1";
  const prioritySeverity = (params.prioridadeSeveridade ?? "todos") as OverviewPriorityFilter | "todos";

  const spendRhythm = computeSpendRhythmCounts(cards);
  const outOfRhythmCount = spendRhythm.abaixo + spendRhythm.acima;
  const financial = computeFinancialSummary(cards);
  // Etapa 3: realizado do canal selecionado, somado sobre os clientes já
  // filtrados (que, fora de Consolidado, já são só os que usam essa
  // plataforma — ver filtro acima). `null` quando Consolidado (não usado).
  const channelActualTotal =
    platformFilter !== "consolidado" ? cards.reduce((sum, c) => sum + (c.monthActualByChannel[platformFilter] ?? 0), 0) : null;

  const managersForSummary = isAdmin ? gestores ?? [] : [{ id: profile.id, name: profile.name }];
  const managerSummary = computeManagerSummary(managersForSummary, filteredBase, todayStr);
  // Etapa "Visão Geral + Reports no Core": contadores de diagnóstico do
  // "Resumo por Gestor" migram pro Core — mesmo recorte de `filteredBase`
  // (todos os filtros de recorte já aplicados), só que sobre
  // `ClientOperationalState[]` (que carrega `.diagnostics`) em vez do card
  // legado. Reaproveita `summarizeOperationTriage` (a mesma função que
  // alimenta os contadores da Operação), nunca uma contagem nova.
  const filteredBaseClientIds = new Set(filteredBase.map((card) => card.clientId));
  const diagnosticStatesForSummary = clientOperationalStates.filter((state) => filteredBaseClientIds.has(state.clientId));
  const managerDiagnosticSummaryById = new Map(
    managersForSummary.map((manager) => [
      manager.id,
      summarizeOperationTriage(diagnosticStatesForSummary.filter((state) => state.managerId === manager.id)),
    ]),
  );

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

  // Drill-down "de uma casa só": zera os filtros de recorte (mantendo só
  // mês, gestor e plataforma) e aplica exatamente o filtro clicado — usado
  // pelos indicadores de "Investimento em mídia dos clientes" (os "Indicadores da
  // operação" não têm drill-down de propósito, ver comentário acima do
  // bloco).
  const drillDownUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.month) next.set("month", params.month);
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
    if (platformFilter !== "consolidado") next.set("platform", platformFilter);
    for (const [key, value] of Object.entries(overrides)) {
      next.set(key, value);
    }
    return `/?${next.toString()}`;
  };

  // Abre/fecha o drawer "Ver todas" das Prioridades por cima do que já está
  // na URL (filtros, mês, ordenação) — igual ao drawer de tarefa já usado
  // em Sprints, só que os parâmetros são próprios daqui.
  const prioritiesUrl = (overrides: { prioridades?: string; prioridadeSeveridade?: string }) =>
    buildUrl({ prioridades: overrides.prioridades ?? "", prioridadeSeveridade: overrides.prioridadeSeveridade ?? "" });
  const openPrioritiesHref = prioritiesUrl({ prioridades: "1" });
  const closePrioritiesHref = prioritiesUrl({});
  const prioritiesSeverityHref = (severity: OverviewPriorityFilter | "todos") =>
    prioritiesUrl({ prioridades: "1", prioridadeSeveridade: severity === "todos" ? "" : severity });

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

  return (
    <div className={`min-h-[calc(100dvh_-_3rem)] ${inter.variable}`} style={{ fontFamily: "var(--font-overview)" }}>
      <div className="mx-auto max-w-7xl px-6 py-3">
        <PageHeader
          title="Visão Geral"
          actions={
            <div className="flex items-center gap-0.5 rounded-md border border-overview-border bg-overview-surface px-1 py-1 text-sm">
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
          }
        />

        <div className="mt-2">
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
          />
        </div>

        {/* Refinamento Visual da Visão Geral: o Painel financeiro e
            operacional volta a vir ANTES de Prioridades — o dashboard
            apresenta primeiro a saúde geral da agência (Resultados →
            Investimento → Indicadores) e só depois a fila operacional do
            dia. Por isso passa a abrir expandido por padrão (`open`): o
            que vem primeiro na leitura precisa estar visível sem clique.
            Nenhum dado, cálculo ou link mudou, só a ordem e o estado
            inicial. */}
        <details open className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="flex items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted hover:text-brand sm:px-6">
            Painel financeiro e operacional da agência
            <span className="text-sm">▾</span>
          </summary>

          {/* Facelift "Painel financeiro e operacional": só 4 KPIs de
              destaque máximo (nunca mais números grandes competindo pelo
              mesmo peso visual) — investimento realizado, leads, vendas e
              contas fora do ritmo. CPL/CPA e a contagem de clientes com dado
              (que antes eram KPIs próprios) viraram contexto auxiliar sob o
              KPI de resultado correspondente — mesmo dado de sempre
              (`agencyResults`, `costMetricShortLabel`), só uma apresentação
              por linha em vez de um card à parte. Planejado aparece aqui só
              como auxiliar (nunca no mesmo destaque do realizado) — o
              detalhamento do orçamento vive inteiro em "Ritmo de
              investimento", nunca duplicado com o mesmo peso visual.
              Etapa "Refinamento Visão Geral da Agência": o subtítulo
              "Resultados do mês" saiu — a página já tem título próprio, o
              título desta seção ("Painel financeiro e operacional da
              agência") e o seletor de mês no topo; repetir "do mês" aqui não
              acrescentava contexto novo. Investimento realizado ganhou
              `emphasis` (maior/mais pesado) por ser o indicador financeiro
              principal — os outros 3 continuam equilibrados entre si. */}
          <div className="px-5 py-3 sm:px-6 sm:py-3.5">
            <div className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <OperationMetric
                emphasis
                label="Investimento realizado"
                value={formatCurrency(financial.actual)}
                context={financial.planned > 0 ? `de ${formatCurrency(financial.planned)} planejados` : "Nenhum planejamento configurado"}
              />
              <OperationMetric
                label="Leads gerados"
                value={agencyResults.leads.clientsWithData > 0 ? String(agencyResults.leads.count) : "—"}
                context={
                  agencyResults.leads.clientsWithData > 0
                    ? `${PERFORMANCE_GOALS.leads.costMetricShortLabel} ${
                        agencyResults.leads.costPerResult !== null ? formatCurrency(agencyResults.leads.costPerResult) : "—"
                      } · ${agencyResults.leads.clientsWithData} cliente${agencyResults.leads.clientsWithData !== 1 ? "s" : ""}`
                    : "Nenhum cliente com objetivo de leads configurado"
                }
              />
              <OperationMetric
                label="Vendas geradas"
                value={agencyResults.sales.clientsWithData > 0 ? String(agencyResults.sales.count) : "—"}
                context={
                  agencyResults.sales.clientsWithData > 0
                    ? `${PERFORMANCE_GOALS.sales.costMetricShortLabel} ${
                        agencyResults.sales.costPerResult !== null ? formatCurrency(agencyResults.sales.costPerResult) : "—"
                      } · ${agencyResults.sales.clientsWithData} cliente${agencyResults.sales.clientsWithData !== 1 ? "s" : ""}`
                    : "Nenhum cliente com objetivo de vendas configurado"
                }
              />
              <OperationMetric
                label="Fora do ritmo"
                value={`${outOfRhythmCount} conta${outOfRhythmCount !== 1 ? "s" : ""}`}
                tone={outOfRhythmCount > 0 ? "warning" : "neutral"}
                title={`${spendRhythm.abaixo} abaixo · ${spendRhythm.acima} acima`}
                linkHref={outOfRhythmCount > 0 ? drillDownUrl({ ritmo: "fora_do_ritmo" }) : undefined}
                linkLabel={outOfRhythmCount > 0 ? "Ver contas" : undefined}
              />
            </div>
          </div>

          <div className="border-t border-overview-border px-5 py-2.5 sm:px-6 sm:py-3">
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
                  {/* Etapa "Refinamento Visão Geral da Agência" (Pontos 3/4):
                      "Esperado hoje" (valor)/"Orçamento utilizado"/"Sem
                      planejamento" saíram — a barra já comunica visualmente
                      o ritmo (preenchimento + marcador + legenda "Realizado"/
                      "Esperado hoje", renderizados dentro de `ProgressBar`),
                      então repetir os mesmos números embaixo era redundância
                      pura. O que antes era só "R$ X abaixo" (um número
                      isolado) virou uma frase de STATUS em destaque
                      (`investmentStatusPhrase`) com o valor como apoio
                      secundário logo abaixo — nenhum cálculo mudou
                      (`investmentDiff`/`investmentRitmoStatus` intactos). */}
                  <div className="mt-1.5">
                    <ProgressBar
                      planned={financial.planned}
                      actual={financial.actual}
                      expectedToDate={financial.expectedToDate}
                      monthTemporalStatus={monthTemporalStatus}
                    />
                  </div>

                  <div className="mt-2">
                    <p
                      className={`text-[14px] font-semibold ${
                        investmentDiffTone === "danger"
                          ? "text-overview-danger"
                          : investmentDiffTone === "warning"
                            ? "text-overview-warning"
                            : "text-overview-text-primary"
                      }`}
                    >
                      {investmentStatusPhrase}
                    </p>
                    {investmentDiffValueText && (
                      <p
                        className={`mt-0.5 text-[13px] tabular-nums ${
                          investmentDiffTone === "danger"
                            ? "text-overview-danger"
                            : investmentDiffTone === "warning"
                              ? "text-overview-warning"
                              : "text-overview-text-muted"
                        }`}
                      >
                        {investmentDiffValueText}
                      </p>
                    )}
                  </div>
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

          <div className="border-t border-overview-border bg-overview-surface-subtle px-5 py-2 sm:px-6 sm:py-2.5">
            {/* Facelift "Painel financeiro e operacional": os 4 indicadores
                deixam de ser big numbers (22px, mesmo peso de
                Resultados/Ritmo) e viram uma faixa compacta de mini-KPIs —
                a operação é contexto de apoio, não outro conjunto de
                números competindo por destaque. Mesmos 4 dados de sempre
                (`operationIndicators`), só reagrupados: tarefas concluídas/
                previstas juntas num único valor ("121/140"), com o % de
                execução como texto secundário abaixo (nunca um KPI à
                parte).
                Etapa "Refinamento Visão Geral da Agência" (Ponto 6): fundo
                sutilmente diferenciado + padding/gap reduzidos + tipografia
                de `OperationMiniKpi` um pouco menor — reforça a leitura de
                "rodapé da seção", nunca competindo com os KPIs financeiros
                acima. Nenhum dado mudou. */}
            <SectionHeader title="Operação" />
            <div className="mt-2 grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-4">
              <OperationMiniKpi label="Clientes ativos" value={String(operationIndicators.activeClientsCount)} />
              {/* Rótulo fixo "Gestores vinculados" (em vez de
                  `operationIndicators.managersLabel`, que alterna com
                  "Gestores ativos"): reduz a impressão de erro quando o
                  número é 0 — hoje alguns responsáveis principais são
                  `admin`, não `gestor`, e por isso ficam fora da contagem
                  por regra deliberada (nunca contar admin como gestor). Só
                  o texto mudou; `activeManagersCount` continua exatamente o
                  mesmo cálculo. Decisão sobre incluir admins responsáveis
                  por conta fica para uma etapa separada. */}
              <OperationMiniKpi label="Gestores vinculados" value={String(operationIndicators.activeManagersCount)} />
              <OperationMiniKpi
                label="Tarefas"
                value={`${operationIndicators.completedTasksCount}/${operationIndicators.tasksTotalCount}`}
                context={operationIndicators.completionRatePct !== null ? `${formatPercent(operationIndicators.completionRatePct)} concluídas` : undefined}
              />
              <OperationMiniKpi label="Revisões" value={String(operationIndicators.optimizationsCount)} />
            </div>
          </div>
        </details>

        {/* Módulo "Pendências": lembretes rápidos e leves (agência/cliente),
            deliberadamente fora do painel financeiro/operacional acima (que
            fica atrás do accordion) — como envolve ações (adicionar/concluir/
            editar), não pode ficar escondido atrás de um toggle. Fica antes
            de Prioridades por ser o item mais "acionável agora". Nunca mistura
            com tarefas/sprints: ver `src/lib/reminders.ts`. */}
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

        {/* Refinamento Visual da Visão Geral: Prioridades passa a vir
            DEPOIS do panorama geral da agência (acima) — primeiro "como
            está a saúde da agência", só então "o que exige atenção agora".
            Nenhum dado, cálculo ou link mudou, só a posição na página. */}
        <div className="mt-3">
          <PrioritiesPanel
            priorities={prioritiesTop}
            managerNameByClient={primaryManagerNameByClient}
            totalCount={priorityQueue.length}
            viewAllHref={openPrioritiesHref}
          />
        </div>

        {prioritiesOpen && (
          <PrioritiesDrawer
            priorities={priorityQueue}
            managerNameByClient={primaryManagerNameByClient}
            severity={prioritySeverity}
            closeHref={closePrioritiesHref}
            buildSeverityHref={prioritiesSeverityHref}
          />
        )}

        {/* Análises secundárias — fora do primeiro viewport de propósito */}
        <details className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="flex items-center justify-between px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted hover:text-brand">
            Ver análises adicionais
            <span className="text-sm">▾</span>
          </summary>

          <div className="border-t border-overview-border p-3.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">
              {isAdmin ? "Operação por gestor" : "Minha operação"}
            </h3>
            {/* Etapa "MITZA 2.0 — Fase E": resumo compacto por gestor (cards),
                substitui a tabela de 10 colunas — mesmos dados de sempre
                (`computeManagerSummary`), nenhum cálculo novo, só o formato.
                Etapa "Visão Geral + Reports no Core": a linha de diagnóstico
                (antes Saudável/Atenção/Crítico, Sistema B) passa a vir do
                Core (`summarizeOperationTriage`, `managerDiagnosticSummaryById`
                acima) — "inativo" continua vindo de `computeManagerSummary`
                sem alteração: é `activityStatus` (dias úteis sem atividade,
                `operational-activity.ts`), um eixo independente que nunca
                fez parte do modelo de saúde legado. */}
            {managerSummary.length > 0 ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {managerSummary.map((row) => {
                  const diagSummary = managerDiagnosticSummaryById.get(row.id);
                  return (
                    <div key={row.id} className="rounded-md border border-overview-border px-3 py-2.5">
                      <div className="font-medium text-overview-text-primary">
                        {isAdmin ? (
                          <Button href={drillDownUrl({ manager: row.id })} variant="ghost" size="sm" className="h-auto px-0 py-0 font-medium">
                            {row.name}
                          </Button>
                        ) : (
                          row.name
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-overview-text-secondary">
                        <span>{row.totalClients} cliente{row.totalClients !== 1 ? "s" : ""}</span>
                        <span>{diagSummary?.withPlanejamentoIncompleto ?? 0} planejamento</span>
                        <span>{diagSummary?.withInvestmentOff ?? 0} investimento</span>
                        <span>{diagSummary?.withCpaOff ?? 0} CPA</span>
                        <span>{diagSummary?.withPendencias ?? 0} pendências</span>
                        <span>{row.portfolio.inativos} inativo{row.portfolio.inativos !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-overview-text-muted">
                        <span>{row.semExecucao} sem execução</span>
                        <span>{row.atrasadas} atrasada{row.atrasadas !== 1 ? "s" : ""}</span>
                        <span>{row.paraHoje} hoje</span>
                        <span>Execução: {row.taxaExecucao !== null ? `${Math.round(row.taxaExecucao)}%` : "—"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Nenhum gestor encontrado." className="mt-2" />
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
