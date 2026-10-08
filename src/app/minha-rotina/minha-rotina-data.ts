import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { effectiveTaskStatus } from "@/lib/task-status";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { loadAgencyAccountsTree } from "@/lib/agency-accounts-tree-data";
import { fetchRecurringTaskListsForSprints } from "@/lib/recurring-task-data";
import {
  demandaBucket,
  endOfWeek,
  resolveMyClients,
  rotinaBucket,
  type MinhaRotinaDemandaItem,
  type MinhaRotinaItem,
  type MinhaRotinaRotinaItem,
} from "@/lib/minha-rotina";
import type { TaskPriority, TaskStatus } from "@/lib/supabase/database.types";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

interface DemandaTaskRowClient {
  id: string;
  name: string;
  status: string;
}

interface DemandaTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  client_id: string | null;
  client: DemandaTaskRowClient | DemandaTaskRowClient[] | null;
}

/**
 * MITZA ONE — Minha Rotina: Demandas atribuídas ao gestor logado (Fase 4,
 * "regra correta" aprovada: `assignee_id`, não `primary_manager_id` do
 * cliente — uma demanda pode ser de um cliente que não é seu, mas
 * atribuída a você, e o inverso também; `assignee_id` é o único sinal que
 * responde "é minha responsabilidade FAZER isto"). MESMA tabela/campos/
 * regra de `loadPendenciasRawData` (`app/demandas/pendencias-data.ts`) —
 * só o filtro de `assignee_id` muda, escopado no SERVIDOR (nunca um filtro
 * só visual em cima da lista inteira da agência). Workspace = só cliente
 * ativo, mesmo princípio de sempre; demanda interna (sem cliente) nunca é
 * afetada por esse filtro.
 */
async function loadMyDemandas(supabase: Supabase, teamMemberId: string, today: string, weekEnd: string): Promise<MinhaRotinaDemandaItem[]> {
  const rows = await requireQuery(
    supabase
      .from("tasks")
      .select("id, title, status, priority, due_date, client_id, client:clients(id, name, status)")
      .eq("origin", "manual")
      .eq("assignee_id", teamMemberId),
    "tasks:minha-rotina",
  );

  const items: MinhaRotinaDemandaItem[] = [];
  for (const row of rows as unknown as DemandaTaskRow[]) {
    const client = Array.isArray(row.client) ? (row.client[0] ?? null) : row.client;
    if (client && client.status !== WORKSPACE_ACTIVE_CONTRACT_STATUS) continue;

    const status = effectiveTaskStatus({ status: row.status, due_date: row.due_date }, new Date(`${today}T00:00:00Z`));
    // Minha Rotina é execução do dia a dia — nunca mostra o que já foi
    // resolvido (feito/não realizado), mesma convenção de "abertas" em
    // Pendências, só que sem toggle "mostrar concluídas" (não existe nesta
    // tela, seção 2/3 do pedido: lista de execução, não arquivo).
    if (status === "feito" || status === "nao_realizado") continue;

    items.push({
      kind: "demanda",
      id: row.id,
      title: row.title,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      dueDate: row.due_date,
      status,
      priority: row.priority,
      bucket: demandaBucket({ status, dueDate: row.due_date }, today, weekEnd),
    });
  }
  return items;
}

interface CurrentSprintRow {
  id: string;
  client_id: string;
  start_date: string;
  end_date: string;
}

/**
 * MITZA ONE — Minha Rotina: Rotinas dos clientes em que o gestor logado é
 * o PRINCIPAL (Fase 4 — rotina não tem `assignee_id` próprio, o único sinal
 * de responsabilidade disponível é o dono do cliente, `primary_manager_id`
 * — mesmo campo que `agency-accounts-tree.ts` já usa pra agrupar a Sidebar,
 * nenhuma segunda fonte). Busca a sprint CORRENTE de cada cliente (hoje
 * dentro de `[start_date, end_date]`, filtrado no próprio SQL — nunca busca
 * todas as sprints do cliente pra filtrar em memória) e reaproveita
 * `fetchRecurringTaskListsForSprints` (já batched pra várias sprints de
 * vários clientes de uma vez, mesma função que `/sprints` usa), SEM
 * nenhuma segunda implementação da regra de recorrência/meta semanal.
 */
async function loadMyRotinas(supabase: Supabase, myClientIds: string[], myClientNameById: Map<string, string>, today: string): Promise<MinhaRotinaRotinaItem[]> {
  if (myClientIds.length === 0) return [];

  const sprintRows = await requireQuery(
    supabase
      .from("sprints")
      .select("id, client_id, start_date, end_date")
      .in("client_id", myClientIds)
      .lte("start_date", today)
      .gte("end_date", today),
    "sprints:minha-rotina-current",
  );

  const currentSprints = sprintRows as unknown as CurrentSprintRow[];
  if (currentSprints.length === 0) return [];

  const listsBySprintId = await fetchRecurringTaskListsForSprints(supabase, currentSprints, today);

  const items: MinhaRotinaRotinaItem[] = [];
  for (const sprint of currentSprints) {
    const list = listsBySprintId.get(sprint.id) ?? [];
    const clientName = myClientNameById.get(sprint.client_id);
    if (!clientName) continue;

    for (const task of list) {
      // Sem próxima execução a mostrar (sem meta configurada ou meta já
      // batida nesta sprint) — nunca entra na lista; "Minha Rotina" só
      // mostra o que precisa ser feito, nunca um item sem ação pendente
      // (seção "Estados importantes" do pedido: "não inventar datas").
      if (task.nextExecutionDate === null) continue;

      items.push({
        kind: "rotina",
        id: task.id,
        title: task.title,
        clientId: sprint.client_id,
        clientName,
        sprintId: sprint.id,
        sprintStartDate: sprint.start_date,
        sprintEndDate: sprint.end_date,
        nextExecutionLabel: task.nextExecutionLabel,
        dueDate: task.nextExecutionDate,
        bucket: rotinaBucket(task.nextExecutionDate, today),
        progress: task.progress,
        canOneClick: !task.hasChecklist && !task.usesAccountReview && !task.usesReport,
        hasChecklist: task.hasChecklist,
        usesAccountReview: task.usesAccountReview,
        usesReport: task.usesReport,
      });
    }
  }
  return items;
}

export interface MinhaRotinaRawData {
  items: MinhaRotinaItem[];
}

/**
 * Camada de dados da Minha Rotina — consolida Demandas (por `assignee_id`)
 * e Rotinas (por `primary_manager_id` do cliente) do gestor logado, cada
 * uma pela sua PRÓPRIA regra de responsabilidade (auditoria da Fase 0,
 * aprovada pelo usuário). `loadAgencyAccountsTree` é `cache()` do React —
 * reaproveita a MESMA busca que o layout raiz já fez nesta requisição
 * (`app/layout.tsx`), nunca uma segunda ida ao banco só pra achar "meus
 * clientes".
 */
export async function loadMinhaRotinaRawData(supabase: Supabase, teamMemberId: string, today: string): Promise<MinhaRotinaRawData> {
  const weekEnd = endOfWeek(today);

  const tree = await loadAgencyAccountsTree();
  const myClients = resolveMyClients(tree, teamMemberId);
  const myClientIds = myClients.map((c) => c.id);
  const myClientNameById = new Map(myClients.map((c) => [c.id, c.name]));

  const [demandas, rotinas] = await Promise.all([
    loadMyDemandas(supabase, teamMemberId, today, weekEnd),
    loadMyRotinas(supabase, myClientIds, myClientNameById, today),
  ]);

  return { items: [...demandas, ...rotinas] };
}
