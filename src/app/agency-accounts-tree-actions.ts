"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import { queryOrError } from "@/lib/require-query";
import { computeInsertPosition, needsNormalization, buildNormalizedPositions } from "@/lib/agency-wallet-position";

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
 * evento de troca de gestor é emitido (decidido inteiramente no cliente
 * antes de chamar esta action). Quando os dois diferem, é uma
 * transferência de responsabilidade de verdade.
 *
 * `primary_manager_id` e `wallet_position` são sempre escritos num único
 * `update` — nunca existe estado intermediário em que um já mudou e o
 * outro não.
 *
 * Habilitar Gestores 2.0: qualquer gestor ativo pode mover qualquer
 * cliente, pra qualquer pasta, exatamente como o admin já fazia — sem
 * restrição por carteira. RLS (`clients_update`, ver
 * supabase/manager-move-clients-tree.sql) só libera as colunas
 * `primary_manager_id`/`wallet_position`; um trigger barra qualquer outra
 * alteração em `clients` fora de uma sessão admin, então esta ação
 * continua sem poder tocar dados cadastrais/contratuais do cliente mesmo
 * pra quem não é admin.
 *
 * KOFF Analytics — Etapa 1.9: a reatribuição em lote de tarefas abertas
 * do gestor anterior (`mode === "account_and_open_tasks"`) foi removida —
 * rastreamento de tarefas não tem lugar numa plataforma de análise de
 * performance. A transferência move só a responsabilidade da conta.
 */
export async function moveClientAction(
  clientId: string,
  previousManagerId: string | null,
  newManagerId: string | null,
  previousSiblingId: string | null,
  nextSiblingId: string | null,
): Promise<{ error?: string }> {
  const profile = await requireActiveProfile();
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

  revalidatePath("/", "layout");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);

  return {};
}
