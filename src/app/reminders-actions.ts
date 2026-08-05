"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import type { ReminderScopeDb } from "@/lib/supabase/database.types";

/**
 * Módulo "Pendências" (Visão Geral da Agência) — Server Actions. Mesmo
 * padrão já corrigido em `recurring-task-actions.ts`: `useActionState`
 * pro formulário de criar/editar (redirect só no sucesso, erro fica no
 * drawer sem navegação nenhuma), `useTransition` simples pras ações
 * instantâneas (concluir/restaurar/excluir).
 */
export type ReminderFormState = { status: "idle" } | { status: "error"; message: string };

function readOptionalText(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

async function upsertReminderPayload(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const scope: ReminderScopeDb = formData.get("scope") === "client" ? "client" : "agency";
  const clientId = scope === "client" ? readOptionalText(formData, "client_id") : null;
  const assigneeId = readOptionalText(formData, "assignee_id");
  const dueDate = readOptionalText(formData, "due_date");
  const notes = readOptionalText(formData, "notes");
  return { title, scope, clientId, assigneeId, dueDate, notes };
}

/**
 * Cria uma nova pendência. Assinatura em `(closeHref, prevState, formData)`
 * — `closeHref` vem de `.bind()` no drawer, os 2 últimos são o contrato do
 * `useActionState`.
 */
export async function createReminderAction(
  closeHref: string,
  _prevState: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const profile = await getCurrentProfile();
  if (!profile) return { status: "error", message: "Sessão expirada, faça login de novo." };

  const { title, scope, clientId, assigneeId, dueDate, notes } = await upsertReminderPayload(formData);
  if (!title) return { status: "error", message: "Escreva o que precisa ser lembrado." };
  if (scope === "client" && !clientId) return { status: "error", message: "Selecione o cliente relacionado." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("reminders").insert({
    organization_id: profile.organizationId,
    title,
    scope,
    client_id: clientId,
    assignee_id: assigneeId,
    due_date: dueDate,
    notes,
    created_by: profile.id,
  });

  if (error) {
    console.error("[createReminderAction] insert falhou", {
      teamMemberId: profile.id,
      scope,
      clientId,
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    return { status: "error", message: "Não foi possível adicionar a pendência. Tente novamente." };
  }

  revalidatePath("/");
  redirect(closeHref);
}

/** Edita uma pendência existente — mesmo contrato de `createReminderAction`,
 * com o id da pendência a mais no início (via `.bind()`). */
export async function updateReminderAction(
  reminderId: string,
  closeHref: string,
  _prevState: ReminderFormState,
  formData: FormData,
): Promise<ReminderFormState> {
  const profile = await getCurrentProfile();
  if (!profile) return { status: "error", message: "Sessão expirada, faça login de novo." };

  const { title, scope, clientId, assigneeId, dueDate, notes } = await upsertReminderPayload(formData);
  if (!title) return { status: "error", message: "Escreva o que precisa ser lembrado." };
  if (scope === "client" && !clientId) return { status: "error", message: "Selecione o cliente relacionado." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("reminders")
    .update({ title, scope, client_id: clientId, assignee_id: assigneeId, due_date: dueDate, notes })
    .eq("id", reminderId);

  if (error) {
    console.error("[updateReminderAction] update falhou", {
      teamMemberId: profile.id,
      reminderId,
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    return { status: "error", message: "Não foi possível salvar a pendência. Tente novamente." };
  }

  revalidatePath("/");
  redirect(closeHref);
}

/** Vinculada direto a `<form action={...}>` (progressive enhancement, sem
 * `useTransition`) — por isso não retorna erro pro chamador, só loga: mesmo
 * padrão de `toggleRecurringTaskActiveAction`/`deleteRecurringTaskAction`
 * em settings/recurring-tasks-actions.ts. */
export async function completeReminderAction(reminderId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("reminders")
    .update({ status: "done", completed_by: profile.id, completed_at: new Date().toISOString() })
    .eq("id", reminderId);

  if (error) {
    console.error("[completeReminderAction] update falhou", {
      teamMemberId: profile.id,
      reminderId,
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    return;
  }

  revalidatePath("/");
}

/** "Ver concluídas" → Restaurar — reverte uma conclusão feita por engano. */
export async function restoreReminderAction(reminderId: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("reminders")
    .update({ status: "pending", completed_by: null, completed_at: null })
    .eq("id", reminderId);

  if (error) {
    console.error("[restoreReminderAction] update falhou", {
      teamMemberId: profile.id,
      reminderId,
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    return;
  }

  revalidatePath("/");
}

export async function deleteReminderAction(reminderId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sessão expirada, faça login de novo." };

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("reminders").delete().eq("id", reminderId);

  if (error) {
    console.error("[deleteReminderAction] delete falhou", {
      teamMemberId: profile.id,
      reminderId,
      supabaseCode: error.code,
      supabaseMessage: error.message,
      supabaseDetails: error.details,
      supabaseHint: error.hint,
    });
    return { error: "Não foi possível excluir. Tente novamente." };
  }

  revalidatePath("/");
  return {};
}
