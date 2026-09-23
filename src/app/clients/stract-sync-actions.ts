"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin, requireClientManagerAccess } from "@/lib/auth";
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
 * (`lib/auth.ts`) nunca dependeu dessa policy — confirma que quem está
 * logado é um usuário interno autorizado da KOFF (`team_members` ativo,
 * admin ou gestor — Etapa "Correção do Modelo de Autorização — Acesso Amplo
 * Interno"; não precisa ser o gestor principal deste cliente específico, e
 * `client_managers` não participa). `runImportForSource` (service role por
 * baixo) só é chamada depois dessa checagem.
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

/**
 * "Posicionamentos" (Etapa "Posicionamentos no Relatório") — configurar
 * `import_sources.platform_position_column` direto pela interface, sem
 * precisar do SQL Editor. Pedido explícito do usuário depois de conectar a
 * primeira conta manualmente ("quero fazer isso com todos outros clientes,
 * mas não tem um caminho mais rápido?").
 *
 * Admin-only (`requireAdmin`, não `requireClientManagerAccess`) — mesmo
 * critério de "Compartilhamento" no mesmo drawer: é configuração técnica
 * bruta (nome de coluna da origem), não uma ação operacional do dia a dia
 * como "Sincronizar agora". Campo vazio limpa a config (`null` — mesmo
 * efeito de nunca ter sido configurada, Import Service simplesmente não
 * escreve em `campaign_placement_daily_metrics` pra essa fonte).
 */
export async function setStractPlacementColumnAction(importSourceId: string, clientId: string, formData: FormData) {
  await requireAdmin();

  const raw = String(formData.get("platformPositionColumn") ?? "").trim();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("import_sources")
    .update({ platform_position_column: raw.length > 0 ? raw : null })
    .eq("id", importSourceId)
    .eq("client_id", clientId);

  const query = error ? `?error=${encodeURIComponent(toUserFacingError(error, "Não foi possível salvar a coluna de posicionamento."))}` : "";

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}${query}`);
}
