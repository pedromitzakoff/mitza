"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { toUserFacingError } from "@/lib/user-facing-error";
import { DEFAULT_RECURRING_TASK_COLOR } from "@/lib/recurring-tasks";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

const BASE_PATH = "/settings/recurring-tasks";

function fail(message: string): never {
  redirect(`${BASE_PATH}?recurringTaskError=${encodeURIComponent(message)}`);
}

/** "Público" → "publico" — usado só como identificador interno estável do
 * item de checklist (`item_key`). Sufixo numérico em caso de colisão dentro
 * do mesmo formulário (dois itens com o mesmo rótulo). */
function slugifyChecklistLabel(label: string, usedKeys: Set<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "item";
  let key = base;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function readRecurringTaskFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const icon = String(formData.get("icon") ?? "🔁").trim() || "🔁";
  const color = String(formData.get("color") ?? DEFAULT_RECURRING_TASK_COLOR).trim() || DEFAULT_RECURRING_TASK_COLOR;
  const defaultAssigneeId = String(formData.get("default_assignee_id") ?? "") || null;
  const appliesToAll = formData.get("applies_to_all") === "on";
  const clientIds = formData.getAll("client_ids").map(String);
  const hasChecklist = formData.get("has_checklist") === "on";
  const checklistLabels = formData
    .getAll("checklist_labels")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  const weeklyGoal = Math.max(0, Math.trunc(Number(formData.get("weekly_goal") ?? 0)) || 0);

  return { title, icon, color, defaultAssigneeId, appliesToAll, clientIds, hasChecklist, checklistLabels, weeklyGoal };
}

async function replaceRecurringTaskClients(supabase: Supabase, recurringTaskId: string, appliesToAll: boolean, clientIds: string[]) {
  await supabase.from("recurring_task_clients").delete().eq("recurring_task_id", recurringTaskId);

  if (!appliesToAll && clientIds.length > 0) {
    await supabase.from("recurring_task_clients").insert(clientIds.map((clientId) => ({ recurring_task_id: recurringTaskId, client_id: clientId })));
  }
}

/** Só chamada quando `has_checklist` está marcado — nunca pra uma tarefa com
 * `uses_account_review = true` (guarda em `updateRecurringTaskAction`): os
 * itens dessa recorrência precisam continuar batendo com `OptimizationType`,
 * editar livremente por aqui quebraria a integração com account_reviews. */
async function replaceChecklistItems(supabase: Supabase, recurringTaskId: string, labels: string[]) {
  await supabase.from("recurring_task_checklist_items").delete().eq("recurring_task_id", recurringTaskId);

  if (labels.length === 0) return;

  const usedKeys = new Set<string>();
  await supabase.from("recurring_task_checklist_items").insert(
    labels.map((label, index) => ({
      recurring_task_id: recurringTaskId,
      item_key: slugifyChecklistLabel(label, usedKeys),
      label,
      sort_order: index,
    })),
  );
}

export async function createRecurringTaskAction(formData: FormData) {
  await requireAdmin();
  const { title, icon, color, defaultAssigneeId, appliesToAll, clientIds, hasChecklist, checklistLabels, weeklyGoal } =
    readRecurringTaskFields(formData);

  if (!title) fail("Informe um nome para a recorrência.");

  const supabase = await createSupabaseClient();

  const { data, error } = await supabase
    .from("recurring_tasks")
    .insert({
      title,
      icon,
      color,
      default_assignee_id: defaultAssigneeId,
      applies_to_all: appliesToAll,
      has_checklist: hasChecklist,
    })
    .select("id")
    .single();

  if (error || !data) fail(toUserFacingError(error, "Não foi possível criar a recorrência."));

  await replaceRecurringTaskClients(supabase, data.id, appliesToAll, clientIds);

  if (hasChecklist) await replaceChecklistItems(supabase, data.id, checklistLabels);

  if (weeklyGoal > 0) {
    await supabase.from("recurring_task_goal_history").insert({ recurring_task_id: data.id, weekly_goal: weeklyGoal });
  }

  revalidatePath(BASE_PATH);
}

export async function updateRecurringTaskAction(recurringTaskId: string, formData: FormData) {
  await requireAdmin();
  const { title, icon, color, defaultAssigneeId, appliesToAll, clientIds, hasChecklist, checklistLabels } = readRecurringTaskFields(formData);

  if (!title) fail("Informe um nome para a recorrência.");

  const supabase = await createSupabaseClient();

  const { data: current } = await supabase.from("recurring_tasks").select("uses_account_review").eq("id", recurringTaskId).single();
  // Reformulação do sistema de tarefas: `uses_account_review` é uma
  // integração de backend, nunca configurável por aqui (ver doc em
  // supabase/recurring-tasks.sql) — pra essa recorrência, `has_checklist` e
  // os itens ficam travados no que já está configurado, o form só altera
  // nome/ícone/cor/escopo.
  const isAccountReviewLinked = current?.uses_account_review ?? false;

  const { error } = await supabase
    .from("recurring_tasks")
    .update({
      title,
      icon,
      color,
      default_assignee_id: defaultAssigneeId,
      applies_to_all: appliesToAll,
      ...(isAccountReviewLinked ? {} : { has_checklist: hasChecklist }),
    })
    .eq("id", recurringTaskId);

  if (error) fail(toUserFacingError(error, "Não foi possível salvar a recorrência."));

  await replaceRecurringTaskClients(supabase, recurringTaskId, appliesToAll, clientIds);

  if (!isAccountReviewLinked) {
    if (hasChecklist) await replaceChecklistItems(supabase, recurringTaskId, checklistLabels);
    else await supabase.from("recurring_task_checklist_items").delete().eq("recurring_task_id", recurringTaskId);
  }

  revalidatePath(BASE_PATH);
}

/** A meta semanal nunca é editada in-place — cada mudança vira uma NOVA
 * linha em `recurring_task_goal_history` (append-only), efetiva a partir de
 * agora. É isso que garante a meta congelada por sprint: uma sprint que já
 * começou antes dessa mudança continua julgada pela meta antiga, para
 * sempre (ver `resolveWeeklyGoalForSprint`, src/lib/recurring-tasks.ts). */
export async function updateRecurringTaskGoalAction(recurringTaskId: string, formData: FormData) {
  await requireAdmin();
  const weeklyGoal = Math.trunc(Number(formData.get("weekly_goal") ?? 0));

  if (weeklyGoal <= 0) fail("A meta semanal precisa ser maior que zero.");

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("recurring_task_goal_history").insert({ recurring_task_id: recurringTaskId, weekly_goal: weeklyGoal });

  if (error) fail(toUserFacingError(error, "Não foi possível atualizar a meta semanal."));

  revalidatePath(BASE_PATH);
}

export async function toggleRecurringTaskActiveAction(recurringTaskId: string, isActive: boolean) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("recurring_tasks").update({ is_active: isActive }).eq("id", recurringTaskId);

  revalidatePath(BASE_PATH);
}

export async function deleteRecurringTaskAction(recurringTaskId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { count } = await supabase
    .from("recurring_task_executions")
    .select("id", { count: "exact", head: true })
    .eq("recurring_task_id", recurringTaskId);

  if (count && count > 0) fail("Essa recorrência já tem execuções registradas — desative em vez de excluir.");

  await supabase.from("recurring_tasks").delete().eq("id", recurringTaskId);

  revalidatePath(BASE_PATH);
}
