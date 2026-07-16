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
import { withOriginalDueDate } from "@/lib/task-creation";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { TaskRecurrence, TaskType } from "@/lib/supabase/database.types";

function resolveReturnTo(formData: FormData, fallback: string): string {
  const returnTo = formData.get("return_to");
  return typeof returnTo === "string" && returnTo.length > 0 ? returnTo : fallback;
}

/** Campos oficiais de criação/edição de tarefa — mesmo modelo usado pelas
 * páginas dedicadas legadas (`/tasks/new`, `/tasks/[taskId]/edit`) e pelo
 * fluxo inline (Etapa "MITZA Workspace-First Tasks 1.0"). Única fonte de
 * verdade: `parseTaskFormData` extrai isto de um `<form>` nativo (rota
 * legada); o fluxo inline monta o mesmo formato diretamente em JS — os dois
 * caminhos convergem pro mesmo insert/update logo abaixo. */
export interface TaskActionFields {
  title: string;
  type: TaskType;
  assigneeId: string | null;
  dueDate: string;
  dueTime: string | null;
  recurrence: TaskRecurrence;
  notes: string | null;
  sprintId: string | null;
}

function parseTaskFormData(formData: FormData): TaskActionFields {
  return {
    title: String(formData.get("title") ?? "").trim(),
    type: String(formData.get("type") ?? "outro") as TaskType,
    assigneeId: String(formData.get("assignee_id") ?? "") || null,
    dueDate: String(formData.get("due_date") ?? ""),
    dueTime: String(formData.get("due_time") ?? "").trim() || null,
    recurrence: String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence,
    notes: String(formData.get("notes") ?? "").trim() || null,
    sprintId: String(formData.get("sprint_id") ?? "") || null,
  };
}

/** Insere a tarefa e grava os eventos operacionais — única implementação
 * real de "criar tarefa" (Parte 7: única fonte de verdade). Nunca navega,
 * nunca decide mensagem de UI: isso é responsabilidade de quem chama
 * (`createTaskAction`, legado, ou `createTaskInlineAction`, oficial). */
async function performCreateTask(
  clientId: string,
  fields: TaskActionFields,
): Promise<{ error: string } | { taskId: string }> {
  const supabase = await createSupabaseClient();

  const { data: created, error } = await supabase
    .from("tasks")
    .insert(
      withOriginalDueDate({
        client_id: clientId,
        title: fields.title,
        type: fields.type,
        assignee_id: fields.assigneeId,
        due_date: fields.dueDate,
        due_time: fields.dueTime,
        recurrence: fields.recurrence,
        notes: fields.notes,
        sprint_id: fields.sprintId,
      }),
    )
    .select("id")
    .single();

  if (error || !created) {
    // Etapa "MITZA Workspace-First Tasks 1.0" (Parte 1): a mensagem crua do
    // Supabase/Postgrest nunca mais chega à interface — só o log do
    // servidor guarda o detalhe técnico real.
    return { error: toUserFacingError(error, "Não foi possível criar a tarefa. Tente novamente.") };
  }

  const profile = await getCurrentProfile();
  if (profile) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: fields.sprintId,
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
      sprintId: fields.sprintId,
      source: "web",
      metadata: {
        task_type: fields.type,
        task_title: fields.title,
        due_date: fields.dueDate,
        assignee_team_member_id: fields.assigneeId,
        origin: "manual",
      },
    });

    if (fields.assigneeId) {
      await recordOperationalEvent(supabase, actor, {
        eventType: OperationalEventType.TASK_ASSIGNED,
        entityType: "task",
        entityId: created.id,
        clientId,
        sprintId: fields.sprintId,
        source: "web",
        metadata: { assignee_team_member_id: fields.assigneeId },
      });
    }
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");

  return { taskId: created.id };
}

/**
 * Criação de tarefa — rota legada (`/tasks/new`, mantida só por
 * compatibilidade — Etapa "MITZA Workspace-First Tasks 1.0", Parte 6):
 * `<form action>` nativo, sempre redireciona (erro ou sucesso), exatamente
 * como sempre funcionou. Nenhum botão da interface atual aponta pra cá —
 * ver `createTaskInlineAction` pro fluxo oficial (workspace, sem navegar).
 */
export async function createTaskAction(clientId: string, formData: FormData): Promise<void> {
  const fields = parseTaskFormData(formData);
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const result = await performCreateTask(clientId, fields);
  if ("error" in result) {
    const sprintParam = fields.sprintId ? `&sprintId=${fields.sprintId}` : "";
    redirect(`/clients/${clientId}/tasks/new?error=${encodeURIComponent(result.error)}${sprintParam}`);
  }
  redirect(returnTo);
}

/**
 * Criação de tarefa — fluxo oficial (Etapa "MITZA Workspace-First Tasks
 * 1.0"): chamado diretamente por `InlineCreateTaskForm` (sem `<form
 * action>` nativo), nunca redireciona — devolve `{error?; message?}`, o
 * mesmo contrato já usado por `completeTaskAction`/`ToastActionButton` em
 * toda a plataforma. Mesma query, mesmos eventos operacionais de
 * `createTaskAction` (via `performCreateTask`) — só o desfecho muda.
 */
export async function createTaskInlineAction(
  clientId: string,
  fields: TaskActionFields,
): Promise<{ error?: string; message?: string }> {
  const result = await performCreateTask(clientId, fields);
  if ("error" in result) {
    return { error: result.error };
  }
  return { message: `"${fields.title}" criada.` };
}

/** Campos de edição inline (Etapa "MITZA Workspace-First Tasks 1.0") —
 * `dueTime`/`recurrence` são OPCIONAIS aqui, ao contrário de
 * `TaskActionFields`: nem todo formulário que edita uma tarefa carrega o
 * valor atual desses dois campos (ex.: drawer aberto a partir de /operation
 * ou /sprints, cujo modelo `OperationTaskItem` não busca `due_time`/
 * `recurrence`). Achado da investigação desta etapa: a edição inline já
 * existente enviava sempre `due_time: null`/`recurrence: "nenhuma"` mesmo
 * quando o formulário nunca mostrava esses campos — resetando em silêncio
 * o horário e a recorrência de qualquer tarefa editada por ali. `undefined`
 * agora significa "este formulário não trata este campo" e preserva o
 * valor atual (nunca reseta o que a interface não mostrou pro gestor). */
export interface TaskUpdateFields {
  title: string;
  type: TaskType;
  assigneeId: string | null;
  dueDate: string;
  notes: string | null;
  dueTime?: string | null;
  recurrence?: TaskRecurrence;
}

/** Atualiza a tarefa e grava os eventos operacionais — única implementação
 * real de "editar tarefa" (Parte 7). Nenhuma regra de reatribuição/
 * alteração de prazo mudou: a leitura do estado anterior e o cálculo de
 * `reassignment_count`/`due_date_change_count` são idênticos em qualquer
 * caminho que chame esta função. */
async function performUpdateTask(
  taskId: string,
  clientId: string,
  fields: TaskUpdateFields,
): Promise<{ error: string } | { title: string }> {
  const supabase = await createSupabaseClient();

  // Lê o estado anterior ANTES de sobrescrever — necessário pra detectar
  // reatribuição/alteração de prazo, preservar original_due_date e (achado
  // desta etapa) preservar due_time/recurrence quando o formulário que
  // chamou não os conhece.
  const { data: previous } = await supabase
    .from("tasks")
    .select("assignee_id, due_date, due_time, recurrence, sprint_id, reassignment_count, due_date_change_count")
    .eq("id", taskId)
    .single();

  const wasAlreadyOverdue = previous ? previous.due_date < todayDateString() : false;
  const isReassignment = previous ? fields.assigneeId !== previous.assignee_id : false;
  const isFirstAssignment = isReassignment && !previous?.assignee_id;
  const isDueDateChange = previous ? fields.dueDate !== previous.due_date : false;
  const nextDueTime = fields.dueTime !== undefined ? fields.dueTime : (previous?.due_time ?? null);
  const nextRecurrence = fields.recurrence !== undefined ? fields.recurrence : (previous?.recurrence ?? "nenhuma");

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title: fields.title,
      type: fields.type,
      assignee_id: fields.assigneeId,
      due_date: fields.dueDate,
      due_time: nextDueTime,
      recurrence: nextRecurrence,
      notes: fields.notes,
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
    return { error: toUserFacingError(error, "Não foi possível salvar a tarefa. Tente novamente.") };
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
          new_assignee_team_member_id: fields.assigneeId,
          current_due_date: fields.dueDate,
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
          new_due_date: fields.dueDate,
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

  return { title: fields.title };
}

/**
 * Edição de tarefa — rota legada (`/tasks/[taskId]/edit`, mantida só por
 * compatibilidade — Parte 6): `<form action>` nativo, sempre redireciona,
 * exatamente como sempre funcionou. Ver `updateTaskInlineAction` pro fluxo
 * oficial (drawer, sem navegar).
 */
export async function updateTaskAction(taskId: string, clientId: string, formData: FormData): Promise<void> {
  const fields = parseTaskFormData(formData);
  const returnTo = resolveReturnTo(formData, `/clients/${clientId}`);

  const result = await performUpdateTask(taskId, clientId, fields);
  if ("error" in result) {
    redirect(`/clients/${clientId}/tasks/${taskId}/edit?error=${encodeURIComponent(result.error)}`);
  }
  redirect(returnTo);
}

/**
 * Edição de tarefa — fluxo oficial (Etapa "MITZA Workspace-First Tasks
 * 1.0"): chamado diretamente por `InlineEditTaskForm` dentro do drawer,
 * nunca redireciona nem navega — devolve `{error?; message?}`. Mesma query
 * e mesmos eventos operacionais de `updateTaskAction` (via
 * `performUpdateTask`) — só o desfecho muda.
 */
export async function updateTaskInlineAction(
  taskId: string,
  clientId: string,
  fields: TaskUpdateFields,
): Promise<{ error?: string; message?: string }> {
  const result = await performUpdateTask(taskId, clientId, fields);
  if ("error" in result) {
    return { error: result.error };
  }
  return { message: `"${result.title}" atualizada.` };
}

export async function completeTaskAction(taskId: string, clientId: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseClient();

  const { data: task, error: fetchError } = await supabase
    .from("tasks")
    .select("id, client_id, sprint_id, title, type, assignee_id, due_date, recurrence, notes")
    .eq("id", taskId)
    .single();

  if (fetchError || !task) {
    return { error: "Tarefa não encontrada." };
  }

  const profile = await getCurrentProfile();

  if (!profile) {
    // Sessão expirada é uma navegação de verdade, não um erro de mutação
    // (Platform Integrity Wave 2 — contrato de Server Action).
    redirect("/login");
  }

  // tasks.status="feito" + o(s) evento(s) operational_events (task_completed
  // e, quando aplicável, optimization_completed/meeting_completed/
  // creative_delivery_completed correlacionados) são gravados atomicamente
  // nesta única função de banco — nunca tarefa concluída sem evento, nem
  // evento sem a tarefa realmente concluída (seção 7 do pedido).
  const { error: rpcError } = await supabase.rpc("complete_task_and_record_event", {
    p_task_id: taskId,
    p_actor_team_member_id: profile.id,
    p_actor_auth_user_id: profile.authUserId,
    p_source: "web",
  });

  if (rpcError) {
    return { error: toUserFacingError(rpcError, "Não foi possível concluir a tarefa.") };
  }

  await logOperationalActivity(supabase, {
    clientId,
    sprintId: task.sprint_id,
    taskId,
    userId: profile.id,
    activityType: "task_completed",
  });

  const nextDate = nextDueDate(task.due_date, task.recurrence);
  if (nextDate) {
    // Sem sprint_id de propósito: a próxima ocorrência pode cair numa
    // sprint diferente da atual, e recalcular isso corretamente exigiria
    // achar qual sprint cobre a nova data — fora do escopo por enquanto.
    // Também não gera atividade/evento: é o sistema recriando a próxima
    // ocorrência, não uma ação humana nova.
    // original_due_date desta NOVA ocorrência é a própria nextDate (é uma
    // tarefa nova, com prazo inicial próprio — nunca herda a data original
    // da ocorrência anterior).
    await supabase.from("tasks").insert(
      withOriginalDueDate({
        client_id: task.client_id,
        title: task.title,
        type: task.type,
        assignee_id: task.assignee_id,
        due_date: nextDate,
        recurrence: task.recurrence,
        notes: task.notes,
      }),
    );
  }

  // Sem redirect de propósito: quem chama esta action já está na página
  // certa (linha da tarefa ou drawer) — só revalida os dados em cima da
  // mesma URL, sem navegar, pra não resetar o scroll nem fechar o que
  // estava expandido.
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");

  return {};
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
export async function markTaskNotDoneAction(taskId: string, clientId: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseClient();
  const profile = await getCurrentProfile();

  if (!profile) {
    // Sessão expirada é uma navegação de verdade, não um erro de mutação
    // (Platform Integrity Wave 2 — contrato de Server Action).
    redirect("/login");
  }

  const { error: rpcError } = await supabase.rpc("mark_task_not_done_and_record_event", {
    p_task_id: taskId,
    p_actor_team_member_id: profile.id,
    p_actor_auth_user_id: profile.authUserId,
    p_source: "web",
  });

  if (rpcError) {
    return { error: toUserFacingError(rpcError, "Não foi possível marcar como não realizada.") };
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

  return {};
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
/**
 * Etapa "Sprint Workspace Polish 1.0": mesma exclusão de sempre, agora
 * chamável de dois jeitos — via `<form>` (drawer, com `formData` trazendo
 * `return_to`: comportamento 100% preservado, redireciona ao terminar,
 * fechando o drawer) ou diretamente (exclusão rápida na própria linha da
 * tarefa, sem `formData`: nunca redireciona, devolve `{ error? }` pra quem
 * chamou decidir o feedback — preserva scroll, Sprint aberta, cliente
 * expandido e filtros, exatamente como o pedido exige). Nenhuma segunda
 * lógica de exclusão: é a mesma query, o mesmo evento de auditoria, o mesmo
 * `requireAdmin()` — só o desfecho (redirecionar vs. retornar) muda
 * conforme quem chama.
 */
export async function deleteTaskAction(taskId: string, clientId: string, formData: FormData): Promise<void>;
export async function deleteTaskAction(taskId: string, clientId: string): Promise<{ error?: string }>;
export async function deleteTaskAction(
  taskId: string,
  clientId: string,
  formData?: FormData,
): Promise<{ error?: string } | void> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: task } = await supabase
    .from("tasks")
    .select("title, type, due_date, assignee_id, sprint_id")
    .eq("id", taskId)
    .single();

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    if (!formData) return { error: "Não foi possível excluir a tarefa." };
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

  if (!formData) return {};
  redirect(resolveReturnTo(formData, `/clients/${clientId}`));
}
