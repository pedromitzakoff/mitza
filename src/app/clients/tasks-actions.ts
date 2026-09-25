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
import { queryOrError } from "@/lib/require-query";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";
import { buildDuplicateTaskRow } from "@/lib/pendencias";
import type { TaskPriority, TaskRecurrence, TaskStatus, TaskType } from "@/lib/supabase/database.types";

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
  /** Etapa "Pendências": default "normal" em qualquer caminho que não
   * conheça o campo — nunca deixa uma tarefa sem prioridade explícita. */
  priority: TaskPriority;
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
    priority: (String(formData.get("priority") ?? "normal") as TaskPriority) || "normal",
  };
}

/** Insere a tarefa e grava os eventos operacionais — única implementação
 * real de "criar tarefa" (Parte 7: única fonte de verdade). Nunca navega,
 * nunca decide mensagem de UI: isso é responsabilidade de quem chama
 * (`createTaskAction`, legado, ou `createTaskInlineAction`, oficial). */
async function performCreateTask(
  clientId: string | null,
  fields: TaskActionFields,
): Promise<{ error: string } | { taskId: string }> {
  const supabase = await createSupabaseClient();

  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

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
        priority: fields.priority,
        // Todo caminho que chama performCreateTask é uma pessoa preenchendo
        // um formulário (quick-create de Pendências, "+ Tarefa" do
        // cliente/Sprint, rota legada /tasks/new) — nunca o gerador
        // automático de Modelo de Tarefa de Sprint (esse insere direto via
        // SQL, `generate_sprint_tasks_from_templates`, nunca por aqui).
        origin: "manual" as const,
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
    // operational_activities.client_id é NOT NULL — pendência interna (sem
    // cliente) nunca grava aqui, só em operational_events (client_id já
    // nullable desde a Etapa "Pendências").
    if (clientId) {
      await logOperationalActivity(supabase, {
        clientId,
        sprintId: fields.sprintId,
        taskId: created.id,
        userId: profile.id,
        activityType: "task_created",
      });
    }

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

  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");

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
  clientId: string | null,
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
  /** Mesmo padrão "undefined preserva o valor atual" de `dueTime`/
   * `recurrence` acima — nem todo formulário que edita a tarefa mostra
   * prioridade. */
  priority?: TaskPriority;
}

/** Atualiza a tarefa e grava os eventos operacionais — única implementação
 * real de "editar tarefa" (Parte 7). Nenhuma regra de reatribuição/
 * alteração de prazo mudou: a leitura do estado anterior e o cálculo de
 * `reassignment_count`/`due_date_change_count` são idênticos em qualquer
 * caminho que chame esta função. */
async function performUpdateTask(
  taskId: string,
  clientId: string | null,
  fields: TaskUpdateFields,
): Promise<{ error: string } | { title: string }> {
  const supabase = await createSupabaseClient();

  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  // Lê o estado anterior ANTES de sobrescrever — necessário pra detectar
  // reatribuição/alteração de prazo, preservar original_due_date e (achado
  // desta etapa) preservar due_time/recurrence quando o formulário que
  // chamou não os conhece. Erro aqui não pode virar "sem estado anterior"
  // silencioso — isso gravaria reassignment_count/due_date_change_count
  // errados.
  const previousResult = await queryOrError<{
    assignee_id: string | null;
    due_date: string;
    due_time: string | null;
    recurrence: TaskRecurrence;
    priority: TaskPriority;
    sprint_id: string | null;
    reassignment_count: number;
    due_date_change_count: number;
  }>(
    supabase
      .from("tasks")
      .select("assignee_id, due_date, due_time, recurrence, priority, sprint_id, reassignment_count, due_date_change_count")
      .eq("id", taskId)
      .single(),
    "tasks:previous-state",
    "Não foi possível carregar o estado atual da tarefa.",
  );
  if ("error" in previousResult) return { error: previousResult.error };
  const previous = previousResult.data;

  const wasAlreadyOverdue = previous ? previous.due_date < todayDateString() : false;
  const isReassignment = previous ? fields.assigneeId !== previous.assignee_id : false;
  const isFirstAssignment = isReassignment && !previous?.assignee_id;
  const isDueDateChange = previous ? fields.dueDate !== previous.due_date : false;
  const nextDueTime = fields.dueTime !== undefined ? fields.dueTime : (previous?.due_time ?? null);
  const nextRecurrence = fields.recurrence !== undefined ? fields.recurrence : (previous?.recurrence ?? "nenhuma");
  const nextPriority = fields.priority !== undefined ? fields.priority : (previous?.priority ?? "normal");

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      title: fields.title,
      type: fields.type,
      assignee_id: fields.assigneeId,
      due_date: fields.dueDate,
      due_time: nextDueTime,
      recurrence: nextRecurrence,
      priority: nextPriority,
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
    if (clientId) {
      await logOperationalActivity(supabase, {
        clientId,
        sprintId: updated?.sprint_id ?? null,
        taskId,
        userId: profile.id,
        activityType: "task_updated",
      });
    }

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

  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");

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
  clientId: string | null,
  fields: TaskUpdateFields,
): Promise<{ error?: string; message?: string }> {
  const result = await performUpdateTask(taskId, clientId, fields);
  if ("error" in result) {
    return { error: result.error };
  }
  return { message: `"${result.title}" atualizada.` };
}

export async function completeTaskAction(taskId: string, clientId: string | null): Promise<{ error?: string }> {
  const supabase = await createSupabaseClient();

  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

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

  if (clientId) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: task.sprint_id,
      taskId,
      userId: profile.id,
      activityType: "task_completed",
    });
  }

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
        // Continuação de uma recorrência leve (tasks.recurrence — não
        // confundir com o eixo separado `recurring_tasks`), que só existe
        // em tarefa que uma pessoa criou (o gerador de Modelo de Tarefa de
        // Sprint nunca grava recurrence != 'nenhuma') — sempre "manual".
        origin: "manual" as const,
      }),
    );
  }

  // Sem redirect de propósito: quem chama esta action já está na página
  // certa (linha da tarefa ou drawer) — só revalida os dados em cima da
  // mesma URL, sem navegar, pra não resetar o scroll nem fechar o que
  // estava expandido.
  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");

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
export async function markTaskNotDoneAction(taskId: string, clientId: string | null): Promise<{ error?: string }> {
  const supabase = await createSupabaseClient();

  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

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

  if (clientId) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: null,
      taskId,
      userId: profile.id,
      activityType: "task_updated",
    });
  }

  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");

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
export async function deleteTaskAction(taskId: string, clientId: string | null, formData: FormData): Promise<void>;
export async function deleteTaskAction(taskId: string, clientId: string | null): Promise<{ error?: string }>;
export async function deleteTaskAction(
  taskId: string,
  clientId: string | null,
  formData?: FormData,
): Promise<{ error?: string } | void> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  // Só alimenta a metadata do evento de auditoria abaixo — uma falha aqui
  // não deveria impedir a exclusão de verdade (que já é checada abaixo),
  // mas também não pode ficar muda: `queryOrError` já loga o erro real,
  // caindo pra `null` só na metadata (mesmo padrão defensivo de sempre).
  const taskResult = await queryOrError<{
    title: string;
    type: TaskType;
    due_date: string;
    assignee_id: string | null;
    sprint_id: string | null;
  }>(
    supabase.from("tasks").select("title, type, due_date, assignee_id, sprint_id").eq("id", taskId).single(),
    "tasks:pre-delete-audit",
    "Não foi possível carregar os dados da tarefa para o registro de auditoria.",
  );
  const task = "data" in taskResult ? taskResult.data : null;

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    if (!formData) return { error: "Não foi possível excluir a tarefa." };
    const fallback = clientId ? `/clients/${clientId}` : "/demandas";
    redirect(`${fallback}?taskError=${encodeURIComponent("Não foi possível excluir a tarefa.")}`);
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

  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");

  if (!formData) return {};
  redirect(resolveReturnTo(formData, clientId ? `/clients/${clientId}` : "/demandas"));
}

function pendenciasRevalidate(clientId: string | null, otherClientId?: string | null) {
  pendenciasRevalidateMany([clientId, otherClientId ?? null]);
}

/** Mesma revalidação de sempre, generalizada pra N clientes de uma vez —
 * usada pelas ações em lote (duplicar/excluir várias demandas, que podem
 * tocar clientes diferentes numa única chamada). */
function pendenciasRevalidateMany(clientIds: (string | null)[]) {
  const unique = new Set(clientIds.filter((id): id is string => id !== null));
  for (const clientId of unique) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/demandas`);
  }
  revalidatePath("/operation");
  revalidatePath("/sprints");
  revalidatePath("/clients");
  revalidatePath("/demandas");
  revalidatePath("/");
}

/** Status "editáveis" via seletor inline da linha da Pendência — nunca
 * inclui "feito" (delega pra `completeTaskAction`, que grava o evento
 * atômico correto) nem os dois status derivados/terminais especiais
 * ("atrasado", nunca gravado; "nao_realizado", só via `markTaskNotDoneAction`). */
export type EditableNonTerminalStatus = "pendente" | "em_andamento" | "aguardando" | "bloqueado";

/**
 * Edição inline de status direto na linha da lista de Pendências (Etapa
 * "Pendências") — escolher "Concluído" aqui delega pra `completeTaskAction`
 * (mesmo evento atômico de sempre); os 4 status intermediários são um
 * simples update, sem evento operacional próprio (não fazem parte da
 * taxonomia de `operational_events`, que registra CRIAÇÃO/CONCLUSÃO/
 * reatribuição/prazo — não cada transição de status intermediário).
 */
export async function updateTaskStatusInlineAction(
  taskId: string,
  clientId: string | null,
  status: EditableNonTerminalStatus | "feito",
): Promise<{ error?: string; message?: string }> {
  if (status === "feito") {
    const result = await completeTaskAction(taskId, clientId);
    return result?.error ? { error: result.error } : { message: "Pendência concluída." };
  }

  const supabase = await createSupabaseClient();
  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível atualizar o status.") };

  pendenciasRevalidate(clientId);
  return { message: "Status atualizado." };
}

/** Edição inline de prioridade direto na linha — simples update, sem evento
 * operacional próprio (mesmo raciocínio de `updateTaskStatusInlineAction`). */
export async function updateTaskPriorityInlineAction(
  taskId: string,
  clientId: string | null,
  priority: TaskPriority,
): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseClient();
  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const { error } = await supabase.from("tasks").update({ priority }).eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível atualizar a prioridade.") };

  pendenciasRevalidate(clientId);
  return { message: "Prioridade atualizada." };
}

/** Edição inline de responsável direto na linha — mesma lógica de
 * reatribuição/primeira-atribuição de `performUpdateTask` (TASK_ASSIGNED vs.
 * TASK_REASSIGNED), só que sem exigir reenviar o resto do formulário. */
export async function updateTaskAssigneeInlineAction(
  taskId: string,
  clientId: string | null,
  assigneeId: string | null,
): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseClient();
  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const previousResult = await queryOrError<{ assignee_id: string | null; sprint_id: string | null }>(
    supabase.from("tasks").select("assignee_id, sprint_id").eq("id", taskId).single(),
    "tasks:assignee-previous-state",
    "Não foi possível carregar o estado atual da pendência.",
  );
  if ("error" in previousResult) return { error: previousResult.error };
  const previous = previousResult.data;

  const isReassignment = previous ? assigneeId !== previous.assignee_id : false;
  if (!isReassignment) return { message: "Responsável atualizado." };

  const isFirstAssignment = !previous?.assignee_id;

  const { error } = await supabase.from("tasks").update({ assignee_id: assigneeId }).eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível atualizar o responsável.") };

  const profile = await getCurrentProfile();
  if (profile) {
    const actor = actorFromProfile(profile);
    await recordOperationalEvent(supabase, actor, {
      eventType: isFirstAssignment ? OperationalEventType.TASK_ASSIGNED : OperationalEventType.TASK_REASSIGNED,
      entityType: "task",
      entityId: taskId,
      clientId,
      sprintId: previous?.sprint_id ?? null,
      source: "web",
      metadata: {
        previous_assignee_team_member_id: previous?.assignee_id ?? null,
        new_assignee_team_member_id: assigneeId,
      },
    });
  }

  pendenciasRevalidate(clientId);
  return { message: "Responsável atualizado." };
}

/** Edição inline de prazo direto na linha — mesma lógica de
 * `performUpdateTask` pra `TASK_DUE_DATE_CHANGED` (was_already_overdue,
 * due_date_change_count), sem exigir reenviar o resto do formulário. */
export async function updateTaskDueDateInlineAction(
  taskId: string,
  clientId: string | null,
  dueDate: string,
): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseClient();
  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const previousResult = await queryOrError<{ due_date: string; due_date_change_count: number; sprint_id: string | null }>(
    supabase.from("tasks").select("due_date, due_date_change_count, sprint_id").eq("id", taskId).single(),
    "tasks:due-date-previous-state",
    "Não foi possível carregar o estado atual da pendência.",
  );
  if ("error" in previousResult) return { error: previousResult.error };
  const previous = previousResult.data;

  const isDueDateChange = previous ? dueDate !== previous.due_date : false;
  if (!isDueDateChange) return { message: "Prazo atualizado." };

  const wasAlreadyOverdue = previous ? previous.due_date < todayDateString() : false;
  const nextChangeCount = (previous?.due_date_change_count ?? 0) + 1;

  const { error } = await supabase
    .from("tasks")
    .update({ due_date: dueDate, due_date_change_count: nextChangeCount })
    .eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível atualizar o prazo.") };

  const profile = await getCurrentProfile();
  if (profile) {
    const actor = actorFromProfile(profile);
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.TASK_DUE_DATE_CHANGED,
      entityType: "task",
      entityId: taskId,
      clientId,
      sprintId: previous?.sprint_id ?? null,
      source: "web",
      metadata: {
        previous_due_date: previous?.due_date ?? null,
        new_due_date: dueDate,
        was_already_overdue: wasAlreadyOverdue,
        due_date_change_count: nextChangeCount,
      },
    });
  }

  pendenciasRevalidate(clientId);
  return { message: "Prazo atualizado." };
}

/** Edição inline de cliente direto na linha (seção 8 do pedido: "cliente
 * relacional de verdade, com pendência interna também suportada") — move a
 * pendência entre clientes ou entre um cliente e "Interna" (`null`).
 * `sprint_id` é sempre zerado na troca: uma sprint pertence a um cliente
 * específico, então trocar o cliente sem isso deixaria a pendência apontando
 * pra uma sprint de outro cliente. */
export async function updateTaskClientInlineAction(
  taskId: string,
  currentClientId: string | null,
  newClientId: string | null,
): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseClient();

  if (currentClientId) {
    const blocked = await checkWorkspaceClientAction(supabase, currentClientId);
    if (blocked) return { error: blocked };
  }
  if (newClientId) {
    const blocked = await checkWorkspaceClientAction(supabase, newClientId);
    if (blocked) return { error: blocked };
  }

  const { error } = await supabase.from("tasks").update({ client_id: newClientId, sprint_id: null }).eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível mover a pendência.") };

  pendenciasRevalidate(currentClientId, newClientId);
  return { message: "Pendência movida." };
}

/**
 * Reabre uma pendência concluída ou marcada como não realizada — único
 * caminho que emite TASK_REOPENED (Etapa "Pendências"; até aqui o tipo
 * existia na taxonomia mas nunca era emitido, ver `NOT_YET_EMITTED_EVENT_TYPES`
 * em `operational-events.ts`). Não é uma RPC atômica (ao contrário de
 * completar/não-realizar): reabrir não precisa recalcular no_prazo/atraso,
 * só voltar pro estado "pendente" e contar mais uma reabertura.
 */
export async function reopenTaskAction(taskId: string, clientId: string | null): Promise<{ error?: string; message?: string }> {
  const supabase = await createSupabaseClient();
  if (clientId) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }

  const previousResult = await queryOrError<{ status: TaskStatus; sprint_id: string | null; reopened_count: number }>(
    supabase.from("tasks").select("status, sprint_id, reopened_count").eq("id", taskId).single(),
    "tasks:reopen-previous-state",
    "Não foi possível carregar o estado atual da pendência.",
  );
  if ("error" in previousResult) return { error: previousResult.error };
  const previous = previousResult.data;

  if (previous && previous.status !== "feito" && previous.status !== "nao_realizado") {
    return { error: "Esta pendência já está em aberto." };
  }

  const nextReopenedCount = (previous?.reopened_count ?? 0) + 1;

  const { error } = await supabase
    .from("tasks")
    .update({ status: "pendente", completed_at: null, reopened_count: nextReopenedCount })
    .eq("id", taskId);
  if (error) return { error: toUserFacingError(error, "Não foi possível reabrir a pendência.") };

  if (clientId) {
    await logOperationalActivity(supabase, {
      clientId,
      sprintId: previous?.sprint_id ?? null,
      taskId,
      userId: profile.id,
      activityType: "task_updated",
    });
  }

  const actor = actorFromProfile(profile);
  await recordOperationalEvent(supabase, actor, {
    eventType: OperationalEventType.TASK_REOPENED,
    entityType: "task",
    entityId: taskId,
    clientId,
    sprintId: previous?.sprint_id ?? null,
    source: "web",
    metadata: { previous_status: previous?.status ?? null, reopened_count: nextReopenedCount },
  });

  pendenciasRevalidate(clientId);
  return { message: "Pendência reaberta." };
}

/**
 * Duplicar demandas em lote (Etapa "Pendências — Segunda Rodada", seção 6)
 * — UMA leitura dos originais + UM insert com todas as cópias, nunca uma
 * requisição por item selecionado (seção 11 do pedido, performance).
 *
 * Preserva: título, descrição (`notes`), cliente, responsável, prioridade,
 * prazo, tipo. NUNCA copia: comentários (tabela própria, nada aqui os
 * referencia), `operational_events`/histórico (cada cópia recebe seu
 * próprio TASK_CREATED, nunca herda o rastro do original),
 * completion_count/reassignment_count/due_date_change_count/reopened_count
 * (ficam no default 0 — identidade nova, sem histórico herdado),
 * completed_at (null — mesmo se o original estava concluído). `sprint_id`
 * também não é copiado (null): uma cópia é sempre uma demanda solta nova,
 * mesmo padrão de toda criação manual em Pendências.
 *
 * Status inicial: sempre "pendente" ("A fazer"), NUNCA herdado do
 * original — decisão validada contra a arquitetura (mesmo raciocínio de
 * `reopenTaskAction`: reabrir também sempre volta pra "pendente", nunca
 * pro status anterior a "feito"/"nao_realizado" — consistente).
 * `origin: 'manual'` sempre — duplicar é, em si, um ato humano explícito.
 */
export async function duplicateTasksAction(taskIds: string[]): Promise<{ error?: string; message?: string }> {
  if (taskIds.length === 0) return { error: "Nenhuma demanda selecionada." };

  const supabase = await createSupabaseClient();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const originalsResult = await queryOrError<
    {
      id: string;
      client_id: string | null;
      title: string;
      type: TaskType;
      assignee_id: string | null;
      due_date: string;
      priority: TaskPriority;
      notes: string | null;
    }[]
  >(
    supabase.from("tasks").select("id, client_id, title, type, assignee_id, due_date, priority, notes").in("id", taskIds),
    "tasks:duplicate-originals",
    "Não foi possível carregar as demandas selecionadas.",
  );
  if ("error" in originalsResult) return { error: originalsResult.error };
  const originals = originalsResult.data ?? [];
  if (originals.length === 0) return { error: "Nenhuma demanda encontrada." };

  const uniqueClientIds = Array.from(new Set(originals.map((o) => o.client_id).filter((id): id is string => id !== null)));
  for (const clientId of uniqueClientIds) {
    const blocked = await checkWorkspaceClientAction(supabase, clientId);
    if (blocked) return { error: blocked };
  }

  const newRows = originals.map((original) => withOriginalDueDate(buildDuplicateTaskRow(original)));

  const { data: created, error } = await supabase.from("tasks").insert(newRows).select("id, client_id, title");
  if (error || !created) {
    return { error: toUserFacingError(error, "Não foi possível duplicar as demandas.") };
  }

  const actor = actorFromProfile(profile);
  for (const row of created) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.TASK_CREATED,
      entityType: "task",
      entityId: row.id,
      clientId: row.client_id,
      source: "web",
      metadata: { task_title: row.title, origin: "duplicate" },
    });
  }

  pendenciasRevalidateMany(uniqueClientIds);
  return { message: `${created.length} demanda${created.length === 1 ? "" : "s"} duplicada${created.length === 1 ? "" : "s"}.` };
}

/**
 * Exclusão em lote (Etapa "Pendências — Segunda Rodada", seção 6) — admin
 * only, mesma regra do botão de exclusão individual (`deleteTaskAction`).
 * Auditoria feita antes de implementar: `comments.commentable_id` (ver
 * `supabase/schema.sql`) NUNCA foi uma foreign key de verdade — é uma
 * coluna polimórfica solta (`commentable_type` + `commentable_id`, sem
 * `references`), então excluir uma tarefa NUNCA apaga em cascata seus
 * comentários — eles ficam órfãos (permanecem no banco, apenas
 * inacessíveis pela interface, já que nada mais os referencia). Esse já é
 * o comportamento aceito pra exclusão individual hoje; esta ação em lote
 * só aplica a MESMA estratégia várias vezes, nunca uma nova. Auditoria
 * histórica: cada exclusão grava TASK_DELETED em `operational_events`
 * ANTES do delete de fato — `entity_id` ali nunca é uma foreign key
 * (entidade polimórfica), então o evento sobrevive à tarefa apagada,
 * preservando o rastro mesmo sem a linha original.
 *
 * UMA leitura + UM delete + UM insert de eventos — nunca uma chamada por
 * item selecionado.
 */
export async function bulkDeleteTasksAction(taskIds: string[]): Promise<{ error?: string; message?: string }> {
  if (taskIds.length === 0) return { error: "Nenhuma demanda selecionada." };

  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const tasksResult = await queryOrError<
    { id: string; title: string; type: TaskType; due_date: string; assignee_id: string | null; client_id: string | null }[]
  >(
    supabase.from("tasks").select("id, title, type, due_date, assignee_id, client_id").in("id", taskIds),
    "tasks:bulk-delete-audit",
    "Não foi possível carregar os dados das demandas para o registro de auditoria.",
  );
  const tasks = "data" in tasksResult ? (tasksResult.data ?? []) : [];

  const { error } = await supabase.from("tasks").delete().in("id", taskIds);
  if (error) return { error: toUserFacingError(error, "Não foi possível excluir as demandas.") };

  const actor = actorFromProfile(profile);
  for (const task of tasks) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.TASK_DELETED,
      entityType: "task",
      entityId: task.id,
      clientId: task.client_id,
      source: "web",
      metadata: {
        task_title: task.title,
        task_type: task.type,
        due_date: task.due_date,
        assignee_team_member_id: task.assignee_id,
      },
    });
  }

  const uniqueClientIds = Array.from(new Set(tasks.map((t) => t.client_id).filter((id): id is string => id !== null)));
  pendenciasRevalidateMany(uniqueClientIds);
  return { message: `${tasks.length} demanda${tasks.length === 1 ? "" : "s"} excluída${tasks.length === 1 ? "" : "s"}.` };
}
