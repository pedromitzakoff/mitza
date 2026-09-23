"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
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

/**
 * Nomes de coluna "comuns" observados IDÊNTICOS em toda fonte Stract já
 * inspecionada de perto (Hi-Nutrition, Pet Fast Action, Aibou) — confirmado
 * pelo usuário como o padrão fixo do Stract (mesmo motor de extração,
 * mesmos nomes internos de campo, independente do cliente). Só os campos
 * "comuns"; objetivo (leads/vendas/carrinho) e posicionamento continuam de
 * fora de propósito — esses SÃO específicos por cliente (`metric_mappings`/
 * `platform_position_column`), nunca herdados às cegas.
 */
const STANDARD_STRACT_COLUMNS = {
  account_id_column: "insights_account_id",
  date_column: "adhoc__daily",
  spend_column: "insights_spend",
  campaign_name_column: "insights_campaign_name",
  ad_set_name_column: "insights_adset_name",
  ad_name_column: "insights_ad_name",
  creative_permalink_column: "creative_instagram_permalink_url",
  preview_image_column: "creative_thumbnail_url",
} as const;

export interface BulkStandardColumnsResult {
  clientId: string;
  patchedFields: string[];
  syncStatus: string | null;
  spendRowsWritten: number | null;
  syncError: string | null;
}

/**
 * "Aplicar padrão em todos" (Etapa "Editor de Integração Stract" — item 2)
 * — pedido explícito do usuário: "o Stract não muda o nome da tabela, é
 * igual pra todos... use um cliente que já tem tudo configurado de
 * exemplo". Preenche `STANDARD_STRACT_COLUMNS` em TODA fonte Stract que
 * ainda tiver algum desses campos vazio — NUNCA sobrescreve um valor já
 * configurado (`?? existing`, campo por campo), então uma fonte já ajustada
 * manualmente pra um caso especial nunca é tocada.
 *
 * Nunca confia cegamente: dispara `runImportForSource` pra cada fonte
 * afetada logo em seguida (`Promise.all`, mesmo padrão de
 * `syncClientStractSourcesAction`) e devolve o resultado REAL de cada
 * sincronização — uma fonte cujo nome de coluna não bate com o padrão
 * (extração configurada diferente) sincroniza 0 linhas ou falha com erro
 * claro (`validateAccountIdColumn`), nunca silenciosamente "parece
 * configurada" sem dado de verdade. `/settings/meta-connections` lê esse
 * resultado da query string e mostra uma seção "Resultado" com cada
 * cliente afetado, pra nunca depender de olhar histórico um por um.
 */
export async function applyStandardStractColumnsAction() {
  await requireAdmin();

  const supabase = await createSupabaseClient();

  const { data: sources } = await supabase
    .from("import_sources")
    .select(
      "id, client_id, enabled, account_id_column, date_column, spend_column, campaign_name_column, ad_set_name_column, ad_name_column, creative_permalink_column, preview_image_column",
    )
    .eq("provider", "stract");

  const results: BulkStandardColumnsResult[] = [];

  function isEmpty(value: string | null): boolean {
    return typeof value !== "string" || value.trim().length === 0;
  }

  for (const source of sources ?? []) {
    const patch: Database["public"]["Tables"]["import_sources"]["Update"] = {};
    if (isEmpty(source.account_id_column)) patch.account_id_column = STANDARD_STRACT_COLUMNS.account_id_column;
    if (isEmpty(source.date_column)) patch.date_column = STANDARD_STRACT_COLUMNS.date_column;
    if (isEmpty(source.spend_column)) patch.spend_column = STANDARD_STRACT_COLUMNS.spend_column;
    if (isEmpty(source.campaign_name_column)) patch.campaign_name_column = STANDARD_STRACT_COLUMNS.campaign_name_column;
    if (isEmpty(source.ad_set_name_column)) patch.ad_set_name_column = STANDARD_STRACT_COLUMNS.ad_set_name_column;
    if (isEmpty(source.ad_name_column)) patch.ad_name_column = STANDARD_STRACT_COLUMNS.ad_name_column;
    if (isEmpty(source.creative_permalink_column)) patch.creative_permalink_column = STANDARD_STRACT_COLUMNS.creative_permalink_column;
    if (isEmpty(source.preview_image_column)) patch.preview_image_column = STANDARD_STRACT_COLUMNS.preview_image_column;

    if (Object.keys(patch).length === 0) continue;

    const { error: updateError } = await supabase.from("import_sources").update(patch).eq("id", source.id);
    if (updateError) {
      results.push({ clientId: source.client_id, patchedFields: Object.keys(patch), syncStatus: null, spendRowsWritten: null, syncError: updateError.message });
      continue;
    }

    if (!source.enabled) {
      results.push({ clientId: source.client_id, patchedFields: Object.keys(patch), syncStatus: null, spendRowsWritten: null, syncError: null });
      continue;
    }

    try {
      const syncResult = await runImportForSource(source.id);
      results.push({
        clientId: source.client_id,
        patchedFields: Object.keys(patch),
        syncStatus: syncResult.status,
        spendRowsWritten: syncResult.spendRowsWritten,
        syncError: syncResult.errorMessage,
      });
    } catch (err) {
      results.push({
        clientId: source.client_id,
        patchedFields: Object.keys(patch),
        syncStatus: null,
        spendRowsWritten: null,
        syncError: toUserFacingError(err, "Falha ao sincronizar."),
      });
    }
  }

  revalidatePath("/settings/meta-connections");

  if (results.length === 0) {
    redirect("/settings/meta-connections?error=" + encodeURIComponent("Nenhuma fonte tinha campo padrão vazio pra preencher."));
  }

  redirect(`/settings/meta-connections?bulkResult=${encodeURIComponent(JSON.stringify(results))}`);
}
