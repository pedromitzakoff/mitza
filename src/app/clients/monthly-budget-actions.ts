"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { todayDateString } from "@/lib/today";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, resolvePlanningHorizon, CLOSED_MONTH_MESSAGE } from "@/lib/monthly-budget";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Aplica uma nova versão do plano mensal de UM canal (Etapa "Planejamento
 * por Canal") — Investimento planejado + Resultado planejado, o mesmo
 * objeto/snapshot sempre (nunca dois formulários/duas chamadas separadas
 * pra investimento x meta). CPA planejado nunca é enviado nem armazenado —
 * sempre derivado na leitura (`resolveClientMonthlyPlan`). Toda a redistribuição
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
  const supabase = await createSupabaseClient();

  // Etapa "Horizonte de Planejamento": cliente de evento (campanha que
  // termina antes do fim do mês) — a redistribuição diária nunca passa do
  // horizonte, mesmo que o mês civil continue. null pra qualquer cliente
  // sem horizonte configurado, comportamento idêntico a antes desta etapa.
  const planningEndDate = await getClientMonthHorizon(supabase, clientId, monthRange.firstDay);
  const planningHorizon = resolvePlanningHorizon(monthRange, planningEndDate);
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);

  if (isClosedMonth || !effectiveDate) {
    return { error: CLOSED_MONTH_MESSAGE };
  }

  const { error } = await supabase.rpc("apply_monthly_channel_plan_change", {
    p_client_id: clientId,
    p_channel: channel,
    p_first_day: planningHorizon.firstDay,
    p_last_day: planningHorizon.lastDay,
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

/**
 * Define (ou remove) o horizonte de planejamento de um cliente NUM MÊS
 * (Etapa "Horizonte de Planejamento") — `planningEndDate: null` = comporta-
 * mento padrão (até o fim do mês); uma data = a operação deste mês termina
 * antes (evento, lançamento, campanha sazonal etc.). Nunca por canal: uma
 * única linha por (cliente, mês), Meta e Google sempre leem o mesmo valor.
 * `upsert` — cada cliente+mês tem no máximo uma linha (constraint única no
 * banco), então repetir a chamada só atualiza a mesma linha, nunca duplica.
 */
export async function setClientMonthHorizonAction(
  clientId: string,
  monthParam: string,
  planningEndDate: string | null,
): Promise<{ error?: string }> {
  await requireAdmin();

  const monthRange = monthRangeFromParam(monthParam);
  if (planningEndDate && (planningEndDate < monthRange.firstDay || planningEndDate > monthRange.lastDay)) {
    return { error: "A data final da campanha precisa estar dentro do mês selecionado." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("client_month_horizons")
    .upsert({ client_id: clientId, month: monthRange.firstDay, planning_end_date: planningEndDate }, { onConflict: "client_id,month" });

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível salvar o período de planejamento.") };
  }

  // Mesmo raio de propagação de `applyMonthlyChannelPlanChangeAction` — o
  // horizonte afeta ritmo/dias restantes/redistribuição em toda a
  // plataforma, não só na página do cliente.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath("/operation");
  revalidatePath(`/clients/${clientId}`);
  return {};
}
