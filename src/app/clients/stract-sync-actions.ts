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
 * Editor completo de `import_sources` (Etapa "Editor de Integração Stract")
 * — pedido explícito do usuário depois de configurar Aibou manualmente por
 * SQL: "vou ter que refazer a conexão no Stract [pra vários clientes], não
 * quero ter que refazer novamente um por um no Supabase". 17 de 26 clientes
 * Meta ativos hoje têm pelo menos uma conexão faltando (auditoria de
 * `/settings/meta-connections`) — reconfigurar isso é rotina, não exceção,
 * daí uma tela de verdade em vez de mais um campo isolado.
 *
 * Admin-only (`requireAdmin`, não `requireClientManagerAccess`) — é
 * configuração técnica bruta (nomes de coluna/tabela da origem, conta de
 * anúncio), nunca uma ação operacional do dia a dia como "Sincronizar
 * agora". Campos obrigatórios em `import_sources` (tabela, conta, colunas
 * de conta/data/investimento) são validados aqui antes de escrever — uma
 * constraint `not null` bruta do banco nunca vira a mensagem de erro que o
 * usuário vê. Os demais campos: string vazia sempre limpa a config (`null`),
 * nunca grava string vazia.
 *
 * Nunca reimplementa a validação de `account_id` (isso é
 * `validateAccountIdColumn`, `lib/import-sources.ts` — roda a cada
 * sincronização, aborta se a conta configurada aqui não bater com a real).
 * Uma configuração errada nunca corrompe dado silenciosamente: a próxima
 * sincronização falha com uma mensagem clara, visível em "Ver últimas
 * execuções".
 */
export async function updateImportSourceAction(importSourceId: string, clientId: string, formData: FormData) {
  await requireAdmin();

  function str(name: string): string {
    return String(formData.get(name) ?? "").trim();
  }
  function nullableStr(name: string): string | null {
    const value = str(name);
    return value.length > 0 ? value : null;
  }

  const tableName = str("table_name");
  const externalAccountId = str("external_account_id");
  const accountIdColumn = str("account_id_column");
  const dateColumn = str("date_column");
  const spendColumn = str("spend_column");

  if (!tableName || !externalAccountId || !accountIdColumn || !dateColumn || !spendColumn) {
    const message = "Tabela, conta de anúncio, coluna de conta, coluna de data e coluna de investimento são obrigatórias.";
    redirect(`/settings/meta-connections/${clientId}?error=${encodeURIComponent(message)}`);
  }

  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("import_sources")
    .update({
      table_name: tableName,
      external_account_id: externalAccountId,
      account_id_column: accountIdColumn,
      date_column: dateColumn,
      spend_column: spendColumn,
      enabled: formData.get("enabled") === "on",
      campaign_name_column: nullableStr("campaign_name_column"),
      campaign_name_filter: nullableStr("campaign_name_filter"),
      campaign_name_exclude: nullableStr("campaign_name_exclude"),
      campaign_id_column: nullableStr("campaign_id_column"),
      ad_set_name_column: nullableStr("ad_set_name_column"),
      ad_name_column: nullableStr("ad_name_column"),
      creative_permalink_column: nullableStr("creative_permalink_column"),
      preview_image_column: nullableStr("preview_image_column"),
      preview_image_fallback_column: nullableStr("preview_image_fallback_column"),
      impressions_column: nullableStr("impressions_column"),
      reach_column: nullableStr("reach_column"),
      clicks_column: nullableStr("clicks_column"),
      platform_position_column: nullableStr("platform_position_column"),
    })
    .eq("id", importSourceId)
    .eq("client_id", clientId);

  const query = error
    ? `?error=${encodeURIComponent(toUserFacingError(error, "Não foi possível salvar a configuração da integração."))}`
    : "?saved=1";

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/settings/meta-connections");
  redirect(`/settings/meta-connections/${clientId}${query}`);
}
