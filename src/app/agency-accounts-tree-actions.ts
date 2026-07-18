"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { TaskStatus } from "@/lib/supabase/database.types";

const OPEN_TASK_STATUSES: TaskStatus[] = ["pendente", "atrasado"];

/**
 * Conta atividades abertas do cliente atribuídas a um gestor específico —
 * usado pelo drag and drop da árvore "Contas da Agência" pra decidir se
 * mostra a confirmação simples ou a escolha "só a conta / conta e
 * atividades". Só considera `assignee_id` (fonte única de atribuição de
 * tarefa/atividade — nunca existiu tabela separada pra isso) e os dois
 * status não-terminais (`feito`/`nao_realizado` nunca entram aqui).
 */
export async function getOpenTaskCountForManagerAction(
  clientId: string,
  managerId: string,
): Promise<{ count: number } | { error: string }> {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("assignee_id", managerId)
    .in("status", OPEN_TASK_STATUSES);

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível verificar as atividades abertas.") };
  }
  return { count: count ?? 0 };
}

export type ClientTransferMode = "account_only" | "account_and_open_tasks";

/**
 * Transfere a responsabilidade principal de um cliente (`clients.primary_manager_id`
 * — fonte única, nunca `client_managers`) pra outro gestor, ou pra nenhum
 * (`null`, bucket "Sem responsável"). Admin-only, mesma regra já aplicada
 * em `updateClientAction` (`clients/actions.ts`) — não abre nem restringe
 * nenhuma permissão existente.
 *
 * `mode === "account_and_open_tasks"` reatribui só as tarefas ainda abertas
 * (`pendente`/`atrasado`) do cliente que estavam com o gestor anterior —
 * espelha exatamente a mesma transação que `performUpdateTask`
 * (`clients/tasks-actions.ts`) já faz numa reatribuição manual de tarefa
 * (mesmo `reassignment_count`, mesmo evento `task_reassigned`), só que em
 * lote. Tarefas concluídas (`feito`) ou não realizadas (`nao_realizado`),
 * comentários, revisões de conta e qualquer `operational_event` já
 * registrado nunca são tocados — preserva quem executou cada ação no
 * histórico, independente de quem é o responsável hoje.
 */
export async function transferClientManagerAction(
  clientId: string,
  previousManagerId: string | null,
  newManagerId: string | null,
  mode: ClientTransferMode,
): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase.from("clients").update({ primary_manager_id: newManagerId }).eq("id", clientId);

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível transferir o cliente.") };
  }

  const actor = actorFromProfile(profile);

  await recordOperationalEvent(supabase, actor, {
    eventType: OperationalEventType.CLIENT_MANAGER_CHANGED,
    entityType: "client",
    entityId: clientId,
    clientId,
    source: "web",
    metadata: {
      role: "primary",
      previous_manager_team_member_id: previousManagerId,
      new_manager_team_member_id: newManagerId,
      origin: "agency_accounts_tree_drag",
    },
  });

  if (mode === "account_and_open_tasks" && previousManagerId) {
    const { data: openTasks } = await supabase
      .from("tasks")
      .select("id, sprint_id, reassignment_count")
      .eq("client_id", clientId)
      .eq("assignee_id", previousManagerId)
      .in("status", OPEN_TASK_STATUSES);

    for (const task of openTasks ?? []) {
      const { error: taskError } = await supabase
        .from("tasks")
        .update({ assignee_id: newManagerId, reassignment_count: (task.reassignment_count ?? 0) + 1 })
        .eq("id", task.id);

      if (taskError) continue;

      await recordOperationalEvent(supabase, actor, {
        eventType: OperationalEventType.TASK_REASSIGNED,
        entityType: "task",
        entityId: task.id,
        clientId,
        sprintId: task.sprint_id,
        source: "web",
        metadata: {
          previous_assignee_team_member_id: previousManagerId,
          new_assignee_team_member_id: newManagerId,
          origin: "agency_accounts_tree_drag",
        },
      });
    }
  }

  revalidatePath("/", "layout");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");

  return {};
}
