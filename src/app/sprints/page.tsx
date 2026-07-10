import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange, monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { formatFullDate, formatMonthLabel } from "@/lib/format";
import { sortByPriority } from "@/lib/priority-accounts";
import { sortSprintClientsByUrgency } from "@/lib/sprint-priority";
import type { CommentItem } from "@/app/clients/comment-thread";
import {
  buildOperationClientCard,
  type OperationClientRawData,
  type OperationTaskItem,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import { SprintCurrentClientGroup } from "./current-client-group";
import { SprintMonthlyClientGroup } from "./monthly-client-group";
import { SprintsClientFilter } from "./sprints-client-filter";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";

type SprintsView = "current" | "monthly";

const VIEW_LABEL: Record<SprintsView, string> = {
  current: "Sprint atual",
  monthly: "Mensal",
};

export default async function SprintsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    manager?: string;
    client?: string;
    month?: string;
    health?: string;
    activity?: string;
    sprint?: string;
    task?: string;
    taskError?: string;
    commentError?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;

  const view: SprintsView = params.view === "monthly" ? "monthly" : "current";
  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");
  const healthFilter = params.health ?? "todos";
  const activityFilter = params.activity ?? "todos";
  const sprintFilter = (params.sprint ?? "todas") as SprintFilterBucket | "todas";

  const today = todayUTC();
  const todayStr = todayDateString();
  // "Sprint atual" sempre é resolvida pela data real de hoje — por isso a
  // busca cobre o mês corrente E o mês selecionado (union), garantindo que
  // a sprint de hoje seja encontrada mesmo com a visão Mensal navegando pra
  // outro mês. Isso também evita a ambiguidade de "sprint atual de um mês
  // passado": a visão Sprint atual nunca lê `month`, só a Mensal lê.
  const monthRange = monthRangeFromParam(params.month, today);
  const currentRange = currentMonthRange(today);
  const rangeStart = monthRange.firstDay < currentRange.firstDay ? monthRange.firstDay : currentRange.firstDay;
  const rangeEnd = monthRange.lastDay > currentRange.lastDay ? monthRange.lastDay : currentRange.lastDay;

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
      .select("id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
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

  const clientOptions = [...allCards]
    .map((card) => ({ id: card.clientId, name: card.clientName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let cards = allCards;

  if (managerFilter === "me") {
    cards = cards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  if (healthFilter !== "todos") {
    cards = cards.filter((card) => card.accountHealth === healthFilter);
  }

  if (activityFilter !== "todos") {
    cards = cards.filter((card) => card.activityStatus === activityFilter);
  }

  if (sprintFilter !== "todas") {
    cards = cards.filter((card) => card.sprintFilterBucket === sprintFilter);
  }

  // Cliente inválido, inacessível, ou fora da carteira selecionada é
  // ignorado com segurança — mesma regra da Visão Geral (Etapa 39).
  const clientFilter = params.client && cards.some((card) => card.clientId === params.client) ? params.client : undefined;
  if (clientFilter) {
    cards = cards.filter((card) => card.clientId === clientFilter);
  }

  cards = view === "current" ? sortSprintClientsByUrgency(cards, todayStr) : sortByPriority(cards);

  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    next.set("view", view);
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
    if (view === "monthly" && params.month) next.set("month", params.month);
    if (healthFilter !== "todos") next.set("health", healthFilter);
    if (activityFilter !== "todos") next.set("activity", activityFilter);
    if (sprintFilter !== "todas") next.set("sprint", sprintFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/sprints?${next.toString()}`;
  };

  const monthLabel = formatMonthLabel(monthRange.firstDay);

  const openTaskId = params.task ?? null;
  let openTask: {
    task: OperationTaskItem;
    clientId: string;
    clientName: string;
    sprintNumber: number | null;
    comments: CommentItem[];
  } | null = null;

  if (openTaskId) {
    for (const card of cards) {
      const found = card.sprintTasks.find((t) => t.id === openTaskId);
      if (found) {
        const { data: comments } = await supabase
          .from("comments")
          .select("id, commentable_id, content, created_at, author:profiles!comments_author_id_fkey(name)")
          .eq("commentable_type", "task")
          .eq("commentable_id", openTaskId)
          .order("created_at");
        openTask = {
          task: found,
          clientId: card.clientId,
          clientName: card.clientName,
          sprintNumber: card.sprintNumber,
          comments: comments ?? [],
        };
        break;
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <ScrollRestoreOnMount />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sprints</h1>
          <p className="text-sm text-muted-foreground">{formatFullDate(today)}</p>
        </div>
      </div>

      {(params.taskError || params.commentError) && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {params.taskError || params.commentError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABEL) as SprintsView[]).map((v) => (
            <Link
              key={v}
              href={buildUrl({ view: v, month: v === "monthly" ? (params.month ?? "") : "" })}
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                v === view
                  ? "bg-brand text-white"
                  : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>

        {view === "monthly" && (
          <div className="flex items-center gap-0.5 text-sm">
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              aria-label="Mês anterior"
            >
              &lsaquo;
            </Link>
            <span className="min-w-[8.5rem] text-center font-medium text-foreground">{monthLabel}</span>
            <Link
              href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
              className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              aria-label="Próximo mês"
            >
              &rsaquo;
            </Link>
            {params.month && (
              <Link href={buildUrl({ month: "" })} className="ml-1.5 text-xs text-brand hover:underline">
                Mês atual
              </Link>
            )}
          </div>
        )}
      </div>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        <input type="hidden" name="view" value={view} />
        {clientFilter && <input type="hidden" name="client" value={clientFilter} />}
        {view === "monthly" && params.month && <input type="hidden" name="month" value={params.month} />}

        <select
          name="manager"
          defaultValue={managerFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="me">Meus clientes</option>
          <option value="all">Todos os clientes</option>
          {(gestores ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <select
          name="health"
          defaultValue={healthFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="todos">Status da conta: todos</option>
          <option value="saudavel">Saudável</option>
          <option value="atencao">Atenção</option>
          <option value="critico">Crítico</option>
        </select>

        <select
          name="activity"
          defaultValue={activityFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="todos">Atividade: todas</option>
          <option value="ativo">Ativos</option>
          <option value="atencao">Atenção por inatividade</option>
          <option value="inativo">Inativos</option>
        </select>

        <select
          name="sprint"
          defaultValue={sprintFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="todas">Sprint: todas</option>
          <option value="atrasadas">Com tarefas atrasadas</option>
          <option value="sem_execucao">Sem execução</option>
          <option value="em_dia">Em dia</option>
        </select>

        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Filtrar
        </button>

        {(managerFilter !== (isAdmin ? "all" : "me") ||
          healthFilter !== "todos" ||
          activityFilter !== "todos" ||
          sprintFilter !== "todas") && (
          <Link
            href={buildUrl({ manager: isAdmin ? "all" : "me", health: "", activity: "", sprint: "" })}
            className="text-xs text-brand hover:underline"
          >
            Limpar filtros
          </Link>
        )}

        <SprintsClientFilter
          clients={clientOptions}
          selectedClientId={clientFilter}
          view={view}
          manager={managerFilter}
          month={view === "monthly" ? params.month : undefined}
          health={healthFilter}
          activity={activityFilter}
          sprint={sprintFilter}
        />
      </form>

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length} cliente{cards.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {cards.length > 0 ? (
          view === "current" ? (
            cards.map((card) => (
              <SprintCurrentClientGroup
                key={card.clientId}
                card={card}
                returnTo={buildUrl({})}
                primaryManagerName={primaryManagerNameByClient.get(card.clientId) ?? null}
              />
            ))
          ) : (
            cards.map((card) => (
              <SprintMonthlyClientGroup
                key={card.clientId}
                card={card}
                monthLabel={monthLabel}
                monthRange={monthRange}
                primaryManagerName={primaryManagerNameByClient.get(card.clientId) ?? null}
              />
            ))
          )
        ) : (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum cliente encontrado com esses filtros.
          </p>
        )}
      </div>

      {openTask && (
        <TaskDrawerPanel
          task={openTask.task}
          clientId={openTask.clientId}
          clientName={openTask.clientName}
          sprintNumber={openTask.sprintNumber}
          comments={openTask.comments}
          closeHref={buildUrl({ task: "" })}
          returnTo={buildUrl({ task: "" })}
        />
      )}
    </div>
  );
}
