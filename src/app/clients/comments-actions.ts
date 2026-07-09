"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { CommentableType } from "@/lib/supabase/database.types";

export async function createCommentAction(
  commentableType: CommentableType,
  commentableId: string,
  clientId: string,
  formData: FormData,
) {
  const supabase = await createSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/clients/${clientId}?commentError=${encodeURIComponent("Sessão expirada, faça login de novo")}`);
  }

  const content = String(formData.get("content") ?? "").trim();

  if (content) {
    const { error } = await supabase.from("comments").insert({
      commentable_type: commentableType,
      commentable_id: commentableId,
      author_id: user.id,
      content,
    });

    if (error) {
      redirect(`/clients/${clientId}?commentError=${encodeURIComponent(error.message)}`);
    }
  }

  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
