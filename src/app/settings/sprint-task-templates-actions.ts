"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { TASK_TYPE_DEFAULT_TITLE } from "@/app/clients/task-labels";
import type { TaskType, Weekday } from "@/lib/supabase/database.types";

const BASE_PATH = "/settings/sprint-task-templates";

/** Título do template vem do tipo (TASK_TYPE_DEFAULT_TITLE) — só "outro"
 * usa o texto livre digitado no form. Mantém a coluna `title` sempre
 * preenchida sem depender de um campo redundante na interface. */
function readTemplateFields(formData: FormData) {
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const customTitle = String(formData.get("title") ?? "").trim();
  const title = type === "outro" ? customTitle || "Outro" : TASK_TYPE_DEFAULT_TITLE[type];

  return {
    title,
    type,
    weekday: Number(formData.get("weekday")) as Weekday,
    defaultAssigneeId: String(formData.get("default_assignee_id") ?? "") || null,
    appliesToAll: formData.get("applies_to_all") === "on",
    clientIds: formData.getAll("client_ids").map((value) => String(value)),
  };
}

async function replaceTemplateClients(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  templateId: string,
  appliesToAll: boolean,
  clientIds: string[],
) {
  await supabase.from("sprint_task_template_clients").delete().eq("template_id", templateId);

  if (!appliesToAll && clientIds.length > 0) {
    await supabase.from("sprint_task_template_clients").insert(
      clientIds.map((clientId) => ({ template_id: templateId, client_id: clientId })),
    );
  }
}

export async function createGlobalTemplateAction(formData: FormData) {
  await requireAdmin();
  const { title, type, weekday, defaultAssigneeId, appliesToAll, clientIds } =
    readTemplateFields(formData);
  const supabase = await createSupabaseClient();

  const { data, error } = await supabase
    .from("sprint_task_templates")
    .insert({
      title,
      type,
      weekday,
      default_assignee_id: defaultAssigneeId,
      applies_to_all: appliesToAll,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(`${BASE_PATH}?templateError=${encodeURIComponent(error?.message ?? "Erro ao criar")}`);
  }

  await replaceTemplateClients(supabase, data.id, appliesToAll, clientIds);

  revalidatePath(BASE_PATH);
}

export async function updateGlobalTemplateAction(templateId: string, formData: FormData) {
  await requireAdmin();
  const { title, type, weekday, defaultAssigneeId, appliesToAll, clientIds } =
    readTemplateFields(formData);
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("sprint_task_templates")
    .update({
      title,
      type,
      weekday,
      default_assignee_id: defaultAssigneeId,
      applies_to_all: appliesToAll,
    })
    .eq("id", templateId);

  if (error) {
    redirect(`${BASE_PATH}?templateError=${encodeURIComponent(error.message)}`);
  }

  await replaceTemplateClients(supabase, templateId, appliesToAll, clientIds);

  revalidatePath(BASE_PATH);
}

export async function toggleGlobalTemplateActiveAction(templateId: string, isActive: boolean) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("sprint_task_templates").update({ is_active: isActive }).eq("id", templateId);

  revalidatePath(BASE_PATH);
}

export async function deleteGlobalTemplateAction(templateId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);

  if (count && count > 0) {
    redirect(
      `${BASE_PATH}?templateError=${encodeURIComponent(
        "Esse template já gerou tarefas — desative em vez de excluir.",
      )}`,
    );
  }

  await supabase.from("sprint_task_templates").delete().eq("id", templateId);

  revalidatePath(BASE_PATH);
}

/**
 * Platform Continuity System 1.0: retorna o resultado em vez de redirecionar
 * — "aplicado às sprints existentes" não deixa nenhum rastro visível na
 * tela (nenhuma linha muda), então o botão que chama isto (client
 * component) mostra um toast de confirmação em vez de um parâmetro
 * `?backfilled=1` na URL.
 */
export async function runBackfillAction(): Promise<{ error?: string }> {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase.rpc("backfill_sprint_tasks_from_templates");

  if (error) {
    return { error: error.message };
  }

  revalidatePath(BASE_PATH);
  return {};
}
