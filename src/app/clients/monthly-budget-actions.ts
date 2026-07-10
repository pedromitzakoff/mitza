"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { todayDateString } from "@/lib/today";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, CLOSED_MONTH_MESSAGE } from "@/lib/monthly-budget";

/**
 * Aplica uma alteração de orçamento mensal — toda a redistribuição roda numa
 * única função transacional no banco (apply_monthly_budget_change), nunca
 * calculada e gravada aqui em vários passos separados. Só admin chama isto
 * (requireAdmin + RLS admin-only nas tabelas envolvidas garantem os dois
 * lados: aplicação e banco).
 */
export async function applyMonthlyBudgetChangeAction(
  clientId: string,
  monthParam: string,
  formData: FormData,
) {
  const profile = await requireAdmin();

  const newBudget = Number(formData.get("new_budget"));
  if (!Number.isFinite(newBudget) || newBudget < 0) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Orçamento inválido")}`);
  }

  const monthRange = monthRangeFromParam(monthParam);
  const todayStr = todayDateString();
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(monthRange, todayStr);

  if (isClosedMonth || !effectiveDate) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(CLOSED_MONTH_MESSAGE)}`);
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("apply_monthly_budget_change", {
    p_client_id: clientId,
    p_first_day: monthRange.firstDay,
    p_last_day: monthRange.lastDay,
    p_effective_date: effectiveDate,
    p_new_budget: newBudget,
    p_today: todayStr,
    p_changed_by: profile.id,
  });

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  // O orçamento mensal alimenta a distribuição das sprints (planned_spend),
  // a barra financeira, o "esperado até hoje", o gráfico e a classificação
  // dentro/acima/abaixo em várias telas — sem isso elas serviriam uma versão
  // desatualizada do cache até a próxima revalidação natural.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?budgetSaved=1`);
}
