import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString, todayUTC } from "@/lib/today";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { fetchRecurringTaskListsForSprints } from "@/lib/recurring-task-data";
import type { PendenciaItem } from "@/lib/pendencias";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

interface TaskRowClient {
  id: string;
  name: string;
  status: string;
}

interface TaskRowAssignee {
  id: string;
  name: string;
  status: "ativo" | "inativo";
}

interface TaskRow {
  id: string;
  title: string;
  type: PendenciaItem["type"];
  status: PendenciaItem["rawStatus"];
  priority: PendenciaItem["priority"];
  due_date: string;
  notes: string | null;
  sprint_id: string | null;
  client_id: string | null;
  client: TaskRowClient | TaskRowClient[] | null;
  assignee: TaskRowAssignee | TaskRowAssignee[] | null;
}

export interface PendenciasClientOption {
  id: string;
  name: string;
}

export interface PendenciasAssigneeOption {
  id: string;
  name: string;
  status: "ativo" | "inativo";
}

export interface PendenciasRawData {
  items: PendenciaItem[];
  clientOptions: PendenciasClientOption[];
  assigneeOptions: PendenciasAssigneeOption[];
}

/**
 * Camada de dados da Etapa "Pendências" — uma única consulta a `tasks`
 * (nenhum loop por cliente: escala pros ~100 clientes da agência sem N+1),
 * com `clients`/`team_members` embutidos via FK — mesmo padrão de
 * `clients/page.tsx`/`sprints/page.tsx`. Status EFETIVO (`atrasado`
 * derivado) é calculado aqui, uma vez só, pra `lib/pendencias.ts` (filtro/
 * agrupamento puro) nunca precisar recalcular.
 *
 * Princípio "Workspace = só cliente ativo": pendência de cliente
 * pausado/encerrado nunca aparece aqui — mesmo critério de
 * `/operation`/`/sprints`/Dashboard. Pendência INTERNA (sem cliente) nunca é
 * afetada por esse filtro (não existe "cliente pausado" pra ela).
 */
export async function loadPendenciasRawData(supabase: Supabase): Promise<PendenciasRawData> {
  const [taskRows, clientRows, teamMemberRows] = await Promise.all([
    requireQuery(
      supabase
        .from("tasks")
        .select(
          "id, title, type, status, priority, due_date, notes, sprint_id, client_id, client:clients(id, name, status), assignee:team_members!tasks_assignee_id_fkey(id, name, status)",
        ),
      "tasks:pendencias",
    ),
    requireQuery(supabase.from("clients").select("id, name").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).order("name"), "clients:pendencias"),
    requireQuery(supabase.from("team_members").select("id, name, status").order("name"), "team_members:pendencias"),
  ]);

  const today = todayUTC();

  const items: PendenciaItem[] = [];
  for (const row of taskRows as unknown as TaskRow[]) {
    const client = Array.isArray(row.client) ? (row.client[0] ?? null) : row.client;
    // Workspace = só cliente ativo — pendência interna (client null) sempre
    // passa; pendência de cliente pausado/encerrado nunca aparece.
    if (client && client.status !== WORKSPACE_ACTIVE_CONTRACT_STATUS) continue;

    const assignee = Array.isArray(row.assignee) ? (row.assignee[0] ?? null) : row.assignee;

    const rawStatus = row.status;
    const status = effectiveTaskStatus({ status: rawStatus, due_date: row.due_date }, today);

    items.push({
      id: row.id,
      title: row.title,
      type: row.type,
      rawStatus,
      status,
      priority: row.priority,
      dueDate: row.due_date,
      notes: row.notes,
      sprintId: row.sprint_id,
      client: client ? { id: client.id, name: client.name } : null,
      assignee: assignee ? { id: assignee.id, name: assignee.name, status: assignee.status } : null,
    });
  }

  return {
    items,
    clientOptions: clientRows ?? [],
    assigneeOptions: (teamMemberRows ?? []) as PendenciasAssigneeOption[],
  };
}

export interface PendingRecurringTaskItem {
  recurringTaskId: string;
  title: string;
  icon: string;
  color: string;
  clientId: string;
  clientName: string;
  /** "2/4 execuções nesta semana" — já formatado (mesmo helper que
   * `/sprints` usa), pra esta seção nunca precisar reimplementar a
   * lógica de exibição de progresso. */
  progressLabel: string;
  nextExecutionLabel: string;
}

/**
 * Recorrências da sprint ATUAL de cada cliente ativo que ainda não bateram
 * a meta semanal (seção 9 do pedido: "representadas, nunca duplicadas") —
 * reaproveita `fetchRecurringTaskListsForSprints` (o mesmo núcleo batched
 * que já alimenta `/sprints`) inteiro; nada aqui recalcula progresso ou
 * grava execução — a Pendência só aponta pra onde registrar (a página do
 * cliente, onde o drawer de recorrência já existe) em vez de reconstruir
 * esse fluxo do zero.
 */
export async function loadPendingRecurringTasks(supabase: Supabase): Promise<PendingRecurringTaskItem[]> {
  const today = todayDateString();

  const [clientRows, sprintRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, name").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS), "clients:pendencias-recurring"),
    requireQuery(
      supabase.from("sprints").select("id, client_id, start_date, end_date").lte("start_date", today).gte("end_date", today),
      "sprints:pendencias-recurring",
    ),
  ]);

  if (sprintRows.length === 0) return [];

  const activeClientIds = new Set(clientRows.map((c) => c.id));
  const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));
  const currentSprints = sprintRows.filter((sprint) => activeClientIds.has(sprint.client_id));
  if (currentSprints.length === 0) return [];

  const listsBySprintId = await fetchRecurringTaskListsForSprints(supabase, currentSprints, today);

  const items: PendingRecurringTaskItem[] = [];
  for (const sprint of currentSprints) {
    const list = listsBySprintId.get(sprint.id) ?? [];
    for (const task of list) {
      // Sem meta configurada: nada a cobrar (mesmo critério de
      // `computePreviousSprintPending`, nunca é pendência sem meta). Meta
      // já batida: também não é pendência.
      if (task.progress.goal === null || task.progress.done >= task.progress.goal) continue;

      items.push({
        recurringTaskId: task.id,
        title: task.title,
        icon: task.icon,
        color: task.color,
        clientId: sprint.client_id,
        clientName: clientNameById.get(sprint.client_id) ?? "Cliente",
        progressLabel: `${task.progress.done}/${task.progress.goal} execuções nesta semana`,
        nextExecutionLabel: task.nextExecutionLabel,
      });
    }
  }

  return items.sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR") || a.title.localeCompare(b.title, "pt-BR"));
}
