"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { todayDateString } from "@/lib/today";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, CLOSED_MONTH_MESSAGE } from "@/lib/monthly-budget";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * Aplica uma nova versão do planejamento mensal do cliente (investimento +
 * metas de performance, Etapa "Planejamento Mensal 1.0") — toda a
 * redistribuição roda numa única função transacional no banco
 * (apply_monthly_budget_change), nunca calculada e gravada aqui em vários
 * passos separados. `targetResultCount`/`targetCostPerResult` são
 * opcionais: quando null, a função no banco carrega adiante o que já
 * estava vigente (nunca zera uma meta só porque este formulário não a
 * editou). Só admin chama isto (requireAdmin + RLS admin-only nas tabelas
 * envolvidas garantem os dois lados: aplicação e banco).
 *
 * Platform Continuity System 1.0: `MonthlyBudgetEditor` (único chamador) já
 * é client component com estado próprio (`isOpen`/`newBudget`/`reason`) —
 * chamada direta em vez de `<form action>` + `redirect`, pra poder fechar o
 * editor e mostrar o toast de confirmação sem navegar.
 */
export async function applyMonthlyBudgetChangeAction(
  clientId: string,
  monthParam: string,
  newBudget: number,
  reason: string | null,
  targetResultCount: number | null,
  targetCostPerResult: number | null,
): Promise<{ error?: string }> {
  const profile = await requireAdmin();

  if (!Number.isFinite(newBudget) || newBudget < 0) {
    return { error: "Orçamento inválido" };
  }

  const monthRange = monthRangeFromParam(monthParam);
  const todayStr = todayDateString();
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(monthRange, todayStr);

  if (isClosedMonth || !effectiveDate) {
    return { error: CLOSED_MONTH_MESSAGE };
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
    p_reason: reason,
    p_target_result_count: targetResultCount,
    p_target_cost_per_result: targetCostPerResult,
  });

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível aplicar a mudança de orçamento.") };
  }

  // O planejamento mensal alimenta a distribuição das sprints (planned_spend),
  // a barra financeira, o "esperado até hoje", o gráfico, a classificação
  // dentro/acima/abaixo e (Etapa "Planejamento Mensal 1.0") as metas de
  // Resultado/Custo da Operação — sem isso elas serviriam uma versão
  // desatualizada do cache até a próxima revalidação natural.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath("/operation");
  revalidatePath(`/clients/${clientId}`);
  return {};
}
