"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireClientManagerAccess } from "@/lib/auth";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { ExplorationLevel } from "./cockpit-ad-exploration-section";

function buildUpdatePayload(level: ExplorationLevel, columnIds: string[]) {
  switch (level) {
    case "campaigns":
      return { exploration_columns_campaigns: columnIds };
    case "adsets":
      return { exploration_columns_adsets: columnIds };
    case "ads":
      return { exploration_columns_ads: columnIds };
  }
}

/**
 * "Persistência das colunas da tabela de exploração" (pedido explícito do
 * usuário: a seleção de colunas de Campanhas/Conjuntos/Anúncios precisa
 * "ficar salva pra todos e pra sempre" e "se replicar para o dash na
 * versão do cliente") — substitui o antigo `localStorage` (por
 * dispositivo, nunca compartilhado) por `clients.exploration_columns_*`.
 * Mesmo gate de acesso amplo interno dos outros formulários desta página
 * (`requireClientManagerAccess`, hoje idêntico a `requireActiveProfile`) —
 * não `requireAdmin`, já que o seletor de colunas sempre foi editável por
 * qualquer gestor, nunca restrito a admin.
 */
export async function updateExplorationColumnsAction(
  clientId: string,
  level: ExplorationLevel,
  columnIds: string[],
): Promise<{ error?: string }> {
  await requireClientManagerAccess(clientId);

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update(buildUpdatePayload(level, columnIds))
    .eq("id", clientId);

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível salvar as colunas.") };
  }

  // Mesmo raio de propagação do `buildCockpitViewModel`/
  // `loadCockpitExplorationPageData` (ambos leem `exploration_columns_*`):
  // cobre o Cockpit, as páginas dedicadas de Campanhas/Anúncios e, por já
  // serem renderizadas sem cache estático de página, o link público
  // (`/r/[token]`) automaticamente na próxima visita.
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/campanhas`);
  revalidatePath(`/clients/${clientId}/anuncios`);
  return {};
}
