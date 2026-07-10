"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { syncAllClientsMetaSpend } from "@/lib/meta-sync";

/** Atalho global (sidebar, admin only) pra sincronizar o Meta de todos os
 * clientes de uma vez, sem precisar entrar em cada um. */
export async function syncAllMetaAction() {
  await requireAdmin();

  const results = await syncAllClientsMetaSpend();

  revalidatePath("/");
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  redirect(`/?synced=${results.length}`);
}
