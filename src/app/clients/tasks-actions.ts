"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { nextDueDate } from "@/lib/task-recurrence";
import { logOperationalActivity } from "@/lib/operational-activity-log";
import type { TaskRecurrence, TaskType } from "@/lib/supabase/database.types";

function resolveReturnTo(formData: FormData, fallback: string): string {
  const returnTo = formData.get("return_to");
  return typeof returnTo === "string" && returnTo.length > 0 ? returnTo : fallback;
}

export async function createTaskAction(clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "");
  const recurrence = String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const sprintId = String(formData.get("sprint_id") ?? "") || null;
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const { data: created, error } = await supabase
    .from("tasks")
    .insert({
      client_id: clientId,
      title,
      type,
      assignee_id: assigneeId,
      due_date: dueDate,
      recurrence,
      notes,
      sprint_id: sprintId,
    })
    .select("id")
    .single();

  if (error || !created) {
    const sprintParam = sprintId ? `&sprintId=${sprintId}` : "";
    redirect(
      `/clients/${clientId}/tasks/new?error=${encodeURIComponent(error?.message ?? "Erro ao criar tarefa")}${sprintParam}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId,
      taskId: created.id,
      userId: user.id,
      activityType: "task_created",
    });
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  redirect(returnTo);
}

export async function updateTaskAction(taskId: string, clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "");
  const recurrence = String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title,
      type,
      assignee_id: assigneeId,
      due_date: dueDate,
      recurrence,
      notes,
    })
    .eq("id", taskId)
    .select("sprint_id")
    .single();

  if (error) {
    redirect(`/clients/${clientId}/tasks/${taskId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: updated?.sprint_id ?? null,
      taskId,
      userId: user.id,
      activityType: "task_updated",
    });
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  redirect(returnTo);
}

export async function completeTaskAction(taskId: string, clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("id, client_id, sprint_id, title, type, assignee_id, due_date, recurrence, notes")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent("Tarefa não encontrada")}`);
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ status: "feito" })
    .eq("id", taskId);

  if (updateError) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent(updateError.message)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: task.sprint_id,
      taskId,
      userId: user.id,
      activityType: "task_completed",
    });
  }

  const nextDate = nextDueDate(task.due_date, task.recurrence);
  if (nextDate) {
    // Sem sprint_id de propósito: a próxima ocorrência pode cair numa
    // sprint diferente da atual, e recalcular isso corretamente exigiria
    // achar qual sprint cobre a nova data — fora do escopo por enquanto.
    // Também não gera atividade operacional: é o sistema recriando a
    // próxima ocorrência, não uma ação humana nova.
    await supabase.from("tasks").insert({
      client_id: task.client_id,
      title: task.title,
      type: task.type,
      assignee_id: task.assignee_id,
      due_date: nextDate,
      recurrence: task.recurrence,
      notes: task.notes,
    });
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  redirect(returnTo);
}
