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

interface CompletionActorRow {
  actor_team_member_id: string | null;
  actor: { name: string } | { name: string }[] | null;
}

/**
 * Quem concluiu a demanda MAIS RECENTEMENTE — leitura sob demanda (só
 * quando o drawer de uma demanda concluída abre), nunca por inferência.
 * `tasks` não tem coluna própria de ator; a fonte real é o evento
 * `task_completed` que `complete_task_and_record_event` (RPC) grava
 * atomicamente junto da própria conclusão em `operational_events` — cada
 * ciclo de conclusão (mesmo após reabrir) grava um evento NOVO (chave de
 * idempotência inclui `completion_count`), então o mais recente por
 * `occurred_at` é sempre a conclusão atual. Retorna `actorName: null`
 * (nunca inventa um nome) quando não há evento — ex.: dado legado de antes
 * desta telemetria existir.
 */
export async function getTaskCompletionActorAction(taskId: string): Promise<{ error?: string; actorName?: string | null }> {
  const supabase = await createSupabaseClient();

  const result = await queryOrError<CompletionActorRow[]>(
    supabase
      .from("operational_events")
      .select("actor_team_member_id, actor:team_members!operational_events_actor_team_member_id_fkey(name)")
      .eq("entity_type", "task")
      .eq("entity_id", taskId)
      .eq("event_type", "task_completed")
      .order("occurred_at", { ascending: false })
      .limit(1),
    "operational_events:pendencias-drawer-completion-actor",
    "Não foi possível carregar quem concluiu a demanda.",
  );

  if ("error" in result) return { error: result.error };
  const row = result.data?.[0];
  if (!row) return { actorName: null };
  const actor = Array.isArray(row.actor) ? (row.actor[0] ?? null) : row.actor;
  return { actorName: actor?.name ?? null };
}
