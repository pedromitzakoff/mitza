import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange, monthRangeFromParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import type { AccountHealth } from "@/lib/attention-alerts";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import { type SpendStatus } from "@/lib/spend-status";
import { computeCumulativeSpendSeries } from "@/lib/spend-chart-data";
import { computeMonthProjectionForRange } from "@/lib/client-metrics";
import { SpendChart } from "@/app/clients/spend-chart";
import { buildAgencyAttentionAlerts } from "@/lib/agency-alerts";
import {
  computeFinancialSummary,
  computeManagerSummary,
  computeSpendRhythmCounts,
  computeSprintOpsSummary,
  sortCardsBySpendRhythm,
  buildRitmoSummaryText,
} from "@/lib/agency-metrics";
import { AgencyFilters } from "./agency-filters";

/** Rótulos da "situação" financeira do mês nesta tabela — mesma
 * classificação de sempre (card.monthStatus, ±10% central), só um texto
 * mais descritivo nesse contexto específico (SPEND_STATUS_LABEL/"Bateu
 * meta" continua igual em todo o resto do sistema). */
const SITUATION_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro do esperado",
  acima: "Acima do esperado",
  abaixo: "Abaixo do esperado",
  sem_meta: "Meta não configurada",
};

const SITUATION_BADGE_CLASSES: Record<SpendStatus, string> = {
  dentro: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  acima: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  abaixo: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  sem_meta: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

type ManagerFilter = "all" | "me" | string;
type RitmoFilter = "todos" | SpendStatus;
type TasksFilter = "todas" | "atrasadas" | "sem_atrasadas";

function shiftMonthParam(monthRange: { firstDay: string }, deltaMonths: number): string {
  const d = new Date(`${monthRange.firstDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Uma métrica compacta dentro de um grupo (Carteira/Investimento/Operação)
 * — nunca um card com borda própria, pra não voltar a virar uma grade de
 * caixinhas competindo por atenção. */
function StatItem({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );

  return href ? (
    <Link href={href} className="-mx-1 rounded-md px-1 hover:bg-zinc-100 dark:hover:bg-zinc-900">
      {content}
    </Link>
  ) : (
    content
  );
}

/** Um grupo (Carteira/Investimento/Operação) — no máximo 4 no primeiro
 * viewport, cada um com métricas compactas dentro em vez de vários cards
 * soltos e iguais. */
function MetricGroup({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">{children}</div>
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
    search?: string;
    health?: string;
    activity?: string;
    ritmo?: string;
    tasks?: string;
    sprintBucket?: string;
    sync?: string;
    meta?: string;
    sort?: string;
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
  const isFutureMonth = monthRange.firstDay > todayStr;

  // Busca sprints/gastos numa janela que cobre o mês selecionado E o mês
  // corrente (union) — assim a sprint atual (de hoje) é sempre encontrada,
  // mesmo quando o usuário está navegando um mês diferente do atual.
  const rangeStart = monthRange.firstDay < currentRange.firstDay ? monthRange.firstDay : currentRange.firstDay;
  const rangeEnd = monthRange.lastDay > currentRange.lastDay ? monthRange.lastDay : currentRange.lastDay;

  const managerFilter: ManagerFilter = params.manager ?? (isAdmin ? "all" : "me");
  const search = (params.search ?? "").trim().toLowerCase();
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

  // Filtros que respeitam tudo, exceto gestor — permite comparar gestores
  // no bloco "Resumo por Gestor" com o mesmo recorte de status/atividade
  // aplicado no resto do dashboard.
  let filteredBase = allCards;

  if (search) {
    filteredBase = filteredBase.filter((card) => card.clientName.toLowerCase().includes(search));
  }
  if (healthFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.accountHealth === healthFilter);
  }
  if (activityFilter !== "todos") {
    filteredBase = filteredBase.filter((card) => card.activityStatus === activityFilter);
  }
  if (ritmoFilter !== "todos") {
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

  const sortedCards =
    sort === "nome" ? [...cards].sort((a, b) => a.clientName.localeCompare(b.clientName)) : sortCardsBySpendRhythm(cards);

  const spendRhythm = computeSpendRhythmCounts(cards);
  const financial = computeFinancialSummary(cards, monthRange, today);
  const sprintOps = computeSprintOpsSummary(cards, todayStr);
  const ritmoText = buildRitmoSummaryText(financial, isFutureMonth);
  const agencyAlerts = buildAgencyAttentionAlerts(cards);

  const managersForSummary = isAdmin ? gestores ?? [] : [{ id: profile.id, name: profile.name }];
  const managerSummary = computeManagerSummary(managersForSummary, filteredBase, todayStr);

  const cardsClientIds = new Set(cards.map((c) => c.clientId));
  const chartSprints = (sprints ?? []).filter((s) => cardsClientIds.has(s.client_id));
  const chartDailySpend = (dailySpend ?? []).filter((d) => cardsClientIds.has(d.client_id));
  const chartPoints = computeCumulativeSpendSeries(chartSprints, chartDailySpend, monthRange, today);

  const sprintDistributionTotal = Math.max(
    1,
    sprintOps.emDia + sprintOps.atencao + sprintOps.criticas + sprintOps.semExecucao,
  );

  // Preserva TODOS os filtros ativos — usado na navegação de mês e na
  // ordenação da tabela, que não devem resetar o resto do contexto.
  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.month) next.set("month", params.month);
    next.set("manager", managerFilter);
    if (search) next.set("search", search);
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
  // mês e gestor) e aplica exatamente o filtro clicado — usado pelos cards
  // de portfólio, pelo bloco "Precisa de atenção" e pelo resumo por gestor.
  const drillDownUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    if (params.month) next.set("month", params.month);
    next.set("manager", managerFilter);
    for (const [key, value] of Object.entries(overrides)) {
      next.set(key, value);
    }
    return `/?${next.toString()}`;
  };

  const FILTER_KEY_TO_PARAM: Record<string, Record<string, string>> = {
    critico: { health: "critico" },
    acima: { ritmo: "acima" },
    abaixo: { ritmo: "abaixo" },
    atrasadas: { tasks: "atrasadas" },
    sem_execucao: { sprintBucket: "sem_execucao" },
    inativo: { activity: "inativo" },
    sem_meta: { meta: "sem" },
    sem_sync: { sync: "stale" },
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Visão Geral</h1>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <Link
            href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
            className="rounded-md px-2 py-1 text-sm text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Mês anterior"
          >
            &larr;
          </Link>
          <span className="min-w-[10rem] text-center text-sm font-medium text-foreground">
            {formatMonthLabel(monthRange.firstDay)}
          </span>
          <Link
            href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
            className="rounded-md px-2 py-1 text-sm text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Próximo mês"
          >
            &rarr;
          </Link>
          {params.month && (
            <Link href={buildUrl({ month: "" })} className="ml-1 text-xs text-brand hover:underline">
              Mês atual
            </Link>
          )}
        </div>
      </div>

      <AgencyFilters
        defaultManager={isAdmin ? "all" : "me"}
        gestores={gestores ?? []}
        manager={managerFilter}
        search={search}
        health={healthFilter}
        activity={activityFilter}
        ritmo={ritmoFilter}
        tasks={tasksFilter}
        preserved={{
          month: params.month,
          sprintBucket: sprintBucketFilter,
          sync: syncFilter,
          meta: metaFilter,
          sort: sort !== "prioridade" ? sort : undefined,
        }}
      />

      {/* Resumo consolidado: no máximo 4 grupos, métricas compactas dentro
          de cada um em vez de uma grade de cards soltos. */}
      <div className="mt-5 flex flex-col gap-3">
        <MetricGroup title="Ritmo do mês">
          <StatItem label="Clientes totais" value={String(spendRhythm.total)} />
          <StatItem
            label="Dentro do esperado"
            value={String(spendRhythm.dentro)}
            href={drillDownUrl({ ritmo: "dentro" })}
          />
          <StatItem
            label="Abaixo do esperado"
            value={String(spendRhythm.abaixo)}
            href={drillDownUrl({ ritmo: "abaixo" })}
          />
          <StatItem
            label="Acima do esperado"
            value={String(spendRhythm.acima)}
            href={drillDownUrl({ ritmo: "acima" })}
          />
        </MetricGroup>

        <MetricGroup
          title="Investimento"
          extra={
            <>
              <div className="mt-3">
                <SpendChart points={chartPoints} size="large" />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">{ritmoText}</p>
            </>
          }
        >
          <StatItem label="Planejado" value={formatCurrency(financial.planned)} />
          <StatItem label="Realizado" value={formatCurrency(financial.actual)} />
          <StatItem label="% realizado" value={financial.pct !== null ? `${Math.round(financial.pct)}%` : "—"} />
          <StatItem
            label={isFutureMonth ? "Projeção (mês futuro)" : "Projeção"}
            value={isFutureMonth ? "—" : formatCurrency(financial.projection.projectedSpend)}
          />
          <StatItem
            label="Diferença projetada"
            value={
              isFutureMonth || financial.planned <= 0
                ? "—"
                : formatCurrency(financial.projection.projectedSpend - financial.planned)
            }
          />
          <StatItem label="Sem meta" value={String(financial.semMeta)} href={drillDownUrl({ meta: "sem" })} />
        </MetricGroup>

        <MetricGroup
          title="Operação"
          extra={
            <>
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full border border-border">
                {sprintOps.emDia > 0 && (
                  <div
                    className="bg-green-500"
                    style={{ width: `${(sprintOps.emDia / sprintDistributionTotal) * 100}%` }}
                    title={`Em dia: ${sprintOps.emDia}`}
                  />
                )}
                {sprintOps.atencao > 0 && (
                  <div
                    className="bg-amber-500"
                    style={{ width: `${(sprintOps.atencao / sprintDistributionTotal) * 100}%` }}
                    title={`Atenção: ${sprintOps.atencao}`}
                  />
                )}
                {sprintOps.criticas > 0 && (
                  <div
                    className="bg-red-500"
                    style={{ width: `${(sprintOps.criticas / sprintDistributionTotal) * 100}%` }}
                    title={`Críticas: ${sprintOps.criticas}`}
                  />
                )}
                {sprintOps.semExecucao > 0 && (
                  <div
                    className="bg-zinc-400 dark:bg-zinc-600"
                    style={{ width: `${(sprintOps.semExecucao / sprintDistributionTotal) * 100}%` }}
                    title={`Sem execução: ${sprintOps.semExecucao}`}
                  />
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-green-500" /> Em dia
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Atenção
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> Críticas
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-600" /> Sem execução
                </span>
              </div>
            </>
          }
        >
          <StatItem label="Sprints em andamento" value={String(sprintOps.emAndamento)} />
          <StatItem
            label="Taxa de execução"
            value={sprintOps.taxaExecucao !== null ? `${Math.round(sprintOps.taxaExecucao)}%` : "—"}
          />
          <StatItem
            label="Tarefas atrasadas"
            value={String(sprintOps.atrasadas)}
            href={drillDownUrl({ tasks: "atrasadas" })}
          />
          <StatItem label="Tarefas hoje" value={String(sprintOps.paraHoje)} href="/sprints?mode=hoje" />
          <StatItem
            label="Sem execução"
            value={String(sprintOps.semExecucao)}
            href="/sprints?sprint=sem_execucao"
          />
        </MetricGroup>
      </div>

      {/* Precisa de atenção */}
      <div className="mt-5 rounded-lg border border-border bg-card p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Precisa de atenção</h2>
        {agencyAlerts.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {agencyAlerts.map((alert) => (
              <li key={alert.filterKey}>
                <Link
                  href={drillDownUrl(FILTER_KEY_TO_PARAM[alert.filterKey] ?? {})}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                    alert.severity === "critico"
                      ? "text-red-700 dark:text-red-300"
                      : alert.severity === "atencao"
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      alert.severity === "critico"
                        ? "bg-red-500"
                        : alert.severity === "atencao"
                          ? "bg-amber-500"
                          : "bg-zinc-400"
                    }`}
                  />
                  {alert.message}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum problema relevante neste recorte.</p>
        )}
      </div>

      {/* Tabela única de clientes — consolida o que antes eram duas tabelas
          (Contas prioritárias + Clientes), só com o essencial pra entender
          rápido o estágio do mês de cada conta. */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clientes</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{sortedCards.length} cliente{sortedCards.length !== 1 ? "s" : ""}</span>
            <Link
              href={buildUrl({ sort: sort === "nome" ? "prioridade" : "nome" })}
              className="font-medium text-brand hover:underline"
            >
              Ordenar por {sort === "nome" ? "situação" : "nome"}
            </Link>
          </div>
        </div>

        {sortedCards.length > 0 ? (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
                  <th className="py-1.5 px-3">Cliente</th>
                  <th className="py-1.5 px-3">Gestor</th>
                  <th className="py-1.5 px-3">Investimento</th>
                  <th className="py-1.5 px-3">Projeção do mês</th>
                  <th className="py-1.5 px-3">Tarefas</th>
                  <th className="py-1.5 px-3">Última atividade</th>
                  <th className="py-1.5 px-3">Situação</th>
                  <th className="py-1.5 px-3" />
                </tr>
              </thead>
              <tbody>
                {sortedCards.map((card) => {
                  const projection = computeMonthProjectionForRange(card.monthPlanned, card.monthActual, monthRange, today);
                  return (
                    <tr key={card.clientId} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 px-3 font-semibold text-foreground">{card.clientName}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {primaryManagerNameByClient.get(card.clientId) ?? "Sem gestor"}
                      </td>
                      <td className="py-1.5 px-3 tabular-nums text-muted-foreground">
                        {formatCurrency(card.monthActual)} / {formatCurrency(card.monthPlanned)}
                      </td>
                      <td className="py-1.5 px-3 tabular-nums text-muted-foreground">
                        {card.hasMonthGoal ? (
                          <>
                            {formatCurrency(projection.projectedSpend)}
                            {projection.projectedPct !== null && ` · ${Math.round(projection.projectedPct)}%`}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground">
                        {card.taskCounts.done}/{card.taskCounts.total}
                        {card.taskCounts.overdue > 0 && (
                          <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                            · {card.taskCounts.overdue} atrasada{card.taskCounts.overdue !== 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-muted-foreground">{card.activityLabel}</td>
                      <td className="py-1.5 px-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SITUATION_BADGE_CLASSES[card.monthStatus]}`}
                        >
                          {SITUATION_LABEL[card.monthStatus]}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <Link href={`/clients/${card.clientId}`} className="text-xs font-medium text-brand hover:underline">
                          Abrir
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum cliente encontrado com esses filtros.
          </p>
        )}
      </div>

      {/* Análises secundárias — fora do primeiro viewport de propósito */}
      <details className="mt-5 rounded-lg border border-border bg-card [&_summary]:cursor-pointer [&_summary]:list-none">
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
  );
}
