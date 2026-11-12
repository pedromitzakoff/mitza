"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { rotateReportShareLink, revokeReportShareLink, resolvePublicShareLinkBaseUrl } from "@/lib/report-share-links";

/**
 * Etapa "Link Externo V1" — gerar/revogar o link é admin-only, nunca
 * gestor: o link contorna TODO controle de acesso normal da plataforma para
 * aquele cliente específico (mesmo critério já usado neste drawer para
 * histórico de sincronização/orçamento, `account-info-drawer.tsx`).
 *
 * A checagem de acesso ao cliente em si passa pelo client normal (RLS),
 * mesmo padrão de `meta-api-sync-actions.ts` — nunca confia só no `clientId`
 * recebido como argumento.
 */
async function assertAdminCanAccessClient(clientId: string): Promise<{ name: string }> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    throw new Error("Sem permissão para gerenciar o link externo deste cliente.");
  }

  const supabase = await createSupabaseClient();
  const { data: client } = await supabase.from("clients").select("id, name").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) {
    throw new Error("Cliente não encontrado.");
  }
  return { name: client.name };
}

export async function generateReportShareLinkAction(clientId: string): Promise<{ url: string } | { error: string }> {
  try {
    const { name } = await assertAdminCanAccessClient(clientId);
    const slug = await rotateReportShareLink(clientId, name);
    revalidatePath(`/clients/${clientId}`);
    return { url: `${resolvePublicShareLinkBaseUrl()}/r/${slug}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível gerar o link." };
  }
}

export async function revokeReportShareLinkAction(clientId: string): Promise<{ error?: string }> {
  try {
    await assertAdminCanAccessClient(clientId);
    await revokeReportShareLink(clientId);
    revalidatePath(`/clients/${clientId}`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível revogar o link." };
  }
}
