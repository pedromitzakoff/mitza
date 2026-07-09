"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { TaskType, Weekday } from "@/lib/supabase/database.types";

function readTemplateFields(formData: FormData) {
  return {
    title: String(formData.get("title") ?? "").trim(),
    type: String(formData.get("type") ?? "outro") as TaskType,
    weekday: Number(formData.get("weekday")) as Weekday,
    defaultAssigneeId: String(formData.get("default_assignee_id") ?? "") || null,
  };
}

export async function createTemplateAction(clientId: string, formData: FormData) {
  await requireAdmin();
  const { title, type, weekday, defaultAssigneeId } = readTemplateFields(formData);
  const supabase = await createSupabaseClient();

  const { error } = await supabase.from("client_task_templates").insert({
    client_id: clientId,
    title,
    type,
    weekday,
    default_assignee_id: defaultAssigneeId,
  });

  if (error) {
    redirect(`/clients/${clientId}/edit?templateError=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/clients/${clientId}/edit`);
  redirect(`/clients/${clientId}/edit`);
}

export async function updateTemplateAction(
  templateId: string,
  clientId: string,
  formData: FormData,
) {
  await requireAdmin();
  const { title, type, weekday, defaultAssigneeId } = readTemplateFields(formData);
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("client_task_templates")
    .update({ title, type, weekday, default_assignee_id: defaultAssigneeId })
    .eq("id", templateId);

  if (error) {
    redirect(`/clients/${clientId}/edit?templateError=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/clients/${clientId}/edit`);
  redirect(`/clients/${clientId}/edit`);
}

export async function toggleTemplateActiveAction(
  templateId: string,
  clientId: string,
  isActive: boolean,
) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("client_task_templates").update({ is_active: isActive }).eq("id", templateId);

  revalidatePath(`/clients/${clientId}/edit`);
  redirect(`/clients/${clientId}/edit`);
}

export async function deleteTemplateAction(templateId: string, clientId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("client_task_templates").delete().eq("id", templateId);

  revalidatePath(`/clients/${clientId}/edit`);
  redirect(`/clients/${clientId}/edit`);
}
