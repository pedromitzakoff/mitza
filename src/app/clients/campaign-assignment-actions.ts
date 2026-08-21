"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { saveCampaignGoalAssignments } from "@/lib/campaign-goal-assignments";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { toUserFacingError } from "@/lib/user-facing-error";

export interface CampaignAssignmentChange {
  channel: TrafficChannel;
  /** `null` nunca é enviado por uma campanha real — o drawer só permite
   * selecionar campanhas com `campaignId` capturado (auditoria seção 5:
   * campanha sem id estável não é classificável). */
  campaignId: string;
  /** `null` = "Sem objetivo" (remove o vínculo). */
  resultType: PerformanceGoal | null;
}

/**
 * Salva em lote a classificação de campanhas do drawer "Classificar
 * campanhas" — sem redirect (Platform Continuity System 1.0, mesmo padrão
 * de `updateClientPerformanceGoalAction`): o drawer decide o feedback e só
 * fecha em caso de sucesso — em erro, a seleção do gestor continua na tela
 * (auditoria seção 22).
 */
export async function saveCampaignAssignmentsAction(clientId: string, changes: CampaignAssignmentChange[]): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  try {
    await saveCampaignGoalAssignments(
      supabase,
      clientId,
      profile.id,
      changes.map((c) => ({ channel: c.channel, campaignId: c.campaignId, resultType: c.resultType })),
    );
  } catch (err) {
    return { error: toUserFacingError(err, "Não foi possível salvar a classificação das campanhas.") };
  }

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  return {};
}
