"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { nextDueDate } from "@/lib/task-recurrence";
import type { TaskRecurrence, TaskType } from "@/lib/supabase/database.types";

export async function createTaskAction(clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "");
  const recurrence = String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const sprintId = String(formData.get("sprint_id") ?? "") || null;

  const { error } = await supabase.from("tasks").insert({
    client_id: clientId,
    title,
    type,
    assignee_id: assigneeId,
    due_date: dueDate,
    recurrence,
    notes,
    sprint_id: sprintId,
  });

  if (error) {
    const sprintParam = sprintId ? `&sprintId=${sprintId}` : "";
    redirect(`/clients/${clientId}/tasks/new?error=${encodeURIComponent(error.message)}${sprintParam}`);
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function updateTaskAction(taskId: string, clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "");
  const recurrence = String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      type,
      assignee_id: assigneeId,
      due_date: dueDate,
      recurrence,
      notes,
    })
    .eq("id", taskId);

  if (error) {
    redirect(`/clients/${clientId}/tasks/${taskId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}

export async function completeTaskAction(taskId: string, clientId: string) {
  const supabase = await createSupabaseClient();

  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("id, client_id, title, type, assignee_id, due_date, recurrence, notes")
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

  const nextDate = nextDueDate(task.due_date, task.recurrence);
  if (nextDate) {
    // Sem sprint_id de propósito: a próxima ocorrência pode cair numa
    // sprint diferente da atual, e recalcular isso corretamente exigiria
    // achar qual sprint cobre a nova data — fora do escopo por enquanto.
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
  redirect(`/clients/${clientId}`);
}
