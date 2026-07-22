"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import type { WorkspaceNote } from "@/lib/workspace-notes";

const NOTE_COLUMNS = "id, user_id, title, content, is_pinned, context_path, context_label, created_at, updated_at";

/**
 * MITZA 2.0 — Workspace Pessoal: todas as ações aqui são chamadas
 * diretamente pelo drawer (client component), nunca por um `<form
 * action=...>` — o mesmo padrão já usado por `completeTaskAction`. RLS
 * (`supabase/workspace-notes.sql`) já restringe cada leitura/escrita ao
 * dono da nota (`user_id = current_team_member_id()`); as ações não
 * repetem esse filtro por `.eq("user_id", ...)` porque a policy já garante
 * isolamento mesmo se alguém tentasse forjar outro id.
 */
export async function listWorkspaceNotesAction(): Promise<{ notes: WorkspaceNote[] } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_notes")
    .select(NOTE_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) return { error: error.message };
  return { notes: data ?? [] };
}

export async function createWorkspaceNoteAction(
  contextPath: string | null,
  contextLabel: string | null,
): Promise<{ note: WorkspaceNote } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_notes")
    .insert({
      user_id: profile.id,
      title: "",
      content: "",
      context_path: contextPath,
      context_label: contextLabel,
    })
    .select(NOTE_COLUMNS)
    .single();

  if (error || !data) return { error: error?.message ?? "Não foi possível criar a nota." };
  return { note: data };
}

export async function updateWorkspaceNoteAction(
  noteId: string,
  fields: { title: string; content: string },
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("workspace_notes")
    .update({ title: fields.title, content: fields.content })
    .eq("id", noteId);

  if (error) return { error: error.message };
  return {};
}

export async function toggleWorkspaceNotePinAction(noteId: string, pinned: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("workspace_notes").update({ is_pinned: pinned }).eq("id", noteId);

  if (error) return { error: error.message };
  return {};
}

/**
 * Não exposta como "excluir nota" na interface (o pedido não lista essa
 * ação entre as do painel) — usada só internamente pelo drawer pra
 * descartar uma nota em branco (nunca teve título nem conteúdo) quando o
 * usuário fecha ou sai dela, evitando acumular notas vazias.
 */
export async function deleteWorkspaceNoteAction(noteId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("workspace_notes").delete().eq("id", noteId);

  if (error) return { error: error.message };
  return {};
}
