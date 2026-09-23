"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { saveReportCampaignClassifications } from "@/lib/report-campaign-classification-data";
import type { ReportCampaignPurpose } from "@/lib/report-view-classification";
import { toUserFacingError } from "@/lib/user-facing-error";

export interface ReportClassificationChange {
  /** `null` nunca é enviado por uma campanha real — o drawer só permite
   * selecionar campanhas com `campaignId` capturado (mesma disciplina de
   * `CampaignAssignmentChange`, `campaign-assignment-actions.ts`). */
  campaignId: string;
  /** `null` = "Não classificada" (remove o vínculo). */
  purpose: ReportCampaignPurpose | null;
}

/**
 * Salva em lote a classificação de campanhas do drawer "Classificar
 * campanhas do Relatório" — sem redirect (mesmo padrão de
 * `saveCampaignAssignmentsAction`): o drawer decide o feedback e só fecha
 * em caso de sucesso, em erro a seleção do gestor continua na tela.
 */
export async function saveReportClassificationsAction(clientId: string, changes: ReportClassificationChange[]): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  try {
    await saveReportCampaignClassifications(supabase, clientId, profile.id, changes);
  } catch (err) {
    return { error: toUserFacingError(err, "Não foi possível salvar a classificação das campanhas.") };
  }

  revalidatePath(`/clients/${clientId}/relatorio`);
  return {};
}
