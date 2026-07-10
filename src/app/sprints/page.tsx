import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { formatFullDate } from "@/lib/format";
import { sortByPriority } from "@/lib/priority-accounts";
import type { CommentItem } from "@/app/clients/comment-thread";
import {
  buildOperationClientCard,
  matchesOperationMode,
  type OperationClientRawData,
  type OperationMode,
  type OperationTaskItem,
  type SprintFilterBucket,
} from "@/app/operation/operation-data";
import { SprintClientGroup } from "./client-group";
import { TaskDrawerPanel } from "@/app/operation/task-drawer-panel";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";

const MODE_LABEL: Record<OperationMode, string> = {
  hoje: "Hoje",
  sprint: "Sprint atual",
  todos: "Todos os clientes",
};

export default async function SprintsPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    manager?: string;
    month?: string;
    search?: string;
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

  const mode: OperationMode =
    params.mode === "sprint" || params.mode === "todos" ? params.mode : "hoje";
  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");
  const search = (params.search ?? "").trim().toLowerCase();
  const healthFilter = params.health ?? "todos";
  const activityFilter = params.activity ?? "todos";
  const sprintFilter = (params.sprint ?? "todas") as SprintFilterBucket | "todas";

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(params.month, today);

  const supabase = await createSupabaseClient();

  const [
    { data: clients },
    { data: clientManagers },
    { data: gestores },
    { data: sprints },
    { data: dailySpend },
    { data: tasks },
  ] = await Promise.all([
    supabase.from("clients").select("id, name, meta_ad_account_id").is("deleted_at", null).order("name"),
    supabase.from("client_managers").select("client_id, user_id, profiles(id, name)"),
    supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
    supabase
      .from("sprints")
      .select("id, client_id, start_date, end_date, planned_spend")
      .gte("start_date", firstDay)
      .lte("start_date", lastDay),
    supabase
      .from("daily_spend")
      .select("client_id, date, spend, synced_at")
      .gte("date", firstDay)
      .lte("date", lastDay),
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

  type SprintRow = { id: string; client_id: string; start_date: string; end_date: string; planned_spend: number };
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

  let cards = rawClients.map((client) => buildOperationClientCard(client, today));

  // Escopo por gestor: admin default "todos"; gestor default "meus
  // clientes". Qualquer gestor pode trocar pra ver outro (colaboração).
  if (managerFilter === "me") {
    cards = cards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  if (search) {
    cards = cards.filter((card) => card.clientName.toLowerCase().includes(search));
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

  cards = cards.filter((card) => matchesOperationMode(card, mode));
  cards = sortByPriority(cards);

  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    next.set("mode", mode);
    next.set("manager", managerFilter);
    if (params.month) next.set("month", params.month);
    if (search) next.set("search", search);
    if (healthFilter !== "todos") next.set("health", healthFilter);
    if (activityFilter !== "todos") next.set("activity", activityFilter);
    if (sprintFilter !== "todas") next.set("sprint", sprintFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/sprints?${next.toString()}`;
  };

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
      const found = card.sprintTasks.find((t) => t.id === openTaskId) ??
        card.todayAndOverdueTasks.find((t) => t.id === openTaskId);
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

      <div className="mt-3 flex flex-wrap gap-2">
        {(Object.keys(MODE_LABEL) as OperationMode[]).map((m) => (
          <Link
            key={m}
            href={buildUrl({ mode: m })}
            className={`rounded-md px-3 py-1 text-sm font-medium ${
              m === mode
                ? "bg-brand text-white"
                : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            }`}
          >
            {MODE_LABEL[m]}
          </Link>
        ))}
      </div>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        <input type="hidden" name="mode" value={mode} />

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

        <input
          name="search"
          defaultValue={search}
          placeholder="Buscar cliente..."
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none"
        />

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
          search ||
          healthFilter !== "todos" ||
          activityFilter !== "todos" ||
          sprintFilter !== "todas") && (
          <Link
            href={buildUrl({ manager: isAdmin ? "all" : "me", search: "", health: "", activity: "", sprint: "" })}
            className="text-xs text-brand hover:underline"
          >
            Limpar filtros
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length} cliente{cards.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {cards.length > 0 ? (
          cards.map((card) => (
            <SprintClientGroup key={card.clientId} card={card} mode={mode} returnTo={buildUrl({})} />
          ))
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
