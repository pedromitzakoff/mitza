"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { rotateReportShareLink, revokeReportShareLink } from "@/lib/report-share-links";

/**
 * Etapa "Link Externo V1" — gerar/revogar o link é admin-only, nunca
 * gestor: o link contorna TODO controle de acesso normal da plataforma para
 * aquele cliente específico (mesmo critério já usado neste drawer para
 * histórico de sincronização/orçamento, `account-info-drawer.tsx`).
 *
 * A checagem de acesso ao cliente em si passa pelo client normal (RLS),
 * mesmo padrão de `stract-sync-actions.ts` — nunca confia só no `clientId`
 * recebido como argumento.
 */
async function assertAdminCanAccessClient(clientId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") {
    throw new Error("Sem permissão para gerenciar o link externo deste cliente.");
  }

  const supabase = await createSupabaseClient();
  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) {
    throw new Error("Cliente não encontrado.");
  }
}

/** Retorna só o PATH (`/r/<token>`) — a URL absoluta é montada no cliente
 * (`window.location.origin`), nunca aqui: evita confiar em qualquer header
 * de host pra algo que vai ser copiado e enviado pra fora da plataforma. */
export async function generateReportShareLinkAction(clientId: string): Promise<{ path: string } | { error: string }> {
  try {
    await assertAdminCanAccessClient(clientId);
    const token = await rotateReportShareLink(clientId);
    revalidatePath(`/clients/${clientId}`);
    return { path: `/r/${token}` };
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
