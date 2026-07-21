"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireAdmin } from "@/lib/auth";
import { todayUTC, todayDateString } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { getOrCreateReport, buildReportViewData } from "./report-data";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { withOriginalDueDate } from "@/lib/task-creation";
import type {
  KpiDirection,
  KpiUnit,
  MonthlyReportStatus,
  ReportActionItemDependency,
  ReportActionItemStatus,
  ReportTimelineEventType,
} from "@/lib/supabase/database.types";

function monthParamFromStart(monthStart: string): string {
  return monthStart.slice(0, 7);
}

function reportsUrl(clientId: string, monthStart: string): string {
  return `/reports/${clientId}?month=${monthParamFromStart(monthStart)}`;
}

/** Bloco 1 (resumo executivo) e Bloco 5 (próximo mês) — um único action
 * atualiza só os campos presentes no FormData que chamou, então os dois
 * blocos podem ter formulários próprios sem precisar de duas funções quase
 * iguais. */
export async function updateReportFieldsAction(clientId: string, monthStart: string, formData: FormData) {
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  const update: Record<string, string | null> = {};
  for (const key of [
    "executive_summary",
    "next_month_priority",
    "next_month_problems",
    "next_month_opportunities",
    "next_month_tests",
    "analysis_what_worked",
    "analysis_what_didnt_work",
    "analysis_problems",
    "analysis_opportunities",
    "analysis_learnings",
  ]) {
    if (formData.has(key)) {
      update[key] = String(formData.get(key) ?? "").trim() || null;
    }
  }

  const { error } = await supabase
    .from("monthly_reports")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", reportId);

  const returnTo = reportsUrl(clientId, monthStart);
  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  // Platform Continuity System 1.0: sem redirect no sucesso — quem chama já
  // está na própria página de Relatórios, `revalidatePath` já atualiza os
  // campos no lugar.
  revalidatePath(`/reports/${clientId}`);
  revalidatePath("/reports");
}

export async function updateKpiValueAction(
  clientId: string,
  monthStart: string,
  kpiDefinitionId: string,
  formData: FormData,
) {
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  const rawResult = String(formData.get("result") ?? "").trim();
  const result = rawResult === "" ? null : Number(rawResult);

  const { error } = await supabase.from("report_kpi_values").upsert(
    {
      report_id: reportId,
      kpi_definition_id: kpiDefinitionId,
      result,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "report_id,kpi_definition_id" },
  );

  const returnTo = reportsUrl(clientId, monthStart);
  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/reports/${clientId}`);
}

export async function addTimelineEventAction(clientId: string, monthStart: string, formData: FormData) {
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  const profile = await getCurrentProfile();

  const eventDate = String(formData.get("event_date") ?? "").trim() || todayDateString();
  const type = String(formData.get("type") ?? "outro") as ReportTimelineEventType;
  const description = String(formData.get("description") ?? "").trim();
  const responsibleId = String(formData.get("responsible_id") ?? "") || null;

  const returnTo = reportsUrl(clientId, monthStart);
  if (!description) {
    redirect(`${returnTo}&error=${encodeURIComponent("Descrição do acontecimento é obrigatória")}`);
  }

  const { error } = await supabase.from("report_timeline_events").insert({
    report_id: reportId,
    event_date: eventDate,
    type,
    description,
    responsible_id: responsibleId,
    created_by: profile?.id ?? null,
  });

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/reports/${clientId}`);
}

export async function deleteTimelineEventAction(eventId: string, clientId: string) {
  const supabase = await createSupabaseClient();
  await supabase.from("report_timeline_events").delete().eq("id", eventId);

  revalidatePath(`/reports/${clientId}`);
}

export async function addActionItemAction(clientId: string, monthStart: string, formData: FormData) {
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  const title = String(formData.get("title") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim();
  const responsibleId = String(formData.get("responsible_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "") || null;
  const dependency = String(formData.get("dependency") ?? "") || null;

  const returnTo = reportsUrl(clientId, monthStart);
  if (!description) {
    redirect(`${returnTo}&error=${encodeURIComponent("Descrição da pendência é obrigatória")}`);
  }

  const { error } = await supabase.from("report_action_items").insert({
    report_id: reportId,
    title,
    description,
    responsible_id: responsibleId,
    due_date: dueDate,
    dependency: dependency as ReportActionItemDependency | null,
  });

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/reports/${clientId}`);
}

export async function updateActionItemStatusAction(
  actionItemId: string,
  clientId: string,
  monthStart: string,
  formData: FormData,
) {
  const supabase = await createSupabaseClient();
  const status = String(formData.get("status") ?? "pendente") as ReportActionItemStatus;

  await supabase.from("report_action_items").update({ status }).eq("id", actionItemId);

  revalidatePath(`/reports/${clientId}`);
}

/** "Enviar para próxima sprint" — cria uma tarefa de verdade na primeira
 * sprint do mês seguinte (nunca duplica a ação em uma segunda representação
 * paralela). Idempotente: se `sent_to_task_id` já estiver preenchido, não
 * cria outra tarefa de novo. */
export async function sendActionItemToSprintAction(actionItemId: string, clientId: string, monthStart: string) {
  const supabase = await createSupabaseClient();
  const returnTo = reportsUrl(clientId, monthStart);

  const { data: item } = await supabase
    .from("report_action_items")
    .select("id, description, responsible_id, due_date, sent_to_task_id")
    .eq("id", actionItemId)
    .single();

  if (!item) redirect(`${returnTo}&error=${encodeURIComponent("Ação não encontrada")}`);
  if (item.sent_to_task_id) return;

  const nextMonthDate = new Date(`${monthStart}T00:00:00Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonthFirstDay = nextMonthDate.toISOString().slice(0, 7) + "-01";
  const nextMonthLastDay = new Date(
    Date.UTC(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10);

  const { data: nextSprint } = await supabase
    .from("sprints")
    .select("id, start_date")
    .eq("client_id", clientId)
    .gte("start_date", nextMonthFirstDay)
    .lte("start_date", nextMonthLastDay)
    .order("start_date")
    .limit(1)
    .maybeSingle();

  if (!nextSprint) {
    redirect(
      `${returnTo}&error=${encodeURIComponent("A primeira sprint do próximo mês ainda não foi gerada para este cliente")}`,
    );
  }

  const { data: createdTask, error } = await supabase
    .from("tasks")
    .insert(
      withOriginalDueDate({
        client_id: clientId,
        title: item.description,
        type: "outro" as const,
        assignee_id: item.responsible_id,
        due_date: item.due_date ?? nextSprint.start_date,
        sprint_id: nextSprint.id,
      }),
    )
    .select("id")
    .single();

  if (error || !createdTask) {
    redirect(`${returnTo}&error=${encodeURIComponent(error?.message ?? "Erro ao criar tarefa")}`);
  }

  await supabase.from("report_action_items").update({ sent_to_task_id: createdTask.id }).eq("id", actionItemId);

  revalidatePath(`/reports/${clientId}`);
  revalidatePath("/sprints");
}

/** "Adicionar ao relatório mensal" — marca (ou desmarca) um comentário de
 * sprint pro fechamento mensal; ao marcar, também vira automaticamente um
 * item da linha do tempo (Bloco 4), sem precisar de nenhum passo manual
 * extra. O mês do relatório é sempre o mês da sprint comentada, nunca o mês
 * que a tela Sprints está navegando no momento. Sem redirect de propósito
 * (mesmo padrão de createCommentAction) — quem chama já está na página
 * certa, só revalida em cima, sem resetar scroll nem fechar o que estava
 * expandido. */
export async function toggleCommentReportSelectionAction(
  commentId: string,
  sprintId: string,
  clientId: string,
  currentlyIncluded: boolean,
) {
  const supabase = await createSupabaseClient();

  const { data: sprint } = await supabase.from("sprints").select("start_date").eq("id", sprintId).single();
  if (!sprint) return;

  const monthStart = `${sprint.start_date.slice(0, 7)}-01`;
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  if (currentlyIncluded) {
    await supabase.from("report_comment_selections").delete().eq("report_id", reportId).eq("comment_id", commentId);
    await supabase.from("report_timeline_events").delete().eq("report_id", reportId).eq("source_comment_id", commentId);
  } else {
    const profile = await getCurrentProfile();

    const { data: comment } = await supabase
      .from("comments")
      .select("content, created_at, author_id")
      .eq("id", commentId)
      .single();

    await supabase
      .from("report_comment_selections")
      .insert({ report_id: reportId, comment_id: commentId, created_by: profile?.id ?? null });

    if (comment) {
      await supabase.from("report_timeline_events").insert({
        report_id: reportId,
        event_date: comment.created_at.slice(0, 10),
        type: "comentario",
        description: comment.content,
        responsible_id: comment.author_id,
        source_comment_id: commentId,
        created_by: profile?.id ?? null,
      });
    }
  }

  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/reports");
  revalidatePath(`/reports/${clientId}`);
}

export async function updateReportStatusAction(clientId: string, monthStart: string, formData: FormData) {
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);
  const status = String(formData.get("status") ?? "em_andamento") as MonthlyReportStatus;

  // "Finalizado" só entra por finalizeReportAction (precisa do snapshot e é
  // restrito a admin) — esta rota nunca grava esse status.
  if (status === "finalizado") return;

  await supabase.from("monthly_reports").update({ status, updated_at: new Date().toISOString() }).eq("id", reportId);

  if (status === "pronto_revisao") {
    const profile = await getCurrentProfile();
    if (profile) {
      await recordOperationalEvent(supabase, actorFromProfile(profile), {
        eventType: OperationalEventType.MONTHLY_REPORT_READY_FOR_REVIEW,
        entityType: "monthly_report",
        entityId: reportId,
        clientId,
        source: "web",
        metadata: { month_start: monthStart },
      });
    }
  }

  revalidatePath(`/reports/${clientId}`);
  revalidatePath("/reports");
}

/** Finaliza o relatório (só admin, seção 12) — congela um snapshot com tudo
 * que a tela mostra ao vivo, reaproveitando `buildReportViewData` (nenhuma
 * segunda lógica de agregação pro snapshot). A partir daqui, mudanças
 * futuras no orçamento/KPIs/tarefas não alteram mais este relatório. */
export async function finalizeReportAction(clientId: string, monthStart: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  const view = await buildReportViewData(supabase, clientId, monthParamFromStart(monthStart), todayUTC(), formatMonthLabel);
  const returnTo = reportsUrl(clientId, monthStart);
  if (!view) redirect(`${returnTo}&error=${encodeURIComponent("Cliente não encontrado")}`);

  const snapshot = {
    financial: view.financial,
    kpis: view.kpis,
    execution: view.execution,
    sprintBehavior: view.sprintBehavior,
    timelineEvents: view.timelineEvents,
    actionItems: view.actionItems,
  };

  const { error } = await supabase
    .from("monthly_reports")
    .update({
      status: "finalizado",
      finalized_by: profile.id,
      finalized_at: new Date().toISOString(),
      snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reportId);

  if (error) redirect(`${returnTo}&error=${encodeURIComponent(error.message)}`);

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.MONTHLY_REPORT_FINALIZED,
    entityType: "monthly_report",
    entityId: reportId,
    clientId,
    source: "web",
    metadata: { month_start: monthStart },
  });

  revalidatePath(`/reports/${clientId}`);
  revalidatePath("/reports");
}

/** Reabre um relatório finalizado por engano (só admin) — volta pra "pronto
 * para revisão" e descarta o snapshot; a tela passa a ler dados ao vivo de
 * novo até finalizar mais uma vez. */
export async function reopenReportAction(clientId: string, monthStart: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();
  const { id: reportId } = await getOrCreateReport(supabase, clientId, monthStart);

  await supabase
    .from("monthly_reports")
    .update({
      status: "pronto_revisao",
      finalized_by: null,
      finalized_at: null,
      snapshot: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reportId);

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.MONTHLY_REPORT_REOPENED,
    entityType: "monthly_report",
    entityId: reportId,
    clientId,
    source: "web",
    metadata: { month_start: monthStart },
  });

  revalidatePath(`/reports/${clientId}`);
  revalidatePath("/reports");
}

// ---------------------------------------------------------------------------
// KPIs configurados por cliente (Configurações > editar cliente) — controlam
// quais KPIs aparecem no Bloco 2 de todos os meses deste cliente.
// ---------------------------------------------------------------------------

export async function addClientKpiAction(clientId: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const unit = String(formData.get("unit") ?? "numero") as KpiUnit;
  const direction = String(formData.get("direction") ?? "maior_melhor") as KpiDirection;
  const rawTarget = String(formData.get("target") ?? "").trim();
  const target = rawTarget === "" ? null : Number(rawTarget);

  const returnTo = `/clients/${clientId}/edit`;
  if (!name) redirect(`${returnTo}?error=${encodeURIComponent("Nome do KPI é obrigatório")}`);

  const { count } = await supabase
    .from("client_kpi_definitions")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  const { error } = await supabase.from("client_kpi_definitions").insert({
    client_id: clientId,
    name,
    unit,
    direction,
    target,
    display_order: count ?? 0,
  });

  if (error) redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);

  // Platform Continuity System 1.0: sem redirect — o formulário de KPIs já
  // vive na própria página de edição do cliente; `revalidatePath` mostra o
  // KPI novo na lista sem recarregar a página.
  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/reports/${clientId}`);
}

export async function deleteClientKpiAction(kpiId: string, clientId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("client_kpi_definitions").delete().eq("id", kpiId);

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/reports/${clientId}`);
}
