"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireClientManagerAccess } from "@/lib/auth";
import { syncOneMetaApiAccount } from "@/lib/meta-api-direct-sync";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * "Sincronizar agora" pro caminho de busca direta na Meta (`provider =
 * 'meta_api'`) — mesmo botão/mesma ideia de `syncClientStractSourcesAction`
 * (`stract-sync-actions.ts`), só que chamando `syncOneMetaApiAccount`
 * (`lib/meta-api-direct-sync.ts`) em vez de `runImportForSource`, que é
 * Stract-only (não entende fonte `meta_api` — `table_name`/`account_id_column`
 * são sempre `null` pra esse provider, ver `supabase/meta-api-import-source.sql`).
 * Sincroniza TODAS as contas `meta_api` ativas do cliente de uma vez (um
 * cliente pode ter mais de uma, embora o caso comum seja uma só).
 *
 * Mesma autorização de `syncClientStractSourcesAction` (`requireClientManagerAccess`,
 * nunca dependente de RLS de SELECT — ver nota lá).
 */
export async function syncClientMetaApiSourcesAction(clientId: string) {
  await requireClientManagerAccess(clientId);

  const supabase = await createSupabaseClient();

  let query = "";
  try {
    const { data: sources, error } = await supabase
      .from("import_sources")
      .select("external_account_id")
      .eq("client_id", clientId)
      .eq("provider", "meta_api")
      .eq("enabled", true);

    if (error) throw new Error(error.message);

    const accountIds = Array.from(new Set((sources ?? []).map((s) => s.external_account_id)));

    if (accountIds.length === 0) {
      query = `?error=${encodeURIComponent("Este cliente não tem nenhuma conta de busca direta na Meta ativa pra sincronizar.")}`;
    } else {
      const results = await Promise.all(accountIds.map((accountId) => syncOneMetaApiAccount(accountId)));
      const failedCount = results.filter((result) => result.outcome !== "ok").length;
      revalidatePath(`/clients/${clientId}`);
      query =
        failedCount > 0
          ? `?error=${encodeURIComponent(`${failedCount} de ${results.length} conta(s) falharam ao sincronizar — confira o histórico de execuções.`)}`
          : "";
    }
  } catch (err) {
    const message = toUserFacingError(err, "Não foi possível sincronizar os dados agora.");
    query = `?error=${encodeURIComponent(message)}`;
  }

  redirect(`/clients/${clientId}${query}`);
}
