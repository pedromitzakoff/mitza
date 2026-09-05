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

/**
 * Achado real em produção: a Vercel protege por padrão a URL única de CADA
 * deployment (`mitza-<hash>-mitza.vercel.app`) com login da própria Vercel
 * ("Deployment Protection") — só o domínio de produção alocado ao projeto
 * (`mitza.vercel.app`) fica público de verdade. Se a URL fosse montada no
 * cliente via `window.location.origin`, um admin gerando o link enquanto
 * navega numa URL de deployment com hash geraria um link OK pra ele (já
 * logado na Vercel), mas inacessível pra qualquer cliente real.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` é uma env var que a própria Vercel injeta
 * automaticamente (sem precisar configurar nada) em todo build/runtime,
 * sempre com o domínio de produção real do projeto — nunca a URL do
 * deployment atual. Por isso a URL final é montada aqui, no servidor, nunca
 * no browser: garante que "Gerar link" sempre produz a mesma URL pública,
 * não importa de onde o admin estava navegando quando clicou.
 */
function resolvePublicBaseUrl(): string {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;
  // Fora da Vercel (ex.: next dev local) essa env var não existe.
  return "http://localhost:3000";
}

export async function generateReportShareLinkAction(clientId: string): Promise<{ url: string } | { error: string }> {
  try {
    await assertAdminCanAccessClient(clientId);
    const token = await rotateReportShareLink(clientId);
    revalidatePath(`/clients/${clientId}`);
    return { url: `${resolvePublicBaseUrl()}/r/${token}` };
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
