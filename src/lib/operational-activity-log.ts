import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { OperationalActivityType } from "@/lib/supabase/database.types";

export interface LogOperationalActivityParams {
  clientId: string;
  sprintId?: string | null;
  taskId?: string | null;
  userId: string;
  activityType: OperationalActivityType;
  sourceType?: string;
  sourceId?: string | null;
}

/**
 * Único ponto que grava em `operational_activities` — chamado direto nas
 * server actions que representam trabalho humano de verdade (criar/editar/
 * concluir tarefa, comentar). Nunca é chamado pela sync do Meta nem pela
 * geração automática de tarefas por template, então essas rotinas nunca
 * geram atividade.
 */
export async function logOperationalActivity(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  params: LogOperationalActivityParams,
): Promise<void> {
  await supabase.from("operational_activities").insert({
    client_id: params.clientId,
    sprint_id: params.sprintId ?? null,
    task_id: params.taskId ?? null,
    user_id: params.userId,
    activity_type: params.activityType,
    source_type: params.sourceType ?? null,
    source_id: params.sourceId ?? null,
  });
}
