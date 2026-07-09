"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

function readClientFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    meta_ad_account_id: String(formData.get("meta_ad_account_id") ?? "").trim(),
    managerIds: formData.getAll("manager_ids").map(String),
  };
}

export async function createClientAction(formData: FormData) {
  await requireAdmin();
  const { name, meta_ad_account_id, managerIds } = readClientFields(formData);
  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase
    .from("clients")
    .insert({ name, meta_ad_account_id })
    .select("id")
    .single();

  if (error || !client) {
    redirect(`/clients/new?error=${encodeURIComponent(error?.message ?? "Erro ao criar cliente")}`);
  }

  if (managerIds.length > 0) {
    await supabase
      .from("client_managers")
      .insert(managerIds.map((user_id) => ({ client_id: client.id, user_id })));
  }

  revalidatePath("/");
  redirect(`/clients/${client.id}`);
}

export async function updateClientAction(clientId: string, formData: FormData) {
  await requireAdmin();
  const { name, meta_ad_account_id, managerIds } = readClientFields(formData);
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("clients")
    .update({ name, meta_ad_account_id })
    .eq("id", clientId);

  if (error) {
    redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  await supabase.from("client_managers").delete().eq("client_id", clientId);

  if (managerIds.length > 0) {
    await supabase
      .from("client_managers")
      .insert(managerIds.map((user_id) => ({ client_id: clientId, user_id })));
  }

  revalidatePath("/");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
