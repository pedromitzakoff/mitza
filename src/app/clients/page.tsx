import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange } from "@/lib/sprint-financials";
import {
  OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES,
  OPERATIONAL_ACTIVITY_STATUS_LABEL,
} from "@/lib/operational-activity";
import type { AccountHealth } from "@/lib/attention-alerts";
import {
  buildOperationClientCard,
  type OperationClientRawData,
} from "@/app/operation/operation-data";

const HEALTH_LABEL: Record<AccountHealth, string> = {
  saudavel: "Saudável",
  atencao: "Atenção",
  critico: "Crítico",
};

const HEALTH_BADGE_CLASSES: Record<AccountHealth, string> = {
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/**
 * Listagem simples de clientes — nome, gestor(es), status da conta e
 * atividade, com busca/filtros. Não duplica as métricas completas da Visão
 * Geral: é só um diretório pra achar e abrir um cliente rápido. Reaproveita
 * buildOperationClientCard (mesmas queries em lote já usadas em Sprints e na
 * Visão Geral) só pelo status já calculado, sem inventar regra nova.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; manager?: string; health?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;
  const search = (params.search ?? "").trim().toLowerCase();
  const managerFilter = params.manager ?? "all";
  const healthFilter = params.health ?? "todos";

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = currentMonthRange(today);

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

  if (search) {
    cards = cards.filter((card) => card.clientName.toLowerCase().includes(search));
  }

  if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  if (healthFilter !== "todos") {
    cards = cards.filter((card) => card.accountHealth === healthFilter);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
        {isAdmin && (
          <Link
            href="/clients/new"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            + Novo cliente
          </Link>
        )}
      </div>

      <form method="get" className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
        <input
          name="search"
          defaultValue={search}
          placeholder="Buscar cliente..."
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none"
        />

        <select
          name="manager"
          defaultValue={managerFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="all">Gestor: todos</option>
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
          <option value="todos">Status: todos</option>
          <option value="saudavel">Saudável</option>
          <option value="atencao">Atenção</option>
          <option value="critico">Crítico</option>
        </select>

        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Filtrar
        </button>

        {(search || managerFilter !== "all" || healthFilter !== "todos") && (
          <Link href="/clients" className="text-xs text-brand hover:underline">
            Limpar filtros
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length} cliente{cards.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        {cards.length > 0 ? (
          <ul>
            {cards.map((card) => (
              <li
                key={card.clientId}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card px-3 py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${card.clientId}`} className="font-medium text-brand hover:underline">
                      {card.clientName}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${HEALTH_BADGE_CLASSES[card.accountHealth]}`}>
                      {HEALTH_LABEL[card.accountHealth]}
                    </span>
                    <span
                      className={`hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-block ${OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES[card.activityStatus]}`}
                    >
                      {OPERATIONAL_ACTIVITY_STATUS_LABEL[card.activityStatus]}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {card.managerNames.length > 0 ? card.managerNames.join(", ") : "Sem gestor atribuído"}
                  </p>
                </div>

                <Link
                  href={`/clients/${card.clientId}`}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bg-card p-4 text-sm text-muted-foreground">Nenhum cliente encontrado com esses filtros.</p>
        )}
      </div>
    </div>
  );
}
