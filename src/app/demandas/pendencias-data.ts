import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayUTC } from "@/lib/today";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
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
  completed_at: string | null;
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
 *
 * Etapa "Pendências — Correção de Origem": Pendências mostra só DEMANDA
 * criada manualmente por alguém — nunca rotina operacional nem tarefa
 * gerada pelo sistema. A regra é `tasks.origin = 'manual'` — coluna
 * dedicada e explícita, gravada no momento da criação por CADA caminho que
 * insere em `tasks` (nunca inferida). Substituiu `template_id is null`:
 * esse sinal parecia suficiente mas não era — uma migration antiga (Etapa
 * 12, `global-sprint-task-templates.sql`) zerou `template_id` em massa ao
 * trocar de modelo de template, então ~124 tarefas legadas de rotina
 * (Checar saldo/Otimização/Report, geradas automaticamente antes daquela
 * troca) ficaram com `template_id` nulo — indistinguíveis de demanda por
 * esse campo. `origin` não sofre esse problema: é decidido uma vez, na
 * criação, e nunca mais recalculado.
 *
 * `.eq("origin", "manual")` é portanto a REGRA que decide "esta task
 * aparece em Pendências" — filtrada aqui, na própria query, nunca em
 * memória. Recorrências (`recurring_tasks`) nunca aparecem aqui em nenhuma
 * hipótese — são um eixo à parte (permanente, execuções em
 * `recurring_task_executions`), sem nenhuma linha em `tasks`; continuam
 * tratadas só pela Operação/`/sprints`, nunca representadas nesta página.
 */
export async function loadPendenciasRawData(supabase: Supabase, scopeClientId?: string): Promise<PendenciasRawData> {
  let taskQuery = supabase
    .from("tasks")
    .select(
      "id, title, type, status, priority, due_date, completed_at, notes, sprint_id, client_id, client:clients(id, name, status), assignee:team_members!tasks_assignee_id_fkey(id, name, status)",
    )
    .eq("origin", "manual");
  // Workspace do cliente (`/clients/[id]/demandas`, Etapa "MITZA — Reformulação
  // Estrutural"): MESMA fonte de verdade da área global — só acrescenta
  // `client_id = X` na mesma query, nunca uma segunda implementação da
  // regra `origin = 'manual'`. `clientOptions` fica vazio nesse modo (o
  // filtro de cliente não faz sentido — já é o próprio contexto).
  if (scopeClientId) taskQuery = taskQuery.eq("client_id", scopeClientId);

  const [taskRows, clientRows, teamMemberRows] = await Promise.all([
    requireQuery(taskQuery, "tasks:pendencias"),
    scopeClientId
      ? Promise.resolve([] as PendenciasClientOption[])
      : requireQuery(supabase.from("clients").select("id, name").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).order("name"), "clients:pendencias"),
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
      completedAt: row.completed_at,
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

