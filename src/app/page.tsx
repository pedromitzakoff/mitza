import { Inter } from "next/font/google";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import {
  currentMonthRange,
  findSprintForDate,
  isDateWithinPeriod,
  monthRangeFromParam,
  shiftMonthParam,
} from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { computeFinancialSummary, computeManagerSummary, computeSpendRhythmCounts } from "@/lib/agency-metrics";
import { getClientPriority, sortClientPriorities } from "@/lib/client-priority";
import { computeOperationIndicators } from "@/lib/operation-indicators";
import { AgencyFilters, type AgencyClientOption } from "./agency-filters";
import { PrioritiesDrawer, PrioritiesPanel } from "./priorities-panel";
import { Button, IconButton } from "@/components/workspace/button";
import { Metric } from "@/components/workspace/metric";
import { ProgressBar } from "@/components/workspace/progress-bar";
import { PageHeader } from "@/components/workspace/page-header";
import { SectionHeader } from "@/components/workspace/section-header";
import { EmptyState } from "@/components/workspace/empty-state";
import { StatusDot, type StatusTone } from "@/components/workspace/status-dot";

/**
 * Etapa 47: Inter carregada e aplicada SÓ na Visão Geral (className no
 * wrapper raiz da página, não em layout.tsx) — nenhuma outra tela herda
 * essa fonte. O `body` global continua com o font-family de sempre.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-overview" });

/** Rótulos da "situação" financeira do mês — mesma classificação de sempre
 * (card.monthStatus, ±10% central). */
const SITUATION_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
  em_andamento: "Em andamento",
};

const SITUATION_TONE: Record<SpendStatus, StatusTone> = {
  dentro: "success",
  acima: "danger",
  abaixo: "warning",
  sem_meta: "neutral",
  nao_iniciado: "neutral",
  em_andamento: "neutral",
};

type ManagerFilter = "all" | "me" | string;
/** "fora_do_ritmo" é só um atalho de drill-down (abaixo + acima combinados)
 * pro indicador "Contas fora do ritmo" — não aparece como opção no popover
 * de Filtros (que continua com as 4 opções reais), só via link direto,
 * mesmo padrão já usado por `sprintBucket`/`sync`/`meta`. */
type RitmoFilter = "todos" | SpendStatus | "fora_do_ritmo";
type TasksFilter = "todas" | "atrasadas" | "sem_atrasadas";

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
  }>;
}) {
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
  const syncFilter = params.sync;
  const metaFilter = params.meta;
  const sort = params.sort ?? "prioridade";

  const supabase = await createSupabaseClient();

  // Etapa "Indicadores da operação": janela do mês selecionado em
  // timestamptz — mesma conversão já usada em account_reviews na página do
  // cliente (`${firstDay}T00:00:00Z` / até o fim do último dia).
  const indicatorsMonthStart = `${monthRange.firstDay}T00:00:00Z`;
  const indicatorsMonthEnd = `${monthRange.lastDay}T23:59:59.999Z`;

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
    { data: optimizationsForIndicators },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, meta_ad_account_id, status, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
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
      .select("client_id, date, spend, synced_at")
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
    supabase
      .from("account_optimizations")
      .select("client_id")
      .gte("created_at", indicatorsMonthStart)
      .lte("created_at", indicatorsMonthEnd),
  ]);

  const clientIds = (clients ?? []).map((c) => c.id);
  const currentSprintIds = (sprints ?? [])
    .filter((s) => isDateWithinPeriod(todayStr, s.start_date, s.end_date))
    .map((s) => s.id);

  const [{ data: clientActivity }, { data: sprintActivity }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds)
      : Promise.resolve({ data: [] }),
    currentSprintIds.length > 0
      ? supabase.from("sprint_last_operational_activity").select("sprint_id, last_activity_at").in("sprint_id", currentSprintIds)
      : Promise.resolve({ data: [] }),
  ]);

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
    list.push({ newAmount: c.new_amount, changedAt: c.changed_at });
    budgetChangesByClient.set(c.client_id, list);
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
  if (ritmoFilter === "fora_do_ritmo") {
    filteredBase = filteredBase.filter((card) => card.monthStatus === "abaixo" || card.monthStatus === "acima");
  } else if (ritmoFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.monthStatus === ritmoFilter);
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
    optimizationClientIds: (optimizationsForIndicators ?? []).map((o) => o.client_id),
    hasClientFilter: Boolean(clientFilter),
  });

  // Prioridade de cada cliente — uma única fonte (getClientPriority),
  // reaproveitada pelo bloco "Prioridades de hoje" e pela ordenação padrão
  // da tabela (severidade primeiro). A tabela em si não exibe mais uma
  // coluna própria de severidade (Etapa 49 removeu "Prioridade" por
  // duplicar "Status" sem contexto adicional).
  const cardById = new Map(cards.map((c) => [c.clientId, c]));
  const allPriorities = cards.map((card) => getClientPriority(card, today));
  const priorityQueue = sortClientPriorities(allPriorities.filter((p) => p.primaryIssue !== null));
  const prioritiesTop = priorityQueue.slice(0, 6);
  const prioritiesOpen = params.prioridades === "1";
  const prioritySeverity = (params.prioridadeSeveridade ?? "todos") as AccountHealth | "todos";

  const sortedCards =
    sort === "nome"
      ? [...cards].sort((a, b) => a.clientName.localeCompare(b.clientName))
      : sortClientPriorities(allPriorities).map((p) => cardById.get(p.clientId)!);

  const spendRhythm = computeSpendRhythmCounts(cards);
  const outOfRhythmCount = spendRhythm.abaixo + spendRhythm.acima;
  const financial = computeFinancialSummary(cards);

  const managersForSummary = isAdmin ? gestores ?? [] : [{ id: profile.id, name: profile.name }];
  const managerSummary = computeManagerSummary(managersForSummary, filteredBase, todayStr);

  const investmentDiff = financial.actual - financial.expectedToDate;
  const investmentRitmoStatus =
    financial.planned > 0 ? classifySpendStatus(financial.actual, financial.expectedToDate, financial.planned) : "sem_meta";
  const investmentDiffTone: StatusTone =
    investmentRitmoStatus === "acima" ? "danger" : investmentRitmoStatus === "abaixo" ? "warning" : "neutral";

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

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  };

  // Drill-down "de uma casa só": zera os filtros de recorte (mantendo só
  // mês e gestor) e aplica exatamente o filtro clicado — usado pelos
  // indicadores de "Controle de investimento" (os "Indicadores da operação"
  // não têm drill-down de propósito, ver comentário acima do bloco).
  const drillDownUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.month) next.set("month", params.month);
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
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
      <div className="mx-auto max-w-7xl px-6 py-5">
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

        <div className="mt-2.5">
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
            preserved={{
              month: params.month,
              sprintBucket: sprintBucketFilter,
              sync: syncFilter,
              meta: metaFilter,
              sort: sort !== "prioridade" ? sort : undefined,
            }}
          />
        </div>

        {/* Indicadores da operação + Controle de investimento compartilham
            uma única superfície contínua (seção 7 do pedido original: "algumas
            áreas podem compartilhar uma mesma superfície principal"),
            separadas por um divisor horizontal em vez de dois cards com
            sombra. "Saúde da operação" (saudável/atenção/crítico) foi
            substituído por 6 indicadores quantitativos e objetivos — sem
            classificação qualitativa, sem cores decorativas, sem drill-down
            (nenhum destes é clicável de propósito). */}
        <div className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
          <div className="p-3.5">
            <SectionHeader title="Indicadores da operação" />
            <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2 sm:divide-x sm:divide-overview-border">
              <div>
                <Metric
                  label="Clientes ativos"
                  value={String(operationIndicators.activeClientsCount)}
                  title="Clientes ativos no contexto selecionado."
                />
              </div>
              <div className="sm:pl-6">
                <Metric
                  label={operationIndicators.managersLabel}
                  value={String(operationIndicators.activeManagersCount)}
                  title="Gestores ativos vinculados ao contexto selecionado."
                />
              </div>
              <div className="sm:pl-6">
                <Metric
                  label="Tarefas concluídas"
                  value={String(operationIndicators.completedTasksCount)}
                  title="Tarefas concluídas dentro do mês selecionado."
                />
              </div>
              <div className="sm:pl-6">
                <Metric
                  label="Taxa de conclusão"
                  value={
                    operationIndicators.completionRatePct !== null
                      ? `${Math.round(operationIndicators.completionRatePct)}%`
                      : "—"
                  }
                  title="Percentual das tarefas previstas no período que foram concluídas."
                />
              </div>
              <div className="sm:pl-6">
                <Metric
                  label="Análises realizadas"
                  value={String(operationIndicators.reviewsCount)}
                  title="Análises de conta registradas dentro do mês selecionado."
                />
              </div>
              <div className="sm:pl-6">
                <Metric
                  label="Otimizações registradas"
                  value={String(operationIndicators.optimizationsCount)}
                  title="Otimizações registradas dentro do mês selecionado."
                />
              </div>
            </div>
          </div>

          <div className="border-t border-overview-border p-3.5">
            <SectionHeader title="Controle de investimento" />
            <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
              <Metric label="Planejado" value={formatCurrency(financial.planned)} size="lg" />
              <Metric label="Realizado" value={formatCurrency(financial.actual)} size="lg" />
              <Metric label="% realizado" value={financial.pct !== null ? `${Math.round(financial.pct)}%` : "—"} />
              <Metric label="Esperado até hoje" value={formatCurrency(financial.expectedToDate)} />
              <Metric
                label="Diferença p/ ritmo esperado"
                value={financial.planned > 0 ? formatCurrency(investmentDiff) : "—"}
                tone={financial.planned > 0 ? investmentDiffTone : "neutral"}
              />
              <Metric
                label="Contas fora do ritmo"
                value={String(outOfRhythmCount)}
                href={drillDownUrl({ ritmo: "fora_do_ritmo" })}
                tone={outOfRhythmCount > 0 ? "warning" : "neutral"}
                title={`${spendRhythm.abaixo} abaixo · ${spendRhythm.acima} acima`}
              />
            </div>

            <div className="mt-3">
              <ProgressBar planned={financial.planned} actual={financial.actual} expectedToDate={financial.expectedToDate} />
              <p className="mt-1.5 text-[11px] text-overview-text-muted">
                {financial.semMeta > 0 ? (
                  <Button href={drillDownUrl({ meta: "sem" })} variant="ghost" size="sm" className="h-auto px-0 py-0 font-normal text-overview-text-muted underline decoration-overview-border hover:text-overview-text-secondary">
                    {financial.semMeta} cliente{financial.semMeta !== 1 ? "s" : ""} sem planejamento configurado
                  </Button>
                ) : (
                  "Todos os clientes possuem planejamento configurado"
                )}
              </p>
            </div>
          </div>
        </div>

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

        {/* Tabela única de clientes (Etapa 49) — coluna "Prioridade" removida
            por duplicar "Status" sem contexto adicional (a classificação
            detalhada de severidade continua em "Prioridades de hoje", que já
            tinha sua própria fonte de verdade, `getClientPriority` — "Saúde
            da operação" foi removida, ver "Indicadores da operação" acima,
            que não usa mais accountHealth). "Esperado até hoje" usa a mesma
            base (`monthExpectedToDate`) que já decide "Status"
            (classifySpendStatus) — nunca um cálculo paralelo. Ordenação
            padrão ("Ordenar por prioridade") continua reaproveitando
            `sortClientPriorities` por baixo, mesmo sem mais exibir a
            severidade em coluna própria. */}
        <div className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <SectionHeader title={`Clientes · ${monthLabel}`} />
            <div className="flex items-center gap-3 text-xs">
              <span className="text-overview-text-muted">{sortedCards.length} cliente{sortedCards.length !== 1 ? "s" : ""}</span>
              <Button href={buildUrl({ sort: sort === "nome" ? "prioridade" : "nome" })} variant="ghost" size="sm">
                Ordenar por {sort === "nome" ? "prioridade" : "nome"}
              </Button>
            </div>
          </div>

          {sortedCards.length > 0 ? (
            <div className="overflow-x-auto border-t border-overview-border">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-overview-border bg-overview-surface-subtle text-left text-[12px] font-semibold text-overview-text-secondary">
                    <th className="py-2 px-3.5 font-semibold">Cliente</th>
                    <th className="py-2 px-3.5 font-semibold">Gestor</th>
                    <th className="py-2 px-3.5 text-right font-semibold">Investimento</th>
                    <th className="py-2 px-3.5 text-right font-semibold">Esperado até hoje</th>
                    <th className="py-2 px-3.5 font-semibold">Sprint atual</th>
                    <th className="py-2 px-3.5 font-semibold">Status</th>
                    <th className="py-2 px-3.5 font-semibold">Última otimização</th>
                    <th className="py-2 px-3.5 text-right font-semibold">Abrir cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCards.map((card) => {
                    // Mesma regra usada pra classificar o status
                    // (classifySpendStatus, ±10% sobre `monthExpectedToDate`)
                    // — "Esperado até hoje" é só esse valor expresso como %
                    // do planejado, nunca um cálculo paralelo.
                    const pctRealizado =
                      card.monthPlanned > 0 ? Math.round((card.monthActual / card.monthPlanned) * 100) : null;
                    const pctEsperado =
                      card.monthPlanned > 0 ? Math.round((card.monthExpectedToDate / card.monthPlanned) * 100) : null;
                    return (
                      <tr
                        key={card.clientId}
                        className="border-b border-overview-border/70 transition-colors duration-150 last:border-0 hover:bg-overview-surface-hover"
                      >
                        <td className="py-2.5 px-3.5 font-semibold text-overview-text-primary">{card.clientName}</td>
                        <td className="py-2.5 px-3.5 text-overview-text-secondary">
                          {primaryManagerNameByClient.get(card.clientId) ?? "Sem gestor"}
                        </td>
                        <td className="py-2.5 px-3.5 text-right tabular-nums text-overview-text-secondary">
                          {pctRealizado !== null ? `${pctRealizado}%` : "—"}
                        </td>
                        <td className="py-2.5 px-3.5 text-right tabular-nums text-overview-text-secondary">
                          {pctEsperado !== null ? `${pctEsperado}%` : "—"}
                        </td>
                        <td className="py-2.5 px-3.5 text-overview-text-secondary">
                          {card.sprintPeriodLabel ?? "—"}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <StatusDot tone={SITUATION_TONE[card.monthStatus]} label={SITUATION_LABEL[card.monthStatus]} />
                        </td>
                        <td className="py-2.5 px-3.5 text-overview-text-secondary">
                          {formatLastOptimizationLabel(card.lastOptimizationAt, today)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right">
                          <Button href={`/clients/${card.clientId}`} variant="ghost" size="sm">
                            Abrir cliente
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-overview-border">
              <EmptyState title="Nenhum cliente encontrado com esses filtros." description="Ajuste os filtros acima ou limpe-os para ver todos os clientes monitorados." />
            </div>
          )}
        </div>

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
            <p className="mt-2 text-sm text-overview-text-secondary">Nenhum gestor encontrado.</p>
          )}
          </div>
        </details>
      </div>
    </div>
  );
}
