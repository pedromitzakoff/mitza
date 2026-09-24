"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import {
  createClientFunnel,
  updateClientFunnel,
  setClientFunnelActive,
  saveCampaignFunnelAssignments,
  type ClientFunnelInput,
} from "@/lib/client-funnels-data";
import { normalizeNamingKey, isValidNamingKey, sanitizeFunnelIndicators } from "@/lib/client-funnels";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * Server actions da seção "Funis" (Etapa "Gestão de Funis Estratégicos por
 * Cliente") — criar/editar/desativar funis + classificar campanhas em lote.
 * Permissão: admin only (mesma regra de RLS de `client_funnels`/
 * `campaign_funnel_assignments`, ver `supabase/client-funnels.sql`) — um
 * gestor sem esse papel continua vendo a seção só como leitura (a UI nunca
 * mostra os formulários pra quem não é admin, ver `funnels-section.tsx`).
 */

function withError(returnTo: string, message: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

function parseResultType(value: FormDataEntryValue | null): PerformanceGoal | null {
  const raw = String(value ?? "");
  return raw === "leads" || raw === "sales" || raw === "followers" ? raw : null;
}

function parseFunnelInput(formData: FormData): ClientFunnelInput | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Informe um nome para o funil." };

  const namingKey = normalizeNamingKey(String(formData.get("naming_key") ?? ""));
  if (!isValidNamingKey(namingKey)) return { error: "Informe uma chave de nomenclatura válida (sem colchetes, não vazia)." };

  const linkedResultType = parseResultType(formData.get("linked_result_type"));
  const relevantIndicators = sanitizeFunnelIndicators(formData.getAll("relevant_indicators").map(String));

  return { name, namingKey, linkedResultType, relevantIndicators };
}

export async function createClientFunnelAction(clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();

  const input = parseFunnelInput(formData);
  if ("error" in input) redirect(withError(returnTo, input.error));

  const supabase = await createSupabaseClient();
  try {
    await createClientFunnel(supabase, clientId, input);
  } catch (err) {
    redirect(withError(returnTo, toUserFacingError(err, "Não foi possível criar o funil.")));
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/relatorio`);
  redirect(returnTo);
}

export async function updateClientFunnelAction(funnelId: string, clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();

  const input = parseFunnelInput(formData);
  if ("error" in input) redirect(withError(returnTo, input.error));

  const supabase = await createSupabaseClient();
  try {
    await updateClientFunnel(supabase, clientId, funnelId, input);
  } catch (err) {
    redirect(withError(returnTo, toUserFacingError(err, "Não foi possível atualizar o funil.")));
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/relatorio`);
  redirect(returnTo);
}

/** Desativa/reativa — nunca deleta (histórico de classificação já
 * confirmada continua intacto, ver `client-funnels-data.ts`). */
export async function setClientFunnelActiveAction(funnelId: string, clientId: string, isActive: boolean, returnTo: string) {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  try {
    await setClientFunnelActive(supabase, clientId, funnelId, isActive);
  } catch (err) {
    redirect(withError(returnTo, toUserFacingError(err, "Não foi possível atualizar o estado do funil.")));
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/relatorio`);
  redirect(returnTo);
}

export interface FunnelClassificationChange {
  /** Nunca enviado por uma campanha sem id confiável — o drawer só permite
   * classificar campanhas com `campaignId` capturado (mesma disciplina de
   * `CampaignAssignmentChange`/`ReportClassificationChange`). */
  campaignId: string;
  /** `null` = "Pendente" (remove o vínculo, nunca um "sem funil" gravado). */
  funnelId: string | null;
}

/**
 * Salva em lote a classificação campanha→funil — sem redirect (mesmo padrão
 * de `saveCampaignAssignmentsAction`/`saveReportClassificationsAction`): o
 * drawer decide o feedback e só fecha em caso de sucesso.
 */
export async function saveFunnelClassificationsAction(clientId: string, changes: FunnelClassificationChange[]): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  try {
    await saveCampaignFunnelAssignments(supabase, clientId, profile.id, changes);
  } catch (err) {
    return { error: toUserFacingError(err, "Não foi possível salvar a classificação das campanhas.") };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/relatorio`);
  return {};
}
