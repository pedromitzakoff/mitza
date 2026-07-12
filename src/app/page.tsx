import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange, monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
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
import { computeFinancialSummary, computeManagerSummary, computePortfolioCounts, computeSpendRhythmCounts } from "@/lib/agency-metrics";
import { getClientPriority, sortClientPriorities } from "@/lib/client-priority";
import { AgencyFilters, type AgencyClientOption } from "./agency-filters";
import { AgencyInvestmentBar } from "./agency-investment-bar";
import { PrioritiesDrawer, PrioritiesPanel } from "./priorities-panel";

/** Rótulos da "situação" financeira do mês — mesma classificação de sempre
 * (card.monthStatus, ±10% central). */
const SITUATION_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Sem planejamento",
};

const SITUATION_BADGE_CLASSES: Record<SpendStatus, string> = {
  dentro: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  sem_meta: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERITY_LABEL: Record<AccountHealth, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  saudavel: "Normal",
};

const SEVERITY_BADGE_CLASSES: Record<AccountHealth, string> = {
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

type ManagerFilter = "all" | "me" | string;
/** "fora_do_ritmo" é só um atalho de drill-down (abaixo + acima combinados)
 * pro indicador "Contas fora do ritmo" — não aparece como opção no popover
 * de Filtros (que continua com as 4 opções reais), só via link direto,
 * mesmo padrão já usado por `sprintBucket`/`sync`/`meta`. */
type RitmoFilter = "todos" | SpendStatus | "fora_do_ritmo";
type TasksFilter = "todas" | "atrasadas" | "sem_atrasadas";

/** Cor do valor — só sinalização discreta no texto, nunca um card ou fundo
 * inteiro colorido. "neutral" é o padrão (ex.: contagem total). */
const STAT_TONE_CLASSES = {
  neutral: "text-foreground",
  positive: "text-green-600 dark:text-green-400",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400",
} as const;

/** Uma métrica compacta dentro de um grupo (Saúde da operação/Controle de
 * investimento) — nunca um card com borda própria, pra não virar uma grade
 * de caixinhas competindo por atenção. `size="lg"` marca os dois números
 * mais importantes de "Controle de investimento" (Planejado/Realizado) com
 * mais peso visual (navy, maior) — os demais ficam secundários por padrão. */
function StatItem({
  label,
  value,
  href,
  tone = "neutral",
  size = "md",
  title,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: keyof typeof STAT_TONE_CLASSES;
  size?: "md" | "lg";
  title?: string;
}) {
  const valueClass =
    size === "lg"
      ? `text-2xl font-bold ${tone === "neutral" ? "text-navy" : STAT_TONE_CLASSES[tone]}`
      : `text-base font-semibold ${STAT_TONE_CLASSES[tone]}`;

  const content = (
    <div title={title}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="-mx-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
    >
      {content}
    </Link>
  ) : (
    content
  );
}

/** Um grupo (Saúde da operação/Controle de investimento) — cada métrica
 * compacta dentro, nunca vários cards soltos e iguais. `divided` separa as
 * métricas com um divisor vertical sutil; `accent` dá um leve destaque de
 * borda esquerda pro bloco mais importante sem aumentar a altura. */
function MetricGroup({
  title,
  children,
  extra,
  divided = false,
  accent = false,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
  divided?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] ${
        accent ? "border-l-2 border-l-brand" : ""
      }`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className={`mt-2.5 flex flex-wrap gap-x-6 gap-y-2 ${divided ? "sm:divide-x sm:divide-border" : ""}`}>
        {divided
          ? Array.isArray(children)
            ? children.map((child, index) => (
                <div key={index} className={index > 0 ? "sm:pl-6" : ""}>
                  {child}
                </div>
              ))
            : children
          : children}
      </div>
      {extra}
    </div>
  );
}

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

  const [
    { data: clients },
    { data: clientManagers },
    { data: gestores },
    { data: sprints },
    { data: dailySpend },
    { data: tasks },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, meta_ad_account_id, primary_manager:profiles!clients_primary_manager_id_fkey(name)")
      .is("deleted_at", null)
      .order("name"),
    supabase.from("client_managers").select("client_id, user_id, profiles(id, name)"),
    supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
    supabase
      .from("sprints")
      .select(
        "id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend, manual_spend_updated_at",
      )
      .gte("start_date", rangeStart)
      .lte("start_date", rangeEnd),
    supabase
      .from("daily_spend")
      .select("client_id, date, spend, synced_at")
      .gte("date", rangeStart)
      .lte("date", rangeEnd),
    supabase
      .from("tasks")
      .select(
        "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:profiles!tasks_assignee_id_fkey(name)",
      ),
  ]);

  const clientIds = (clients ?? []).map((c) => c.id);
  const currentSprintIds = (sprints ?? [])
    .filter((s) => s.start_date <= todayStr && s.end_date >= todayStr)
    .map((s) => s.id);

  const [{ data: clientActivity }, { data: sprintActivity }] = await Promise.all([
    clientIds.length > 0
      ? supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds)
      : Promise.resolve({ data: [] }),
    currentSprintIds.length > 0
      ? supabase.from("sprint_last_operational_activity").select("sprint_id, last_activity_at").in("sprint_id", currentSprintIds)
      : Promise.resolve({ data: [] }),
  ]);

  const managersByClient = new Map<string, { id: string; name: string }[]>();
  for (const row of clientManagers ?? []) {
    if (!row.profiles) continue;
    const list = managersByClient.get(row.client_id) ?? [];
    list.push(row.profiles);
    managersByClient.set(row.client_id, list);
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

  const clientActivityById = new Map((clientActivity ?? []).map((r) => [r.client_id, r.last_activity_at]));
  const sprintActivityById = new Map((sprintActivity ?? []).map((r) => [r.sprint_id, r.last_activity_at]));
  const primaryManagerNameByClient = new Map(
    (clients ?? []).map((c) => [c.id, c.primary_manager?.name ?? null]),
  );

  const rawClients: OperationClientRawData[] = (clients ?? []).map((client) => {
    const clientSprints = sprintsByClient.get(client.id) ?? [];
    const currentSprint = clientSprints.find((s) => s.start_date <= todayStr && s.end_date >= todayStr);

    return {
      id: client.id,
      name: client.name,
      metaAdAccountId: client.meta_ad_account_id,
      managerNames: (managersByClient.get(client.id) ?? []).map((m) => m.name),
      managerIds: (managersByClient.get(client.id) ?? []).map((m) => m.id),
      sprints: clientSprints,
      dailySpend: dailySpendByClient.get(client.id) ?? [],
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

  // Prioridade de cada cliente — uma única fonte (getClientPriority),
  // reaproveitada pro bloco "Prioridades de hoje", pela coluna "Prioridade"
  // da tabela e pela ordenação padrão dela (severidade primeiro).
  const cardById = new Map(cards.map((c) => [c.clientId, c]));
  const allPriorities = cards.map((card) => getClientPriority(card, today));
  const priorityByClientId = new Map(allPriorities.map((p) => [p.clientId, p]));
  const priorityQueue = sortClientPriorities(allPriorities.filter((p) => p.primaryIssue !== null));
  const prioritiesTop = priorityQueue.slice(0, 6);
  const prioritiesOpen = params.prioridades === "1";
  const prioritySeverity = (params.prioridadeSeveridade ?? "todos") as AccountHealth | "todos";

  const sortedCards =
    sort === "nome"
      ? [...cards].sort((a, b) => a.clientName.localeCompare(b.clientName))
      : sortClientPriorities(allPriorities).map((p) => cardById.get(p.clientId)!);

  const portfolio = computePortfolioCounts(cards);
  const spendRhythm = computeSpendRhythmCounts(cards);
  const outOfRhythmCount = spendRhythm.abaixo + spendRhythm.acima;
  const financial = computeFinancialSummary(cards);

  const managersForSummary = isAdmin ? gestores ?? [] : [{ id: profile.id, name: profile.name }];
  const managerSummary = computeManagerSummary(managersForSummary, filteredBase, todayStr);

  const investmentDiff = financial.actual - financial.expectedToDate;
  const investmentRitmoStatus =
    financial.planned > 0 ? classifySpendStatus(financial.actual, financial.expectedToDate, financial.planned) : "sem_meta";
  const investmentDiffTone =
    investmentRitmoStatus === "acima" ? "critical" : investmentRitmoStatus === "abaixo" ? "warning" : "neutral";

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
  // indicadores de Saúde da operação/Controle de investimento.
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

  return (
    <div className="min-h-[calc(100dvh_-_3rem)] bg-overview-bg">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-navy">Visão Geral</h1>

          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card px-1 py-1 text-sm shadow-[var(--shadow-card)]">
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
              aria-label="Mês anterior"
            >
              &lsaquo;
            </Link>
            <span className="min-w-[8.5rem] text-center font-medium text-foreground">
              {formatMonthLabel(monthRange.firstDay)}
            </span>
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
              aria-label="Próximo mês"
            >
              &rsaquo;
            </Link>
            {params.month && (
              <Link
                href={buildUrl({ month: "" })}
                className="ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Mês atual
              </Link>
            )}
          </div>
        </div>

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

        {/* Saúde da operação + Controle de investimento: no máximo 2 grupos,
            métricas compactas dentro de cada um em vez de uma grade de
            cards soltos. */}
        <div className="mt-3 flex flex-col gap-2.5">
          <MetricGroup title="Saúde da operação" divided>
            <StatItem label="Clientes monitorados" value={String(cards.length)} />
            <StatItem
              label="Operação normal"
              value={String(portfolio.saudaveis)}
              href={drillDownUrl({ health: "saudavel" })}
              tone="positive"
            />
            <StatItem
              label="Precisam de atenção"
              value={String(portfolio.atencao)}
              href={drillDownUrl({ health: "atencao" })}
              tone="warning"
            />
            <StatItem
              label="Críticos"
              value={String(portfolio.criticos)}
              href={drillDownUrl({ health: "critico" })}
              tone="critical"
            />
          </MetricGroup>

          <MetricGroup
            title="Controle de investimento"
            accent
            extra={
              <div className="mt-3.5">
                <AgencyInvestmentBar
                  planned={financial.planned}
                  actual={financial.actual}
                  expectedToDate={financial.expectedToDate}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {financial.semMeta > 0 ? (
                    <Link
                      href={drillDownUrl({ meta: "sem" })}
                      className="rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      {financial.semMeta} cliente{financial.semMeta !== 1 ? "s" : ""} sem planejamento configurado
                    </Link>
                  ) : (
                    "Todos os clientes possuem planejamento configurado"
                  )}
                </p>
              </div>
            }
          >
            <StatItem label="Planejado" value={formatCurrency(financial.planned)} size="lg" />
            <StatItem label="Realizado" value={formatCurrency(financial.actual)} size="lg" />
            <StatItem label="% realizado" value={financial.pct !== null ? `${Math.round(financial.pct)}%` : "—"} />
            <StatItem label="Esperado até hoje" value={formatCurrency(financial.expectedToDate)} />
            <StatItem
              label="Diferença p/ ritmo esperado"
              value={financial.planned > 0 ? formatCurrency(investmentDiff) : "—"}
              tone={financial.planned > 0 ? investmentDiffTone : "neutral"}
            />
            <StatItem
              label="Contas fora do ritmo"
              value={String(outOfRhythmCount)}
              href={drillDownUrl({ ritmo: "fora_do_ritmo" })}
              tone={outOfRhythmCount > 0 ? "warning" : "neutral"}
              title={`${spendRhythm.abaixo} abaixo · ${spendRhythm.acima} acima`}
            />
          </MetricGroup>
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

        {/* Tabela única de clientes — "Investimento"/"Prioridade" resumidos
            (sem repetir realizado/planejado/esperado/diferença, que já
            pertencem ao painel do cliente); "Prioridade" reaproveita
            exatamente o mesmo dado de "Saúde da operação" e de
            "Prioridades de hoje" — nunca uma segunda classificação. */}
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Clientes · {formatMonthLabel(monthRange.firstDay)}
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{sortedCards.length} cliente{sortedCards.length !== 1 ? "s" : ""}</span>
              <Link
                href={buildUrl({ sort: sort === "nome" ? "prioridade" : "nome" })}
                className="rounded font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Ordenar por {sort === "nome" ? "prioridade" : "nome"}
              </Link>
            </div>
          </div>

          {sortedCards.length > 0 ? (
            <div className="mt-2 overflow-x-auto rounded-xl border border-border shadow-[var(--shadow-card)]">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
                    <th className="py-2 px-3">Cliente</th>
                    <th className="py-2 px-3">Gestor</th>
                    <th className="py-2 px-3 text-right">Investimento</th>
                    <th className="py-2 px-3">Prioridade</th>
                    <th className="py-2 px-3">Última otimização</th>
                    <th className="py-2 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCards.map((card) => {
                    const pctRealizado =
                      card.monthPlanned > 0 ? Math.round((card.monthActual / card.monthPlanned) * 100) : null;
                    const priority = priorityByClientId.get(card.clientId)!;
                    return (
                      <tr
                        key={card.clientId}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                      >
                        <td className="py-2 px-3 font-semibold text-foreground">{card.clientName}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {primaryManagerNameByClient.get(card.clientId) ?? "Sem gestor"}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="tabular-nums text-muted-foreground">
                              {pctRealizado !== null ? `${pctRealizado}%` : "—"}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SITUATION_BADGE_CLASSES[card.monthStatus]}`}
                            >
                              {SITUATION_LABEL[card.monthStatus]}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            title={priority.primaryIssue?.title ?? "Nenhuma condição operacional relevante"}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE_CLASSES[priority.severity]}`}
                          >
                            {SEVERITY_LABEL[priority.severity]}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {formatLastOptimizationLabel(card.lastOptimizationAt, today)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Link
                            href={priority.primaryIssue?.actionHref ?? `/clients/${card.clientId}`}
                            className="rounded-md border border-transparent px-2 py-1 text-xs font-medium text-brand transition-colors hover:border-border hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
                          >
                            {priority.primaryIssue?.actionLabel ?? "Abrir"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-[var(--shadow-card)]">
              Nenhum cliente encontrado com esses filtros.
            </p>
          )}
        </div>

        {/* Análises secundárias — fora do primeiro viewport de propósito */}
        <details className="mt-5 rounded-xl border border-border bg-card shadow-[var(--shadow-card)] [&_summary]:cursor-pointer [&_summary]:list-none">
          <summary className="flex items-center justify-between p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-brand">
            Ver análises adicionais
            <span className="text-sm">▾</span>
          </summary>

          <div className="border-t border-border p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {isAdmin ? "Operação por gestor" : "Minha operação"}
            </h3>
          {managerSummary.length > 0 ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
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
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 px-3 font-medium text-foreground">
                        {isAdmin ? (
                          <Link href={drillDownUrl({ manager: row.id })} className="hover:underline">
                            {row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.totalClients}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.portfolio.saudaveis}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.portfolio.atencao}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.portfolio.criticos}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.portfolio.inativos}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.semExecucao}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.atrasadas}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{row.paraHoje}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {row.taxaExecucao !== null ? `${Math.round(row.taxaExecucao)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nenhum gestor encontrado.</p>
          )}
          </div>
        </details>
      </div>
    </div>
  );
}
