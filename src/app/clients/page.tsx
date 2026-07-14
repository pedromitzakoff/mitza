import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange, findSprintForDate, isDateWithinPeriod } from "@/lib/sprint-financials";
import { computeMonthProjection } from "@/lib/client-metrics";
import { formatCurrency, formatRelationshipDuration } from "@/lib/format";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import {
  buildOperationClientCard,
  type OperationClientRawData,
} from "@/app/operation/operation-data";

/**
 * Listagem simples de clientes — nome, status contratual, tempo de
 * relacionamento, projeção do mês, gestor principal, com busca/filtro. Não
 * duplica as métricas completas da Visão Geral: é só um diretório pra achar
 * e abrir um cliente rápido. Saúde/atividade operacional continuam
 * calculadas (buildOperationClientCard) mas não aparecem aqui — só na
 * Sprints e na Visão Geral, pra não misturar status contratual com
 * operacional nesta tela.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; manager?: string; status?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;
  const search = (params.search ?? "").trim().toLowerCase();
  const managerFilter = params.manager ?? "all";
  const statusFilter = (params.status ?? "todos") as ClientContractStatus | "todos";

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = currentMonthRange(today);

  const supabase = await createSupabaseClient();

  const [
    { data: clients },
    { data: gestores },
    { data: sprints },
    { data: dailySpend },
    { data: tasks },
    { data: plannedAllocations },
    { data: budgetChanges },
  ] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, meta_ad_account_id, status, contract_start_date, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
    // Sobreposição com o mês (não "começa no mês") — sprint que atravessa
    // mês precisa ser encontrada mesmo com start_date do mês anterior.
    supabase
      .from("sprints")
      .select("id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
      .lte("start_date", lastDay)
      .gte("end_date", firstDay),
    supabase
      .from("daily_spend")
      .select("client_id, date, spend, synced_at")
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("tasks")
      .select(
        "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
      ),
    supabase
      .from("sprint_planned_allocations")
      .select("client_id, sprint_id, date, planned_amount")
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("monthly_budget_changes")
      .select("client_id, new_amount, changed_at")
      .eq("month", firstDay),
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

  const rawClients: OperationClientRawData[] = (clients ?? []).map((client) => {
    const clientSprints = sprintsByClient.get(client.id) ?? [];
    const currentSprint = findSprintForDate(clientSprints, todayStr);

    return {
      id: client.id,
      name: client.name,
      metaAdAccountId: client.meta_ad_account_id,
      // Etapa 62: fonte única do gestor atribuído — clients.primary_manager_id.
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

  let cards = rawClients.map((client) => buildOperationClientCard(client, today));

  // Dados estruturais (Etapa 27) — status contratual, início de contrato e
  // gestor principal não fazem parte de buildOperationClientCard (que é só
  // operacional), então ficam num map à parte, indexado pelo mesmo clientId.
  const clientMetaById = new Map(
    (clients ?? []).map((c) => [
      c.id,
      { status: c.status, contractStartDate: c.contract_start_date, primaryManagerName: c.primary_manager?.name ?? null },
    ]),
  );

  if (search) {
    cards = cards.filter((card) => card.clientName.toLowerCase().includes(search));
  }

  if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  if (statusFilter !== "todos") {
    cards = cards.filter((card) => clientMetaById.get(card.clientId)?.status === statusFilter);
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
          name="status"
          defaultValue={statusFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="todos">Status: todos</option>
          <option value="ativo">Ativo</option>
          <option value="pausado">Pausado</option>
          <option value="encerrado">Encerrado</option>
        </select>

        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Filtrar
        </button>

        {(search || managerFilter !== "all" || statusFilter !== "todos") && (
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
            {cards.map((card) => {
              const meta = clientMetaById.get(card.clientId);
              const projection = computeMonthProjection(card.monthPlanned, card.monthActual, today);
              return (
                <li
                  key={card.clientId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card px-3 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/clients/${card.clientId}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {card.clientName}
                      </Link>
                      {meta && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[meta.status]}`}
                        >
                          {CLIENT_STATUS_LABEL[meta.status]}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{formatRelationshipDuration(meta?.contractStartDate ?? null, today)}</span>
                      <span>
                        Projeção:{" "}
                        {card.monthPlanned > 0 ? formatCurrency(projection.projectedSpend) : "—"}
                      </span>
                      <span>{meta?.primaryManagerName ?? "Sem gestor"}</span>
                    </p>
                  </div>

                  <Link
                    href={`/clients/${card.clientId}`}
                    className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Abrir
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bg-card p-4 text-sm text-muted-foreground">Nenhum cliente encontrado com esses filtros.</p>
        )}
      </div>
    </div>
  );
}
