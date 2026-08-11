"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { todayDateString } from "@/lib/today";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, CLOSED_MONTH_MESSAGE } from "@/lib/monthly-budget";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Aplica uma nova versão do plano mensal de UM canal (Etapa "Planejamento
 * por Canal") — Investimento planejado + Resultado planejado, o mesmo
 * objeto/snapshot sempre (nunca dois formulários/duas chamadas separadas
 * pra investimento x meta). CPA planejado nunca é enviado nem armazenado —
 * sempre derivado na leitura (`resolveClientPlan`). Toda a redistribuição
 * diária roda numa única função transacional no banco
 * (`apply_monthly_channel_plan_change`), nunca calculada e gravada aqui em
 * vários passos separados.
 *
 * O consolidado do cliente nunca é editável diretamente — é sempre a soma
 * da versão vigente de cada canal, por isso esta action opera sempre em UM
 * canal por chamada; a UI (`ChannelPlanEditor`) chama isto uma vez por
 * canal que o gestor de fato tocou (canal com investimento em branco =
 * não tocado, nunca enviado).
 */
export async function applyMonthlyChannelPlanChangeAction(
  clientId: string,
  monthParam: string,
  channel: TrafficChannel,
  newInvestment: number,
  reason: string | null,
  targetResultCount: number | null,
): Promise<{ error?: string }> {
  const profile = await requireAdmin();

  if (!Number.isFinite(newInvestment) || newInvestment < 0) {
    return { error: "Investimento inválido" };
  }

  const monthRange = monthRangeFromParam(monthParam);
  const todayStr = todayDateString();
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(monthRange, todayStr);

  if (isClosedMonth || !effectiveDate) {
    return { error: CLOSED_MONTH_MESSAGE };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_monthly_channel_plan_change", {
    p_client_id: clientId,
    p_channel: channel,
    p_first_day: monthRange.firstDay,
    p_last_day: monthRange.lastDay,
    p_effective_date: effectiveDate,
    p_new_budget: newInvestment,
    p_today: todayStr,
    p_changed_by: profile.id,
    p_reason: reason,
    p_target_result_count: targetResultCount,
  });

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível aplicar a mudança de planejamento.") };
  }

  // O planejamento mensal alimenta a distribuição das sprints (planned_spend,
  // consolidado — soma de todos os canais), a barra financeira, o "esperado
  // até hoje", o gráfico, a classificação dentro/acima/abaixo e as metas de
  // Resultado/Custo da página do cliente — sem isso elas serviriam uma
  // versão desatualizada do cache até a próxima revalidação natural.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath("/operation");
  revalidatePath(`/clients/${clientId}`);
  return {};
}
