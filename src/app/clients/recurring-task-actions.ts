"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";

/**
 * Registra uma execução de tarefa recorrente — nunca conclui a tarefa (ela é
 * permanente), sempre cria um novo registro em `recurring_task_executions`
 * (e, pra Otimização, também um `account_reviews` por baixo). Toda a
 * validação de negócio e a gravação acontecem atomicamente em
 * `register_recurring_execution` (supabase/recurring-tasks.sql); esta action
 * só resolve o ator e traduz erros do banco em mensagens curtas.
 *
 * `checklist_items` (checkboxes marcados no drawer, presente só quando a
 * recorrência tem `has_checklist=true`) vira `p_checklist_selected_keys` —
 * a mesma action serve qualquer recorrência, com ou sem checklist.
 */
export async function registerRecurringExecutionAction(recurringTaskId: string, clientId: string, returnTo: string, formData: FormData) {
  function fail(message: string): never {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}recurringTaskError=${encodeURIComponent(message)}`);
  }

  const profile = await getCurrentProfile();
  if (!profile) fail("Sessão expirada, faça login de novo.");

  const supabase = await createSupabaseClient();

  const blocked = await checkWorkspaceClientAction(supabase, clientId);
  if (blocked) fail(blocked);

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const checklistSelectedKeys = formData.getAll("checklist_items").map(String);

  const { error } = await supabase.rpc("register_recurring_execution", {
    p_recurring_task_id: recurringTaskId,
    p_client_id: clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_notes: notes,
    p_checklist_selected_keys: checklistSelectedKeys.length > 0 ? checklistSelectedKeys : null,
    p_source: "web",
  });

  if (error) fail(error.message);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");
  redirect(returnTo);
}
