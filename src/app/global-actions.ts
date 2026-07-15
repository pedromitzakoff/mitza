"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { syncAllClientsMetaSpend } from "@/lib/meta-sync";
import { toUserFacingError } from "@/lib/user-facing-error";

/** Atalho global (sidebar, admin only) pra sincronizar o Meta de todos os
 * clientes de uma vez, sem precisar entrar em cada um. Falhas por cliente já
 * são silenciosas dentro de syncAllClientsMetaSpend (loga e segue pro
 * próximo); esta chamada externa cobre uma falha antes mesmo do loop
 * começar (ex.: a própria listagem de clientes), pra nunca deixar um erro
 * técnico cru subir até o error boundary genérico da tela. */
export async function syncAllMetaAction() {
  await requireAdmin();

  let syncedCount = 0;
  try {
    const results = await syncAllClientsMetaSpend();
    syncedCount = results.length;
  } catch (err) {
    toUserFacingError(err, "Não foi possível atualizar os dados da Meta neste momento.");
  }

  revalidatePath("/");
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  redirect(`/?synced=${syncedCount}`);
}
