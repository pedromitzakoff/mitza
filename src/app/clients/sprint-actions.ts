"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

export async function updateSprintPlannedSpendAction(
  sprintId: string,
  clientId: string,
  formData: FormData,
) {
  await requireAdmin();

  const plannedSpend = Number(formData.get("planned_spend"));

  if (!Number.isFinite(plannedSpend) || plannedSpend < 0) {
    redirect(
      `/clients/${clientId}?error=${encodeURIComponent("Valor planejado inválido")}`,
    );
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("sprints")
    .update({ planned_spend: plannedSpend })
    .eq("id", sprintId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

/** Salva um gasto real digitado à mão e marca a sprint como spend_source =
 * "manual" — a partir daí, resolveSprintActualSpend passa a mostrar esse
 * valor em vez da soma de daily_spend, até alguém reverter (ver
 * resetSprintSpendSourceAction). A sync do Meta continua rodando e
 * gravando em daily_spend normalmente, só não aparece enquanto for manual. */
export async function updateSprintActualSpendAction(
  sprintId: string,
  clientId: string,
  formData: FormData,
) {
  await requireAdmin();

  const actualSpend = Number(formData.get("actual_spend"));

  if (!Number.isFinite(actualSpend) || actualSpend < 0) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Valor de gasto real inválido")}`);
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("sprints")
    .update({
      spend_source: "manual",
      manual_actual_spend: actualSpend,
      manual_spend_updated_at: new Date().toISOString(),
    })
    .eq("id", sprintId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  // O gasto manual entra na consolidação mensal (buildOperationClientCard) e
  // no gráfico acumulado dessas 3 rotas — sem isso elas serviriam uma versão
  // desatualizada do cache até a próxima revalidação natural.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

/** Volta a sprint pra origem "meta_api" — o gasto real exibido passa a ser
 * de novo a soma de daily_spend. Não apaga o valor manual salvo (fica
 * ignorado, não deletado), então dá pra confirmar com segurança. */
export async function resetSprintSpendSourceAction(sprintId: string, clientId: string) {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("sprints").update({ spend_source: "meta_api" }).eq("id", sprintId);

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
