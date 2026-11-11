"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { parseDashboardMetricKeys } from "@/lib/dashboard-metrics";
import { toUserFacingError } from "@/lib/user-facing-error";

function withError(returnTo: string, message: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

/**
 * "Métricas exibidas" (Etapa "Catálogo de métricas do Dashboard") — salva
 * `clients.dashboard_metrics` direto, sem passar por `client_goals` (ponto
 * 2 do pedido: marcar um resultado aqui nunca cria/exige um objetivo).
 * Mesma permissão de sempre pra configuração de cliente (admin only,
 * `requireAdmin` — igual `updateClientPerformanceGoalAction`/
 * `setClientGoalPrimaryAction`) e mesmo padrão de erro/redirect dos outros
 * formulários simples desta página (`goal-actions.ts`).
 */
export async function updateClientDashboardMetricsAction(clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();

  const metrics = parseDashboardMetricKeys(formData.getAll("metrics").map(String));

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("clients").update({ dashboard_metrics: metrics }).eq("id", clientId);

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível salvar as métricas exibidas.")));

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/edit`);
  redirect(returnTo);
}
