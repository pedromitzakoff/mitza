"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";
import { OPTIMIZATION_QUICK_GROUPS } from "@/lib/recurring-tasks";

/** Valida o JSON do picker de otimização (`optimization_selections_json`,
 * montado no cliente por `OptimizationQuickPicker`) contra as combinações
 * curadas de `OPTIMIZATION_QUICK_GROUPS` — nunca confia em type/action/
 * quantity vindos do formulário sem checar contra a lista oficial (defesa em
 * profundidade, mesmo princípio de `parseOptimizations` na Análise da Conta
 * manual, `account-review-actions.ts`). */
function parseOptimizationSelections(raw: string): { type: string; action: string; quantity: number }[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: { type: string; action: string; quantity: number }[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    const action = (item as Record<string, unknown>).action;
    const quantity = Math.trunc(Number((item as Record<string, unknown>).quantity));

    const isKnownCombo = OPTIMIZATION_QUICK_GROUPS.some((group) =>
      group.actions.some((quickAction) => quickAction.type === type && quickAction.action === action),
    );
    if (!isKnownCombo || !(quantity > 0)) continue;

    valid.push({ type: type as string, action: action as string, quantity });
  }
  return valid;
}

/**
 * Registra uma execução de tarefa recorrente — nunca conclui a tarefa (ela é
 * permanente), sempre cria um novo registro em `recurring_task_executions`
 * (e, pra Otimização, também um `account_reviews` por baixo). Toda a
 * validação de negócio e a gravação acontecem atomicamente em
 * `register_recurring_execution` (supabase/recurring-tasks.sql); esta action
 * só resolve o ator e traduz erros do banco em mensagens curtas.
 *
 * `checklist_items` (checkboxes marcados no drawer, presente só quando a
 * recorrência tem `has_checklist=true` e NÃO é a Otimização) vira
 * `p_checklist_selected_keys`. `optimization_selections_json` (o picker de
 * chips, presente só quando `uses_account_review=true`) vira
 * `p_optimization_selections` — a mesma action serve qualquer recorrência,
 * com checklist genérico, com o picker de otimização, ou sem nenhum dos
 * dois.
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
  const optimizationSelections = parseOptimizationSelections(String(formData.get("optimization_selections_json") ?? ""));

  const { error } = await supabase.rpc("register_recurring_execution", {
    p_recurring_task_id: recurringTaskId,
    p_client_id: clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_notes: notes,
    p_checklist_selected_keys: checklistSelectedKeys.length > 0 ? checklistSelectedKeys : null,
    p_optimization_selections: optimizationSelections.length > 0 ? optimizationSelections : null,
    // BUG CORRIGIDO ("não foi possível escolher a melhor função candidata"):
    // omitir este parâmetro deixava a chamada ambígua entre a assinatura
    // antiga de register_recurring_execution (sem p_client_report_id) e a
    // atual (com ele, default null) — as duas eram candidatas válidas pro
    // mesmo conjunto de argumentos nomeados. Passar `null` explicitamente
    // nunca depende da resolução automática do Postgres (ver também a
    // migration que remove as assinaturas antigas).
    p_client_report_id: null,
    p_source: "web",
  });

  if (error) fail(error.message);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");
  redirect(returnTo);
}
