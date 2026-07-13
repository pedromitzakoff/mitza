"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { syncClientMetaSpend } from "@/lib/meta-sync";

/** "Atualizar dados do Meta" (por cliente) — admin-only (seção 13 do
 * pedido): antes disto, a única barreira era a RLS de leitura do cliente
 * (aberta a qualquer gestor logado, por decisão da Etapa 15), mas a escrita
 * em `daily_spend` acontece via service role (`syncClientMetaSpend`), que
 * ignora RLS — sem este `requireAdmin()`, qualquer gestor autenticado podia
 * disparar a sincronização. */
export async function syncClientMetaAction(clientId: string) {
  await requireAdmin();

  const result = await syncClientMetaSpend(clientId);
  revalidatePath(`/clients/${clientId}`);

  let query: string;
  if (result.status === "synced") {
    query = `synced=${result.daysSynced}`;
  } else if (result.status === "skipped_no_account") {
    query = `error=${encodeURIComponent("Este cliente não tem conta de anúncios da Meta configurada.")}`;
  } else {
    query = `error=${encodeURIComponent(result.errorMessage ?? "Erro ao sincronizar com o Meta")}`;
  }

  redirect(`/clients/${clientId}?${query}`);
}
