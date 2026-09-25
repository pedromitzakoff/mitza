"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { queryOrError } from "@/lib/require-query";
import type { CommentItem } from "@/app/clients/comment-thread";

/**
 * Leitura sob demanda dos comentários de UMA pendência — o drawer de
 * `/pendencias` cobre tarefas de qualquer cliente (até internas), então
 * pré-carregar comentários de toda tarefa na página inteira seria buscar
 * dado que quase nunca vai ser aberto; carrega só quando o drawer abre.
 */
export async function listTaskCommentsAction(taskId: string): Promise<{ error?: string; comments?: CommentItem[] }> {
  const supabase = await createSupabaseClient();

  const result = await queryOrError<CommentItem[]>(
    supabase
      .from("comments")
      .select("id, commentable_id, content, created_at, author:team_members!comments_author_id_fkey(name)")
      .eq("commentable_type", "task")
      .eq("commentable_id", taskId)
      .order("created_at"),
    "comments:pendencias-drawer",
    "Não foi possível carregar os comentários.",
  );

  if ("error" in result) return { error: result.error };
  return { comments: result.data ?? [] };
}
