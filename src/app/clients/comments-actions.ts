"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { logOperationalActivity } from "@/lib/operational-activity-log";
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

    let sprintId: string | null = null;
    let taskId: string | null = null;

    if (commentableType === "sprint") {
      sprintId = commentableId;
    } else {
      taskId = commentableId;
      const { data: task } = await supabase
        .from("tasks")
        .select("sprint_id")
        .eq("id", commentableId)
        .single();
      sprintId = task?.sprint_id ?? null;
    }

    await logOperationalActivity(supabase, {
      clientId,
      sprintId,
      taskId,
      userId: user.id,
      activityType: commentableType === "sprint" ? "sprint_commented" : "task_commented",
      sourceType: "comment",
    });
  }

  // Sem redirect de propósito: quem chama esta action já está na página
  // certa — só revalida os dados em cima da mesma URL, sem navegar, pra
  // não resetar o scroll nem fechar o que estava expandido.
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
}
