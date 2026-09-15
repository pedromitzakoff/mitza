"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClientManagerAccess } from "@/lib/auth";
import { syncClientMetaSpend } from "@/lib/meta-sync";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * Auditoria de Segurança (Achado #1, rodada "Security Regression Audit"):
 * até aqui a autorização desta action era um SELECT em `clients` — comentário
 * antigo dizia "RLS garante que o select só retorna o cliente se o usuário
 * for admin ou gestor atribuído a ele". Isso deixou de ser verdade quando
 * `supabase/operation-collaboration-rls.sql` (Etapa "Consolidação da
 * Operação") reabriu `clients_select` pra `auth.uid() is not null` — QUALQUER
 * usuário autenticado passa a ler qualquer cliente (deliberado, pra
 * colaboração na Operação). Como o SELECT nunca mais falha pra ninguém
 * logado, ele tinha virado um no-op de autorização — só filtrava ID
 * inexistente, nunca "este usuário pode mexer neste cliente".
 *
 * `requireClientManagerAccess(clientId)` (`lib/auth.ts`) substitui isso por
 * autorização EXPLÍCITA, que nunca dependeu do RLS de SELECT: confirma que
 * quem está logado é um usuário interno autorizado da KOFF (`team_members`
 * ativo, admin ou gestor — Etapa "Correção do Modelo de Autorização —
 * Acesso Amplo Interno") — não precisa ser o `primary_manager_id` deste
 * cliente específico, e `client_managers` não participa da decisão.
 * Qualquer perfil sem vínculo interno ativo é redirecionado (`/`) antes de
 * qualquer escrita. `syncClientMetaSpend` (que usa `createAdminClient()`/
 * service role por baixo) só é alcançada DEPOIS dessa checagem — nunca antes.
 */
export async function syncClientMetaAction(clientId: string) {
  await requireClientManagerAccess(clientId);

  let query: string;
  try {
    const result = await syncClientMetaSpend(clientId);
    revalidatePath(`/clients/${clientId}`);
    query = `synced=${result.daysSynced}`;
  } catch (err) {
    const message = toUserFacingError(err, "Não foi possível atualizar os dados da Meta neste momento.");
    query = `error=${encodeURIComponent(message)}`;
  }

  redirect(`/clients/${clientId}?${query}`);
}
