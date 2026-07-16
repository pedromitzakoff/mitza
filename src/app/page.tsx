import { Inter } from "next/font/google";
import { getCurrentProfile } from "@/lib/auth";
import { perfNow, perfLog } from "@/lib/perf-log";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import {
  currentMonthRange,
  findSprintForDate,
  isDateWithinPeriod,
  monthRangeFromParam,
  shiftMonthParam,
} from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel, formatPercent } from "@/lib/format";
import { computeMonthlyExpectedPct, getMonthTemporalStatus } from "@/lib/monthly-budget";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import {
  computeAgencyResultsSummary,
  computeFinancialSummary,
  computeManagerSummary,
  computeSpendRhythmCounts,
} from "@/lib/agency-metrics";
import { buildClientPriorityQueue, sortCardsByPriority } from "@/lib/client-priority";
import type { PerformanceChannelScope } from "@/lib/performance";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { computeOperationIndicators } from "@/lib/operation-indicators";
import { AgencyFilters, type AgencyClientOption } from "./agency-filters";
import { PrioritiesDrawer, PrioritiesPanel } from "./priorities-panel";
import { OperationMetric } from "./operation-metric";
import { PrimaryInvestmentMetric, SecondaryInvestmentMetric } from "./investment-metric";
import { ClientObjectiveTable, ClientObjectiveTablesEmptyState, PLATFORM_LABEL } from "./client-objective-table";
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
 * de Filtros (que continua com as 4 opções reais), só via link direto,
 * mesmo padrão já usado por `sprintBucket`/`sync`/`meta`. */
type RitmoFilter = "todos" | SpendStatus | "fora_do_ritmo";
type TasksFilter = "todas" | "atrasadas" | "sem_atrasadas";
/** Filtro de plataforma (Etapa 3 — MVP plataformas): "consolidado" é o
 * estado inicial e o único em que ritmo financeiro/planejado/prioridades
 * fazem sentido (não existe orçamento configurado por canal ainda — só
 * investimento REALIZADO, resultados e CPL/CPA têm uma fonte por canal). */
type PlatformFilter = "consolidado" | "meta" | "google";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    manager?: string;
    client?: string;
    health?: string;
    activity?: string;
    ritmo?: string;
    tasks?: string;
    sprintBucket?: string;
    sync?: string;
    meta?: string;
    sort?: string;
    prioridades?: string;
    prioridadeSeveridade?: string;
    platform?: string;
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
  const healthFilter = (params.health ?? "todos") as AccountHealth | "todos";
  const activityFilter = (params.activity ?? "todos") as OperationalActivityStatus | "todos";
  const ritmoFilter = (params.ritmo ?? "todos") as RitmoFilter;
  const tasksFilter = (params.tasks ?? "todas") as TasksFilter;
  const sprintBucketFilter = params.sprintBucket as SprintFilterBucket | undefined;
  const platformFilter = (params.platform ?? "consolidado") as PlatformFilter;
  const syncFilter = params.sync;
  const metaFilter = params.meta;
  const sort = params.sort ?? "prioridade";

  const supabase = await createSupabaseClient();

  // Etapa "Indicadores da operação": janela do mês selecionado em
  // timestamptz — mesma conversão já usada em account_reviews na página do
  // cliente (`${firstDay}T00:00:00Z` / até o fim do último dia).
  const indicatorsMonthStart = `${monthRange.firstDay}T00:00:00Z`;
  const indicatorsMonthEnd = `${monthRange.lastDay}T23:59:59.999Z`;

  const __perfBlock1Start = perfNow();
  const [
    { data: clients },
    { data: gestores },
    { data: sprints },
    { data: dailySpend },
    { data: tasks },
    { data: plannedAllocations },
    { data: budgetChanges },
    { data: teamMembersForIndicators },
    { data: completedTasksForIndicators },
    { data: reviewsForIndicators },
    { data: channelSpendOverrides },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, meta_ad_account_id, status, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
    // Sobreposição com a janela (não "começa na janela") — uma sprint que
    // atravessa mês (ex.: 27/jul-02/ago) precisa ser encontrada mesmo com
    // start_date fora do intervalo, senão sua parcela do outro mês some.
    supabase
      .from("sprints")
      .select(
        "id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at",
      )
      .lte("start_date", rangeEnd)
      .gte("end_date", rangeStart),
    supabase
      .from("daily_spend")
      .select("client_id, date, channel, spend, synced_at")
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
    // não da janela união com o mês corrente: `buildOperationClientCard` só
    // usa `monthRange` pra montar o card, nunca `rangeStart`/`rangeEnd`.
    supabase
      .from("monthly_budget_changes")
      .select("client_id, new_amount, changed_at")
      .eq("month", monthRange.firstDay),
    // Consulta própria (independente de `gestores`, que serve o dropdown de
    // filtro e não pode ter seu comportamento alterado): precisa do papel de
    // cada membro pra nunca contar admin como gestor no indicador "Gestores
    // ativos".
    supabase.from("team_members").select("id, system_role, status"),
    supabase
      .from("tasks")
      .select("client_id")
      .not("completed_at", "is", null)
      .gte("completed_at", indicatorsMonthStart)
      .lte("completed_at", indicatorsMonthEnd),
    supabase
      .from("account_reviews")
      .select("client_id")
      .gte("reviewed_at", indicatorsMonthStart)
      .lte("reviewed_at", indicatorsMonthEnd),
    // Etapa 3 (MVP plataformas): override manual de gasto real por
    // sprint+canal — mesmo padrão de `sprints` acima (sem filtro de data,
    // volume pequeno e escopado por sprint, não por dia).
    supabase.from("sprint_channel_spend").select("client_id, sprint_id, channel, spend_source, manual_actual_spend"),
  ]);
  perfLog("visão geral bloco 1 (11 queries)", __perfBlock1Start);

  const clientIds = (clients ?? []).map((c) => c.id);
  const currentSprintIds = (sprints ?? [])
    .filter((s) => isDateWithinPeriod(todayStr, s.start_date, s.end_date))
    .map((s) => s.id);
  // Etapa 71: registros de performance são sempre por sprint — buscar por
  // sprint_id (não por período) evita depender de duplicar a lógica de
  // sobreposição de datas já usada acima pras sprints em si.
  const monthSprintIdsForPerformance = (sprints ?? [])
    .filter((s) => s.start_date <= monthRange.lastDay && s.end_date >= monthRange.firstDay)
    .map((s) => s.id);

  const __perfBlock2Start = perfNow();
  const [{ data: clientActivity }, { data: sprintActivity }, { data: performanceRecords }, { data: lastReviews }] =
    await Promise.all([
      clientIds.length > 0
        ? supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds)
        : Promise.resolve({ data: [] }),
      currentSprintIds.length > 0
        ? supabase.from("sprint_last_operational_activity").select("sprint_id, last_activity_at").in("sprint_id", currentSprintIds)
        : Promise.resolve({ data: [] }),
      monthSprintIdsForPerformance.length > 0
        ? supabase
            .from("performance_records")
            .select("client_id, sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", monthSprintIdsForPerformance)
        : Promise.resolve({ data: [] }),
      // Etapa 74 — "Última otimização": sempre o dado GLOBAL mais recente por
      // cliente (independe do mês selecionado), por isso uma busca própria
      // sem filtro de data — mesma fonte usada no Acompanhamento da Conta.
      // Navigation Performance & Perceived Speed 1.0: não depende de nada
      // deste Promise.all, só de clientIds (pronto desde o bloco anterior) —
      // por isso entra aqui em vez de ser um round-trip sequencial à parte.
      clientIds.length > 0
        ? supabase
            .from("account_reviews")
            .select("client_id, reviewed_at")
            .in("client_id", clientIds)
            .order("reviewed_at", { ascending: false })
        : Promise.resolve({ data: [] }),
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
      targetCostPerResult: client.target_cost_per_result,
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

  // Filtros que respeitam tudo, exceto gestor — permite comparar gestores
  // no bloco "Resumo por Gestor" com o mesmo recorte de status/atividade
  // aplicado no resto do dashboard.
  let filteredBase = allCards;

  if (healthFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.accountHealth === healthFilter);
  }
  if (activityFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.activityStatus === activityFilter);
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
  if (tasksFilter === "atrasadas") {
    filteredBase = filteredBase.filter((card) => card.taskCounts.overdue > 0);
  } else if (tasksFilter === "sem_atrasadas") {
    filteredBase = filteredBase.filter((card) => card.taskCounts.overdue === 0);
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
  // Etapa "Executive Dashboard 1.0" — resultado consolidado (leads/vendas/
  // CPL/CPA), mesmo recorte de mês/carteira/cliente de `operationIndicators`
  // (`indicatorCards`), nunca os filtros de recorte de `cards`.
  const agencyResults = computeAgencyResultsSummary(indicatorCards);

  // Prioridade de cada cliente — uma única fonte (buildClientPriorityQueue,
  // MVP "Reformular Prioridades na Visão Geral"), reaproveitada pelo bloco
  // "Prioridades de hoje" e pela ordenação padrão da tabela. A tabela em si
  // não exibe mais uma coluna própria de severidade (Etapa 49 removeu
  // "Prioridade" por duplicar "Status" sem contexto adicional).
  //
  // `performanceScope`: custo por resultado já tem investimento real por
  // canal (Etapa 2/3), então continua disponível fora do Consolidado; ritmo
  // financeiro (a outra metade da fila) continua exclusividade do
  // Consolidado — não existe orçamento configurado por canal ainda (mesma
  // decisão da Etapa de filtro de plataforma). `buildClientPriorityQueue`
  // já sabe disso e nunca gera item de ritmo fora do Consolidado.
  const performanceScope: PerformanceChannelScope = platformFilter === "consolidado" ? "consolidated" : platformFilter;
  const priorityQueue = buildClientPriorityQueue(cards, performanceScope);
  const prioritiesTop = priorityQueue.slice(0, 6);
  const prioritiesOpen = params.prioridades === "1";
  const prioritySeverity = (params.prioridadeSeveridade ?? "todos") as AccountHealth | "todos";

  const sortedCards =
    sort === "nome" ? [...cards].sort((a, b) => a.clientName.localeCompare(b.clientName)) : sortCardsByPriority(cards, performanceScope);

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

  const investmentDiff = financial.actual - financial.expectedToDate;
  const investmentRitmoStatus =
    financial.planned > 0 ? classifySpendStatus(financial.actual, financial.expectedToDate, financial.planned) : "sem_meta";
  const investmentDiffTone: StatusTone =
    investmentRitmoStatus === "acima" ? "danger" : investmentRitmoStatus === "abaixo" ? "warning" : "neutral";
  // Etapa 68, seção 3: "% esperado hoje" é o mesmo avanço de calendário do
  // mês SELECIONADO pra qualquer cliente do recorte (nunca uma média dos
  // percentuais esperados por cliente, nunca derivado das sprints) — por
  // isso não soma nada por cliente, só aplica `computeMonthlyExpectedToDateByCalendar`
  // uma vez sobre o mês em exibição.
  const investmentExpectedPct = computeMonthlyExpectedPct(monthRange, todayStr);
  const investmentDiffLabel =
    financial.planned > 0
      ? investmentDiff < 0
        ? `${formatCurrency(Math.abs(investmentDiff))} abaixo`
        : investmentDiff > 0
          ? `${formatCurrency(investmentDiff)} acima`
          : "Dentro do esperado"
      : "—";
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
    if (healthFilter !== "todos") next.set("health", healthFilter);
    if (activityFilter !== "todos") next.set("activity", activityFilter);
    if (ritmoFilter !== "todos") next.set("ritmo", ritmoFilter);
    if (tasksFilter !== "todas") next.set("tasks", tasksFilter);
    if (sprintBucketFilter) next.set("sprintBucket", sprintBucketFilter);
    if (syncFilter) next.set("sync", syncFilter);
    if (metaFilter) next.set("meta", metaFilter);
    if (sort !== "prioridade") next.set("sort", sort);
    if (platformFilter !== "consolidado") next.set("platform", platformFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  };

  // Drill-down "de uma casa só": zera os filtros de recorte (mantendo só
  // mês, gestor e plataforma) e aplica exatamente o filtro clicado — usado
  // pelos indicadores de "Controle de investimento" (os "Indicadores da
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
  const prioritiesSeverityHref = (severity: AccountHealth | "todos") =>
    prioritiesUrl({ prioridades: "1", prioridadeSeveridade: severity === "todos" ? "" : severity });

  const monthLabel = formatMonthLabel(monthRange.firstDay);

  return (
    <div className={`min-h-[calc(100dvh_-_3rem)] bg-overview-bg ${inter.variable}`} style={{ fontFamily: "var(--font-overview)" }}>
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
            health={healthFilter}
            activity={activityFilter}
            ritmo={ritmoFilter === "fora_do_ritmo" ? "todos" : ritmoFilter}
            tasks={tasksFilter}
            platform={platformFilter}
            preserved={{
              month: params.month,
              sprintBucket: sprintBucketFilter,
              sync: syncFilter,
              meta: metaFilter,
              sort: sort !== "prioridade" ? sort : undefined,
            }}
          />
        </div>

        {/* MITZA Operational Workspace 2.0 (Partes 2/4): Prioridade sobe pra
            logo depois dos filtros, antes de qualquer consulta agregada —
            "o que exige minha atenção?" responde primeiro; "como estão os
            números da agência?" (bloco financeiro/operacional logo abaixo,
            agora recolhível) é consulta, não decisão. Nenhum dado, cálculo
            ou link mudou, só a ordem e o destaque. */}
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

        {/* Refinamento de Densidade, Hierarquia e Contexto Operacional
            (Parte 4) — nova ordem interna: Resultados (o que estamos
            gerando) → Investimento (quanto e como) → Operação (como está a
            execução). Nenhum cálculo mudou, só a hierarquia visual — as 3
            seções continuam compartilhando a mesma superfície contínua
            (Etapa 69), só a ordem das divisórias mudou pra acompanhar.
            MITZA Operational Workspace 2.0: todo o bloco virou uma
            consulta recolhível — Prioridade (acima) já responde "o que
            exige atenção", este painel responde "como estão os números",
            uma pergunta de consulta, não de decisão (mesmo tratamento já
            dado à "Ver análises adicionais", logo abaixo). */}
        <details className="mt-2.5 overflow-hidden rounded-lg border border-overview-border bg-overview-surface [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="flex items-center justify-between px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted hover:text-brand sm:px-6">
            Painel financeiro e operacional da agência
            <span className="text-sm">▾</span>
          </summary>

          {/* Etapa "Executive Dashboard 1.0" — complementa os indicadores
              operacionais/financeiros abaixo com uma dimensão de RESULTADO
              (leads/vendas/CPL/CPA), derivada de `performance_records` já
              buscado (nenhuma consulta nova). Cliente sem objetivo de
              performance configurado, ou sem nenhum registro lançado no mês,
              nunca contribui um "0" fabricado — some da soma, e o card some
              "—" quando ninguém no recorte tem dado. Receita/ROAS não
              aparecem aqui: nenhuma tabela da plataforma guarda valor
              monetário de resultado hoje, só contagem (ver relatório da
              etapa) — mostrar essas duas como "Não configurado" seria dar a
              entender que a métrica existe e está vazia, quando na verdade
              a plataforma ainda não tem de onde tirar esse número. */}
          <div className="px-5 py-3.5 sm:px-6 sm:py-4">
            <SectionHeader title="Resultados da agência" />
            <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <OperationMetric
                label="Leads gerados"
                value={agencyResults.leads.clientsWithData > 0 ? String(agencyResults.leads.count) : "—"}
                context={
                  agencyResults.leads.clientsWithData > 0
                    ? `${agencyResults.leads.clientsWithData} cliente${agencyResults.leads.clientsWithData !== 1 ? "s" : ""} com dado no mês`
                    : "Nenhum cliente com objetivo de leads configurado"
                }
              />
              <OperationMetric
                label={PERFORMANCE_GOALS.leads.costMetricLabel}
                value={agencyResults.leads.costPerResult !== null ? formatCurrency(agencyResults.leads.costPerResult) : "—"}
                context="Investimento somado ÷ leads somados"
              />
              <OperationMetric
                label="Vendas geradas"
                value={agencyResults.sales.clientsWithData > 0 ? String(agencyResults.sales.count) : "—"}
                context={
                  agencyResults.sales.clientsWithData > 0
                    ? `${agencyResults.sales.clientsWithData} cliente${agencyResults.sales.clientsWithData !== 1 ? "s" : ""} com dado no mês`
                    : "Nenhum cliente com objetivo de vendas configurado"
                }
              />
              <OperationMetric
                label={PERFORMANCE_GOALS.sales.costMetricLabel}
                value={agencyResults.sales.costPerResult !== null ? formatCurrency(agencyResults.sales.costPerResult) : "—"}
                context="Investimento somado ÷ vendas somadas"
              />
            </div>
          </div>

          <div className="border-t border-overview-border px-5 py-3.5 sm:px-6 sm:py-4">
            <SectionHeader
              title={platformFilter === "consolidado" ? "Controle de investimento" : `Investimento · ${PLATFORM_LABEL[platformFilter]}`}
            />

            {platformFilter === "consolidado" ? (
              <>
                {/* Camada 1 — os números que o olhar deve encontrar primeiro. */}
                <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-3">
                  <PrimaryInvestmentMetric label="Planejado" value={formatCurrency(financial.planned)} />
                  <PrimaryInvestmentMetric label="Realizado" value={formatCurrency(financial.actual)} />
                  <PrimaryInvestmentMetric
                    label="Orçamento utilizado"
                    value={financial.pct !== null ? formatPercent(financial.pct) : "—"}
                    size="md"
                  />
                </div>

                {/* Camada 2 — contexto de ritmo, deliberadamente mais discreto. */}
                <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SecondaryInvestmentMetric
                    label="Esperado hoje"
                    value={formatPercent(investmentExpectedPct)}
                    title="dia_atual / dias_do_mês — igual para qualquer cliente do recorte, nunca uma média de percentuais por cliente. Não depende de nenhum orçamento estar configurado."
                  />
                  <SecondaryInvestmentMetric label="Esperado em investimento" value={formatCurrency(financial.expectedToDate)} />
                  <SecondaryInvestmentMetric
                    label="Diferença para o esperado"
                    value={investmentDiffLabel}
                    tone={financial.planned > 0 ? investmentDiffTone : "neutral"}
                  />
                  <SecondaryInvestmentMetric
                    label="Contas fora do ritmo"
                    value={String(outOfRhythmCount)}
                    href={drillDownUrl({ ritmo: "fora_do_ritmo" })}
                    tone={outOfRhythmCount > 0 ? "warning" : "neutral"}
                    title={`${spendRhythm.abaixo} abaixo · ${spendRhythm.acima} acima`}
                  />
                </div>

                <div className="mt-4">
                  <ProgressBar
                    planned={financial.planned}
                    actual={financial.actual}
                    expectedToDate={financial.expectedToDate}
                    monthTemporalStatus={monthTemporalStatus}
                  />
                </div>

                <div className="mt-2.5">
                  {financial.semMeta > 0 ? (
                    <Button
                      href={drillDownUrl({ meta: "sem" })}
                      variant="ghost"
                      size="sm"
                      className="h-auto px-0 py-0 text-[13px] font-normal text-overview-text-muted underline decoration-overview-border hover:text-overview-text-secondary"
                    >
                      {financial.semMeta} cliente{financial.semMeta !== 1 ? "s" : ""} sem planejamento configurado
                    </Button>
                  ) : (
                    <p className="text-[13px] text-overview-text-muted">Todos os clientes possuem planejamento configurado</p>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Etapa 3: fora do Consolidado só existe investimento
                    REALIZADO por plataforma — planejado/esperado/ritmo
                    dependem de um orçamento que ainda não é configurado por
                    canal (ver decisão registrada no relatório da etapa). */}
                <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-3">
                  <PrimaryInvestmentMetric label={`Realizado · ${PLATFORM_LABEL[platformFilter]}`} value={formatCurrency(channelActualTotal ?? 0)} />
                </div>
                <p className="mt-2.5 text-[13px] text-overview-text-muted">
                  Planejado e ritmo financeiro disponíveis só no recorte Consolidado — ainda não há orçamento configurado por plataforma.
                </p>
              </>
            )}
          </div>

          <div className="border-t border-overview-border px-5 py-3.5 sm:px-6 sm:py-4">
            <SectionHeader title="Indicadores da operação" />
            <div className="mt-3 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <OperationMetric
                label="Clientes ativos"
                value={String(operationIndicators.activeClientsCount)}
                context="Clientes em operação"
              />
              <OperationMetric
                label={operationIndicators.managersLabel}
                value={String(operationIndicators.activeManagersCount)}
                context="Responsáveis por contas"
              />
              <OperationMetric
                label="Execução de tarefas"
                value={
                  operationIndicators.completionRatePct !== null
                    ? formatPercent(operationIndicators.completionRatePct)
                    : "—"
                }
                context={`${operationIndicators.completedTasksCount} de ${operationIndicators.tasksTotalCount} concluídas`}
              />
              {/* MVP Etapa "Indicadores operacionais e refinamento visual":
                  rótulo direto ("Revisões de conta no mês", renomeado de
                  "Otimizações no mês" na etapa "MITZA Platform Constitution
                  1.0") em vez do genérico "Atividade operacional" — mesmo
                  dado de sempre (optimizationsCount, um registro de
                  account_reviews = uma revisão, nunca contado duas vezes),
                  só o nome deixa de esconder o que o número mede. */}
              <OperationMetric
                label="Revisões de conta no mês"
                value={`${operationIndicators.optimizationsCount} revisões`}
                context="Revisões estratégicas registradas"
              />
            </div>
          </div>
        </details>

        {/* MVP "Reformular a tabela de clientes": a tabela única (Etapa 49)
            vira 2 tabelas por objetivo da conta — "Clientes de leads" e
            "Clientes de vendas", mesmo componente parametrizado
            (`ClientObjectiveTable`), cada uma só aparece se tiver cliente.
            Um 3º grupo (sem objetivo configurado) preserva clientes legados
            sem `performance_goal` — nenhum cliente do recorte pode sumir da
            tela. A ordenação ("Ordenar por prioridade"/nome) é uma única
            control acima das 3 tabelas — ordena `sortedCards` inteiro antes
            de dividir por objetivo, nunca uma ordem própria por tabela. */}
        <div className="mt-3 flex items-center justify-between px-0.5">
          <span className="text-xs text-overview-text-muted">
            {sortedCards.length} cliente{sortedCards.length !== 1 ? "s" : ""} no recorte
            {platformFilter !== "consolidado" ? ` · ${PLATFORM_LABEL[platformFilter]}` : ""}
          </span>
          <Button href={buildUrl({ sort: sort === "nome" ? "prioridade" : "nome" })} variant="ghost" size="sm">
            Ordenar por {sort === "nome" ? "prioridade" : "nome"}
          </Button>
        </div>

        {sortedCards.length > 0 ? (
          <>
            <ClientObjectiveTable
              cards={sortedCards.filter((c) => c.performanceGoal === "leads")}
              objective="leads"
              platformFilter={platformFilter}
              primaryManagerNameByClient={primaryManagerNameByClient}
            />
            <ClientObjectiveTable
              cards={sortedCards.filter((c) => c.performanceGoal === "sales")}
              objective="sales"
              platformFilter={platformFilter}
              primaryManagerNameByClient={primaryManagerNameByClient}
            />
            <ClientObjectiveTable
              cards={sortedCards.filter((c) => !c.performanceGoal)}
              objective={null}
              platformFilter={platformFilter}
              primaryManagerNameByClient={primaryManagerNameByClient}
            />
          </>
        ) : (
          <ClientObjectiveTablesEmptyState />
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
          {managerSummary.length > 0 ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-overview-border text-left text-[11px] uppercase tracking-wide text-overview-text-muted">
                    <th className="py-1.5 px-3">Gestor</th>
                    <th className="py-1.5 px-3">Clientes</th>
                    <th className="py-1.5 px-3">Saudáveis</th>
                    <th className="py-1.5 px-3">Atenção</th>
                    <th className="py-1.5 px-3">Críticos</th>
                    <th className="py-1.5 px-3">Inativos</th>
                    <th className="py-1.5 px-3">Sem execução</th>
                    <th className="py-1.5 px-3">Atrasadas</th>
                    <th className="py-1.5 px-3">Hoje</th>
                    <th className="py-1.5 px-3">Execução</th>
                  </tr>
                </thead>
                <tbody>
                  {managerSummary.map((row) => (
                    <tr key={row.id} className="border-b border-overview-border/70 last:border-0">
                      <td className="py-1.5 px-3 font-medium text-overview-text-primary">
                        {isAdmin ? (
                          <Button href={drillDownUrl({ manager: row.id })} variant="ghost" size="sm" className="h-auto px-0 py-0 font-medium">
                            {row.name}
                          </Button>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.totalClients}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.portfolio.saudaveis}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.portfolio.atencao}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.portfolio.criticos}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.portfolio.inativos}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.semExecucao}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.atrasadas}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">{row.paraHoje}</td>
                      <td className="py-1.5 px-3 text-overview-text-secondary">
                        {row.taxaExecucao !== null ? `${Math.round(row.taxaExecucao)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
