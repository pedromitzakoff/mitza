"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import { queryOrError } from "@/lib/require-query";
import { computeInsertPosition, needsNormalization, buildNormalizedPositions } from "@/lib/agency-wallet-position";
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
 * Resolve as posições REAIS dos vizinhos informados (nunca confia num
 * número calculado no navegador) e devolve a posição de inserção — com
 * normalização de segurança da pasta de destino quando o espaço entre os
 * vizinhos já ficou pequeno demais. Erro de leitura aqui não pode virar
 * "pasta vazia" silencioso — resolveria a posição errada e persistiria
 * uma reordenação incorreta.
 */
async function resolveInsertPosition(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  clientId: string,
  targetManagerId: string | null,
  previousSiblingId: string | null,
  nextSiblingId: string | null,
): Promise<{ position: number } | { error: string }> {
  const siblingIds = [previousSiblingId, nextSiblingId].filter((id): id is string => id !== null);
  const siblingRowsResult =
    siblingIds.length > 0
      ? await queryOrError(
          supabase.from("clients").select("id, wallet_position").in("id", siblingIds),
          "clients:wallet-siblings",
          "Não foi possível verificar a posição dos clientes vizinhos.",
        )
      : { data: [] as { id: string; wallet_position: number | null }[] };
  if ("error" in siblingRowsResult) return { error: siblingRowsResult.error };

  const positionById = new Map(siblingRowsResult.data.map((row) => [row.id, row.wallet_position]));
  const prevPosition = previousSiblingId ? (positionById.get(previousSiblingId) ?? null) : null;
  const nextPosition = nextSiblingId ? (positionById.get(nextSiblingId) ?? null) : null;

  if (!needsNormalization(prevPosition, nextPosition)) {
    return { position: computeInsertPosition(prevPosition, nextPosition) };
  }

  // Mecanismo de segurança — não acontece a cada drag, só quando muitas
  // inserções no mesmo intervalo já deixaram os vizinhos colados demais.
  // Renumera a pasta de destino inteira (múltiplos de 1000), com o
  // cliente movido já na posição pedida.
  const folderQuery = targetManagerId
    ? supabase.from("clients").select("id").eq("primary_manager_id", targetManagerId)
    : supabase.from("clients").select("id").is("primary_manager_id", null);
  const folderClientsResult = await queryOrError(
    folderQuery.order("wallet_position", { ascending: true, nullsFirst: false }),
    "clients:wallet-folder",
    "Não foi possível reorganizar a pasta de destino.",
  );
  if ("error" in folderClientsResult) return { error: folderClientsResult.error };

  const orderedIds = folderClientsResult.data.map((c) => c.id).filter((id) => id !== clientId);
  const insertIndex = previousSiblingId ? orderedIds.indexOf(previousSiblingId) + 1 : 0;
  orderedIds.splice(Math.max(insertIndex, 0), 0, clientId);

  const normalized = buildNormalizedPositions(orderedIds.length);
  let resolvedPosition = normalized[0];
  for (let i = 0; i < orderedIds.length; i++) {
    if (orderedIds[i] === clientId) {
      resolvedPosition = normalized[i];
      continue;
    }
    await supabase.from("clients").update({ wallet_position: normalized[i] }).eq("id", orderedIds[i]);
  }
  return { position: resolvedPosition };
}

/**
 * Único ponto de entrada pra qualquer movimentação de cliente na árvore
 * "Contas da Agência" (Etapa "Árvore Viva 1.0") — reordenar dentro da
 * mesma pasta e trocar de gestor passam pela mesma função. Quando
 * `previousManagerId === newManagerId`, é só uma reordenação: nenhum
 * evento de troca de gestor é emitido, nenhuma tarefa é reatribuída,
 * `mode` é ignorado (nunca há diálogo de confirmação nesse caso, decidido
 * inteiramente no cliente antes de chamar esta action). Quando os dois
 * diferem, é uma transferência de responsabilidade de verdade — mesmo
 * comportamento já validado antes:
 *
 * `mode === "account_and_open_tasks"` reatribui só as tarefas ainda abertas
 * (`pendente`/`atrasado`) do cliente que estavam com o gestor anterior —
 * espelha exatamente a mesma transação que `performUpdateTask`
 * (`clients/tasks-actions.ts`) já faz numa reatribuição manual de tarefa
 * (mesmo `reassignment_count`, mesmo evento `task_reassigned`), só que em
 * lote. Tarefas concluídas (`feito`) ou não realizadas (`nao_realizado`),
 * comentários, revisões de conta e qualquer `operational_event` já
 * registrado nunca são tocados.
 *
 * `primary_manager_id` e `wallet_position` são sempre escritos num único
 * `update` — nunca existe estado intermediário em que um já mudou e o
 * outro não.
 */
export async function moveClientAction(
  clientId: string,
  previousManagerId: string | null,
  newManagerId: string | null,
  previousSiblingId: string | null,
  nextSiblingId: string | null,
  mode: ClientTransferMode = "account_only",
): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const positionResult = await resolveInsertPosition(supabase, clientId, newManagerId, previousSiblingId, nextSiblingId);
  if ("error" in positionResult) return { error: positionResult.error };

  const { error } = await supabase
    .from("clients")
    .update({ primary_manager_id: newManagerId, wallet_position: positionResult.position })
    .eq("id", clientId);

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível mover o cliente.") };
  }

  const isManagerChange = previousManagerId !== newManagerId;
  if (!isManagerChange) {
    revalidatePath("/", "layout");
    return {};
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
    const openTasksResult = await queryOrError(
      supabase
        .from("tasks")
        .select("id, sprint_id, reassignment_count")
        .eq("client_id", clientId)
        .eq("assignee_id", previousManagerId)
        .in("status", OPEN_TASK_STATUSES),
      "tasks:reassign-open",
      "O cliente foi movido, mas não foi possível reatribuir as atividades abertas.",
    );
    if ("error" in openTasksResult) {
      // A troca de responsável já foi commitada — revalida antes de
      // devolver o erro, senão a árvore ficaria mostrando o estado antigo
      // enquanto o banco já reflete a mudança.
      revalidatePath("/", "layout");
      revalidatePath("/clients");
      revalidatePath(`/clients/${clientId}`);
      revalidatePath("/sprints");
      return { error: openTasksResult.error };
    }

    for (const task of openTasksResult.data) {
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
