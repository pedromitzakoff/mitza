"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEnabledImportSourceIdsForClient } from "@/lib/performance-queries";
import { runImportForSource } from "@/lib/stract-sync";
import { toUserFacingError } from "@/lib/user-facing-error";
import { queryOrError } from "@/lib/require-query";

/**
 * "Sincronizar agora" — Etapa "Sincronização manual via UI": a mesma função
 * que antes só rodava via curl/Postman no endpoint administrativo
 * (`runImportForSource`, ver `/api/admin/sync-stract`) agora é acionável
 * direto pelo gestor na própria página do cliente, sem terminal/token — o
 * pedido explícito foi "um botão que eu como admin já faça esse curl só
 * clicando". Mesmo padrão de acesso de `syncClientMetaAction`: o `select`
 * em `clients` passa pela RLS, então só quem já tem acesso ao cliente
 * (admin ou gestor atribuído) consegue disparar isso.
 *
 * Sincroniza TODAS as fontes `enabled = true` do cliente de uma vez (um
 * cliente pode ter Meta Ads + Instagram ativos ao mesmo tempo) — nunca uma
 * segunda versão da orquestração, só reaproveita `runImportForSource` uma
 * vez por fonte.
 */
export async function syncClientStractSourcesAction(clientId: string) {
  const supabase = await createSupabaseClient();

  const clientResult = await queryOrError<{ id: string } | null>(
    supabase.from("clients").select("id").eq("id", clientId).maybeSingle(),
    "clients:access-check",
    "Não foi possível verificar o acesso a este cliente.",
  );

  if ("error" in clientResult) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(clientResult.error)}`);
  }
  if (!clientResult.data) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Sem acesso a este cliente")}`);
  }

  let query = "";
  try {
    const importSourceIds = await getEnabledImportSourceIdsForClient(supabase, clientId);

    if (importSourceIds.length === 0) {
      query = `?error=${encodeURIComponent("Este cliente não tem nenhuma integração ativa para sincronizar.")}`;
    } else {
      const results = await Promise.all(importSourceIds.map((importSourceId) => runImportForSource(importSourceId)));
      const failedCount = results.filter((result) => result.status === "failed").length;
      revalidatePath(`/clients/${clientId}`);
      // Sem toast de sucesso aqui (Etapa "Consolidação do status de
      // sincronização"): o bloco "Sincronização" na própria página já
      // mostra o estado real assim que recarrega — um toast genérico
      // "sincronizado com sucesso" contradizia o bloco sempre que alguma
      // fonte terminava "partial" (contava como sucesso aqui, mas o
      // bloco mostrava parcial).
      query =
        failedCount > 0
          ? `?error=${encodeURIComponent(`${failedCount} de ${results.length} fonte(s) falharam ao sincronizar — confira o histórico de execuções.`)}`
          : "";
    }
  } catch (err) {
    const message = toUserFacingError(err, "Não foi possível sincronizar os dados agora.");
    query = `?error=${encodeURIComponent(message)}`;
  }

  redirect(`/clients/${clientId}${query}`);
}
