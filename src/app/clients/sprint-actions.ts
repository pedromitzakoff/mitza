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
