"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { syncClientMetaSpend } from "@/lib/meta-sync";
import { toUserFacingError } from "@/lib/user-facing-error";

export async function syncClientMetaAction(clientId: string) {
  const supabase = await createSupabaseClient();

  // RLS garante que o select só retorna o cliente se o usuário for admin
  // ou gestor atribuído a ele — a checagem de acesso é essa.
  const { data: client } = await supabase.from("clients").select("id").eq("id", clientId).single();

  if (!client) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Sem acesso a este cliente")}`);
  }

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
