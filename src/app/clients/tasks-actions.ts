"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireAdmin } from "@/lib/auth";
import { nextDueDate } from "@/lib/task-recurrence";
import { logOperationalActivity } from "@/lib/operational-activity-log";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { todayDateString } from "@/lib/today";
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
  const dueTime = String(formData.get("due_time") ?? "").trim() || null;
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
      due_time: dueTime,
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

  const profile = await getCurrentProfile();
  if (profile) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId,
      taskId: created.id,
      userId: profile.id,
      activityType: "task_created",
    });

    const actor = actorFromProfile(profile);
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.TASK_CREATED,
      entityType: "task",
      entityId: created.id,
      clientId,
      sprintId,
      source: "web",
      metadata: {
        task_type: type,
        task_title: title,
        due_date: dueDate,
        assignee_team_member_id: assigneeId,
        origin: "manual",
      },
    });

    if (assigneeId) {
      await recordOperationalEvent(supabase, actor, {
        eventType: OperationalEventType.TASK_ASSIGNED,
        entityType: "task",
        entityId: created.id,
        clientId,
        sprintId,
        source: "web",
        metadata: { assignee_team_member_id: assigneeId },
      });
    }
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  redirect(returnTo);
}

export async function updateTaskAction(taskId: string, clientId: string, formData: FormData) {
  const supabase = await createSupabaseClient();

  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "outro") as TaskType;
  const assigneeId = String(formData.get("assignee_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "");
  const dueTime = String(formData.get("due_time") ?? "").trim() || null;
  const recurrence = String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  // Lê o estado anterior ANTES de sobrescrever — necessário pra detectar
  // reatribuição/alteração de prazo e preservar original_due_date (achado
  // da investigação: esta action fazia um update cego, sem nunca ler o
  // valor anterior de assignee_id/due_date).
  const { data: previous } = await supabase
    .from("tasks")
    .select("assignee_id, due_date, sprint_id, reassignment_count, due_date_change_count")
    .eq("id", taskId)
    .single();

  const wasAlreadyOverdue = previous ? previous.due_date < todayDateString() : false;
  const isReassignment = previous ? assigneeId !== previous.assignee_id : false;
  const isFirstAssignment = isReassignment && !previous?.assignee_id;
  const isDueDateChange = previous ? dueDate !== previous.due_date : false;

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title,
      type,
      assignee_id: assigneeId,
      due_date: dueDate,
      due_time: dueTime,
      recurrence,
      notes,
      reassignment_count: (previous?.reassignment_count ?? 0) + (isReassignment && !isFirstAssignment ? 1 : 0),
      due_date_change_count: (previous?.due_date_change_count ?? 0) + (isDueDateChange ? 1 : 0),
      // original_due_date nunca é escrito aqui de propósito — é preenchido
      // só na criação e nunca sobrescrito, pra nunca perder o prazo
      // combinado originalmente (seção 12 do pedido).
    })
    .eq("id", taskId)
    .select("sprint_id")
    .single();

  if (error) {
    redirect(`/clients/${clientId}/tasks/${taskId}/edit?error=${encodeURIComponent(error.message)}`);
  }

  const profile = await getCurrentProfile();
  if (profile) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: updated?.sprint_id ?? null,
      taskId,
      userId: profile.id,
      activityType: "task_updated",
    });

    const actor = actorFromProfile(profile);
    const sprintId = updated?.sprint_id ?? null;

    if (isReassignment) {
      await recordOperationalEvent(supabase, actor, {
        eventType: isFirstAssignment ? OperationalEventType.TASK_ASSIGNED : OperationalEventType.TASK_REASSIGNED,
        entityType: "task",
        entityId: taskId,
        clientId,
        sprintId,
        source: "web",
        metadata: {
          previous_assignee_team_member_id: previous?.assignee_id ?? null,
          new_assignee_team_member_id: assigneeId,
          current_due_date: dueDate,
          was_already_overdue: wasAlreadyOverdue,
        },
      });
    }

    if (isDueDateChange) {
      await recordOperationalEvent(supabase, actor, {
        eventType: OperationalEventType.TASK_DUE_DATE_CHANGED,
        entityType: "task",
        entityId: taskId,
        clientId,
        sprintId,
        source: "web",
        metadata: {
          previous_due_date: previous?.due_date ?? null,
          new_due_date: dueDate,
          was_already_overdue: wasAlreadyOverdue,
          due_date_change_count: (previous?.due_date_change_count ?? 0) + 1,
        },
      });
    }
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  redirect(returnTo);
}

export async function completeTaskAction(taskId: string, clientId: string) {
  const supabase = await createSupabaseClient();

  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("id, client_id, sprint_id, title, type, assignee_id, due_date, recurrence, notes")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent("Tarefa não encontrada")}`);
  }

  const profile = await getCurrentProfile();

  // tasks.status="feito" + o(s) evento(s) operational_events (task_completed
  // e, quando aplicável, optimization_completed/meeting_completed/
  // creative_delivery_completed correlacionados) são gravados atomicamente
  // nesta única função de banco — nunca tarefa concluída sem evento, nem
  // evento sem a tarefa realmente concluída (seção 7 do pedido).
  if (profile) {
    const { error: rpcError } = await supabase.rpc("complete_task_and_record_event", {
      p_task_id: taskId,
      p_actor_team_member_id: profile.id,
      p_actor_auth_user_id: profile.authUserId,
      p_source: "web",
    });

    if (rpcError) {
      redirect(`/clients/${clientId}?taskError=${encodeURIComponent(rpcError.message)}`);
    }

    await logOperationalActivity(supabase, {
      clientId,
      sprintId: task.sprint_id,
      taskId,
      userId: profile.id,
      activityType: "task_completed",
    });
  } else {
    // Sem sessão resolvida (não deveria acontecer numa Server Action
    // protegida por auth, mas nunca conclui silenciosamente sem ator).
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent("Sessão expirada, faça login de novo")}`);
  }

  const nextDate = nextDueDate(task.due_date, task.recurrence);
  if (nextDate) {
    // Sem sprint_id de propósito: a próxima ocorrência pode cair numa
    // sprint diferente da atual, e recalcular isso corretamente exigiria
    // achar qual sprint cobre a nova data — fora do escopo por enquanto.
    // Também não gera atividade/evento: é o sistema recriando a próxima
    // ocorrência, não uma ação humana nova.
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

  // Sem redirect de propósito: quem chama esta action já está na página
  // certa (linha da tarefa ou drawer) — só revalida os dados em cima da
  // mesma URL, sem navegar, pra não resetar o scroll nem fechar o que
  // estava expandido.
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
}

/**
 * Marca uma reunião ou entrega de criativo como NÃO realizada — terceiro
 * estado terminal (nem "feito" nem "atrasado" pra sempre), espelhando
 * completeTaskAction: status + evento operacional gravados atomicamente na
 * mesma RPC (mark_task_not_done_and_record_event). Só existe pra
 * reuniao/entrega_criativo (a própria RPC recusa outros tipos) — nunca
 * escreve completed_at, só resolved_at, pra não inflar o indicador
 * "Tarefas concluídas" da Visão Geral com tarefas que não foram concluídas.
 */
export async function markTaskNotDoneAction(taskId: string, clientId: string) {
  const supabase = await createSupabaseClient();
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent("Sessão expirada, faça login de novo")}`);
  }

  const { error: rpcError } = await supabase.rpc("mark_task_not_done_and_record_event", {
    p_task_id: taskId,
    p_actor_team_member_id: profile.id,
    p_actor_auth_user_id: profile.authUserId,
    p_source: "web",
  });

  if (rpcError) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent(rpcError.message)}`);
  }

  await logOperationalActivity(supabase, {
    clientId,
    sprintId: null,
    taskId,
    userId: profile.id,
    activityType: "task_updated",
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
}

/**
 * Exclusão definitiva de tarefa — só admin (gestor não tem acesso a esta
 * action nem vê o botão na UI). Diferente de clientes (soft delete, pra
 * preservar histórico comercial), tarefa é um item operacional do dia a dia:
 * apagar de fato uma tarefa criada por engano não tem o mesmo peso de
 * apagar um cliente. O evento TASK_DELETED guarda os dados principais em
 * metadata (título, tipo, prazo, responsável) — a auditoria sobrevive à
 * tarefa mesmo depois que a linha em si deixa de existir, porque
 * operational_events.entity_id não é uma foreign key (é só uuid, igual às
 * outras entidades polimórficas desta tabela).
 */
export async function deleteTaskAction(taskId: string, clientId: string, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const { data: task } = await supabase
    .from("tasks")
    .select("title, type, due_date, assignee_id, sprint_id")
    .eq("id", taskId)
    .single();

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    redirect(`/clients/${clientId}?taskError=${encodeURIComponent("Não foi possível excluir a tarefa.")}`);
  }

  const actor = actorFromProfile(profile);
  await recordOperationalEvent(supabase, actor, {
    eventType: OperationalEventType.TASK_DELETED,
    entityType: "task",
    entityId: taskId,
    clientId,
    sprintId: task?.sprint_id ?? null,
    source: "web",
    metadata: {
      task_title: task?.title ?? null,
      task_type: task?.type ?? null,
      due_date: task?.due_date ?? null,
      assignee_team_member_id: task?.assignee_id ?? null,
    },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  redirect(returnTo);
}
