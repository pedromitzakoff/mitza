"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

/** Volta a sprint pra origem "meta_api" — o gasto real exibido passa a ser
 * de novo a soma de daily_spend. Não apaga o valor manual salvo (fica
 * ignorado, não deletado), então dá pra confirmar com segurança.
 *
 * `returnTo` (Etapa MVP 1.3) — quem chama decide pra onde volta depois de
 * salvar: a página do cliente passa a própria URL, a tela Sprints passa a
 * URL atual dela (com view/grouping/filtros preservados) — nunca mais um
 * redirect fixo pra `/clients/{id}`, que tirava o gestor da tela Sprints
 * ao editar uma sprint por lá. */
export async function resetSprintSpendSourceAction(sprintId: string, clientId: string, returnTo: string) {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("sprints").update({ spend_source: "meta_api" }).eq("id", sprintId);

  if (error) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }

  // Platform Continuity System 1.0: sem redirect no sucesso — `returnTo`
  // já era a própria página, então o redirect só existia pra "voltar" pra
  // onde o gestor já estava, fechando o formulário e perdendo scroll/
  // contexto à toa. `revalidatePath` sozinho já atualiza os dados no lugar.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
}
