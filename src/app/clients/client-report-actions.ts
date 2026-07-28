"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { checkWorkspaceClientAction } from "@/lib/require-workspace-client";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { buildClientReportText, type ClientReportMetric } from "@/lib/client-reports";
import { fetchClientReportMetrics, findActiveReportRecurringTaskId, type ClientReportMetricsResult } from "@/app/clients/client-report-data";

/** Etapa 2 do wizard (Buscar métricas) — chamada direta do client component
 * assim que o gestor confirma o período, sem `<form>`/redirect (mesmo
 * padrão de `updateClientUpdateContentAction`). */
export async function fetchReportMetricsAction(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ClientReportMetricsResult | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sessão expirada, faça login de novo." };

  const supabase = await createSupabaseClient();
  return fetchClientReportMetrics(supabase, clientId, { start: periodStart, end: periodEnd });
}

export interface SaveClientReportInput {
  /** Presente = reabertura de um report existente (edição); ausente = novo
   * report — decide insert vs. update e se GENERATED ou EDITED é emitido. */
  reportId?: string | null;
  clientId: string;
  periodStart: string;
  periodEnd: string;
  metrics: ClientReportMetric[];
  observations: string | null;
}

export interface SaveClientReportResult {
  ok: boolean;
  error?: string;
  reportId?: string;
  finalText?: string;
}

/**
 * Salva o CONTEÚDO do report (rascunho) — cria um `client_reports` novo ou
 * atualiza um existente (reports permanecem editáveis pra sempre, mesmo já
 * enviados). Nunca mexe em `status`/`sent_at`/`sent_by`: essa transição só
 * acontece em `markClientReportSentAction`, abaixo — salvar um rascunho
 * (ou editar um report já enviado) nunca registra a execução da recorrência
 * sozinho. `performance_goal` é gravado só na criação (snapshot do objetivo
 * do cliente no momento — nunca recalculado numa edição posterior, mesmo
 * espírito de `recurring_task_goal_history`).
 */
export async function saveClientReportAction(input: SaveClientReportInput): Promise<SaveClientReportResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sessão expirada, faça login de novo." };

  if (input.periodEnd < input.periodStart) return { ok: false, error: "Período inválido." };

  const supabase = await createSupabaseClient();

  const blocked = await checkWorkspaceClientAction(supabase, input.clientId);
  if (blocked) return { ok: false, error: blocked };

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("name, performance_goal")
    .eq("id", input.clientId)
    .single();
  if (clientError || !client) return { ok: false, error: "Cliente não encontrado." };

  const metrics = input.metrics.filter((metric) => metric.label.trim().length > 0);
  const finalText = buildClientReportText({
    clientName: client.name,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    metrics,
    observations: input.observations,
  });

  const isEdit = Boolean(input.reportId);
  let reportId = input.reportId ?? null;

  if (isEdit && reportId) {
    const { error } = await supabase
      .from("client_reports")
      .update({
        period_start: input.periodStart,
        period_end: input.periodEnd,
        metrics,
        observations: input.observations,
        final_text: finalText,
      })
      .eq("id", reportId);
    if (error) return { ok: false, error: "Não foi possível salvar o report." };
  } else {
    const { data: inserted, error } = await supabase
      .from("client_reports")
      .insert({
        organization_id: profile.organizationId,
        client_id: input.clientId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        performance_goal: client.performance_goal,
        metrics,
        observations: input.observations,
        final_text: finalText,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, error: "Não foi possível salvar o report." };
    reportId = inserted.id;
  }

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: isEdit ? OperationalEventType.CLIENT_REPORT_EDITED : OperationalEventType.CLIENT_REPORT_GENERATED,
    entityType: "client_report",
    entityId: reportId,
    clientId: input.clientId,
    source: "web",
    metadata: { period_start: input.periodStart, period_end: input.periodEnd },
  });

  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true, reportId, finalText };
}

export interface MarkClientReportSentInput {
  reportId: string;
  clientId: string;
  /** Presente só quando o wizard foi aberto a partir do drawer da
   * recorrência "Reportar cliente" — usado pra registrar a execução direto.
   * Ausente (report gerado pelo módulo do cliente) faz esta action procurar
   * uma recorrência ativa aplicável (`findActiveReportRecurringTaskId`)
   * antes de decidir se há execução pra registrar — nunca cria uma
   * recorrência nova. */
  recurringTaskId?: string | null;
}

export interface MarkClientReportSentResult {
  ok: boolean;
  error?: string;
  sentAt?: string;
  sentByName?: string;
}

/**
 * "Marcar como enviado" — a única transição que grava `status = 'sent'` e,
 * consequentemente, a única que registra a execução da recorrência
 * "Reportar cliente" (nunca ao salvar um rascunho, nunca ao copiar pro
 * WhatsApp: o gestor pode copiar e ainda ajustar antes de mandar). Dedupe
 * explícito por `client_report_id` — reabrir um report já enviado e marcar
 * de novo nunca cria uma segunda execução.
 */
export async function markClientReportSentAction(input: MarkClientReportSentInput): Promise<MarkClientReportSentResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sessão expirada, faça login de novo." };

  const supabase = await createSupabaseClient();

  const blocked = await checkWorkspaceClientAction(supabase, input.clientId);
  if (blocked) return { ok: false, error: blocked };

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("client_reports")
    .update({ status: "sent", sent_at: now, sent_by: profile.id })
    .eq("id", input.reportId);
  if (updateError) return { ok: false, error: "Não foi possível marcar o report como enviado." };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.CLIENT_REPORT_SENT,
    entityType: "client_report",
    entityId: input.reportId,
    clientId: input.clientId,
    source: "web",
    metadata: {},
  });

  revalidatePath(`/clients/${input.clientId}`);

  // Dedupe: se este report já tiver uma execução vinculada (ex.: reaberto e
  // marcado como enviado de novo), nunca registra uma segunda.
  const { data: existingExecution } = await supabase
    .from("recurring_task_executions")
    .select("id")
    .eq("client_report_id", input.reportId)
    .maybeSingle();
  if (existingExecution) return { ok: true, sentAt: now, sentByName: profile.name };

  const recurringTaskId = input.recurringTaskId ?? (await findActiveReportRecurringTaskId(supabase, input.clientId));
  if (!recurringTaskId) return { ok: true, sentAt: now, sentByName: profile.name };

  const { error: rpcError } = await supabase.rpc("register_recurring_execution", {
    p_recurring_task_id: recurringTaskId,
    p_client_id: input.clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_notes: null,
    p_checklist_selected_keys: null,
    p_optimization_selections: null,
    p_client_report_id: input.reportId,
    p_source: "web",
  });
  if (rpcError) {
    return {
      ok: true,
      sentAt: now,
      sentByName: profile.name,
      error: `Report marcado como enviado, mas não foi possível registrar a execução da recorrência: ${rpcError.message}`,
    };
  }

  return { ok: true, sentAt: now, sentByName: profile.name };
}
