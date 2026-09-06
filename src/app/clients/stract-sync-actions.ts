"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireClientManagerAccess } from "@/lib/auth";
import { getEnabledImportSourceIdsForClient } from "@/lib/performance-queries";
import { runImportForSource } from "@/lib/stract-sync";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * "Sincronizar agora" — Etapa "Sincronização manual via UI": a mesma função
 * que antes só rodava via curl/Postman no endpoint administrativo
 * (`runImportForSource`, ver `/api/admin/sync-stract`) agora é acionável
 * direto pelo gestor na própria página do cliente, sem terminal/token — o
 * pedido explícito foi "um botão que eu como admin já faça esse curl só
 * clicando".
 *
 * Sincroniza TODAS as fontes `enabled = true` do cliente de uma vez (um
 * cliente pode ter Meta Ads + Instagram ativos ao mesmo tempo) — nunca uma
 * segunda versão da orquestração, só reaproveita `runImportForSource` uma
 * vez por fonte.
 *
 * Auditoria de Segurança (Achado #1, rodada "Security Regression Audit"):
 * a autorização aqui era o mesmo SELECT em `clients` de `syncClientMetaAction`
 * — dependia de `clients_select` (RLS) só deixar passar quem tinha acesso.
 * `supabase/operation-collaboration-rls.sql` reabriu essa policy pra
 * "qualquer autenticado" (deliberado, pra colaboração na Operação), o que
 * transformou aquele SELECT num no-op de autorização. `requireClientManagerAccess`
 * (`lib/auth.ts`) nunca dependeu dessa policy — lê o conteúdo de
 * `client_managers`/`primary_manager_id` e decide pela identidade real de
 * quem está logado, admin sempre passa. `runImportForSource` (service role
 * por baixo) só é chamada depois dessa checagem.
 */
export async function syncClientStractSourcesAction(clientId: string) {
  await requireClientManagerAccess(clientId);

  const supabase = await createSupabaseClient();

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
