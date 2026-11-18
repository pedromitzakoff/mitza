"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth";
import { requireQuery } from "@/lib/require-query";
import { didGestorEditBodyTextVerbatim, renderReportTemplate } from "@/lib/weekly-reports/report-template";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { WeeklyReportMetrics, WeeklyReportStatus } from "@/lib/weekly-reports/report-types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Aba "Reports" (pedido, seção 4) — ações manuais sobre UM report: editar
 * texto, marcar como enviado e desfazer. Mesmo critério de amplo acesso
 * interno de sempre (`requireActiveProfile()`, nunca `requireAdmin()` —
 * ver `app/alerts/actions.ts`): conferir/editar/enviar um report é
 * trabalho de dia a dia, não administrativo.
 *
 * "Copiar para WhatsApp" NÃO tem Server Action — é client-side puro
 * (Clipboard API), porque o pedido é explícito: "Copiar mantém o status
 * atual" (nada pra persistir).
 */

export interface WeeklyReportActionResult {
  error?: string;
  message?: string;
}

interface ReportForAction {
  id: string;
  client_id: string;
  client_name: string;
  period_start: string;
  period_end: string;
  status: WeeklyReportStatus;
  performance_goal: PerformanceGoal | null;
  metrics: Record<string, unknown>;
  next_step: string | null;
  body_text: string;
}

async function loadReportForAction(reportId: string): Promise<ReportForAction | null> {
  const supabase = await createSupabaseClient();
  const rows = await requireQuery(
    supabase
      .from("weekly_reports")
      .select("id, client_id, period_start, period_end, status, performance_goal, metrics, next_step, body_text")
      .eq("id", reportId)
      .limit(1),
    "weekly_reports:load-for-action",
  );
  const row = rows[0];
  if (!row) return null;

  const clientRows = await requireQuery(supabase.from("clients").select("name").eq("id", row.client_id).limit(1), "clients:load-for-action");

  return {
    id: row.id,
    client_id: row.client_id,
    client_name: clientRows[0]?.name ?? "",
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    performance_goal: row.performance_goal as PerformanceGoal | null,
    metrics: row.metrics,
    next_step: row.next_step,
    body_text: row.body_text,
  };
}

function parseMetricsOrNull(raw: Record<string, unknown>): WeeklyReportMetrics | null {
  return typeof raw.investment === "number" ? (raw as unknown as WeeklyReportMetrics) : null;
}

/**
 * "Editar texto" (pedido: "salve as edições do gestor... inclua um campo
 * opcional de próximo passo... quando preenchido, inclua no texto
 * copiado"). Se o gestor deixou a textarea EXATAMENTE como veio e só
 * mudou o próximo passo, o novo próximo passo é religado no template
 * (`didGestorEditBodyTextVerbatim` decide isso); se ele tocou o texto,
 * a palavra dele vale literal — nos dois casos, `text_edited_at` passa a
 * valer, e nenhum reprocessamento automático futuro volta a sobrescrever
 * este texto (ver `generate-weekly-reports.ts`).
 */
export async function updateReportTextAction(reportId: string, formData: FormData): Promise<WeeklyReportActionResult> {
  await requireActiveProfile();
  const supabase = await createSupabaseClient();

  const report = await loadReportForAction(reportId);
  if (!report) return { error: "Report não encontrado." };
  if (report.status === "enviado") return { error: "Este report já foi enviado — reabra via \"Desfazer\" pra editar." };

  const nextStep = String(formData.get("nextStep") ?? "").trim();
  const submittedBodyText = String(formData.get("bodyText") ?? "");

  let bodyText = submittedBodyText;
  const metrics = parseMetricsOrNull(report.metrics);
  if (!didGestorEditBodyTextVerbatim(report.body_text, submittedBodyText) && metrics && report.performance_goal) {
    bodyText = renderReportTemplate({
      clientName: report.client_name,
      periodStart: report.period_start,
      periodEnd: report.period_end,
      goal: report.performance_goal,
      investment: metrics.investment,
      resultCount: metrics.resultCount,
      costPerResult: metrics.costPerResult,
      highlights: metrics.highlights,
      nextStep: nextStep || null,
    });
  }

  const nowIso = new Date().toISOString();
  const patch: Database["public"]["Tables"]["weekly_reports"]["Update"] = {
    next_step: nextStep || null,
    body_text: bodyText,
    text_edited_at: nowIso,
  };

  const { error: updateError } = await supabase.from("weekly_reports").update(patch).eq("id", reportId);
  if (updateError) return { error: "Não foi possível salvar as edições." };

  const { error: eventError } = await supabase.from("weekly_report_events").insert({
    report_id: reportId,
    event_type: "texto_editado",
    note: nextStep || null,
    text_snapshot: bodyText,
  });
  if (eventError) return { error: "Edições salvas, mas não foi possível registrar o histórico." };

  revalidatePath("/reports");
  return { message: "Edições salvas." };
}

/** "Marcar como enviado" (pedido: "registre o usuário, a data, a hora e a
 * versão final do texto"). A partir daqui, nenhum reprocessamento
 * automático toca mais esta linha (ver `generate-weekly-reports.ts`). */
export async function markReportSentAction(reportId: string): Promise<WeeklyReportActionResult> {
  const profile = await requireActiveProfile();
  const supabase = await createSupabaseClient();

  const report = await loadReportForAction(reportId);
  if (!report) return { error: "Report não encontrado." };
  if (report.status === "enviado") return { error: "Este report já está marcado como enviado." };
  if (report.status === "aguardando_dados") return { error: "Este report ainda está aguardando dados — não há texto pronto pra enviar." };

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("weekly_reports")
    .update({ status: "enviado", sent_by: profile.id, sent_at: nowIso, sent_text: report.body_text })
    .eq("id", reportId);
  if (updateError) return { error: "Não foi possível marcar como enviado." };

  const { error: eventError } = await supabase.from("weekly_report_events").insert({
    report_id: reportId,
    event_type: "marcado_enviado",
    actor_id: profile.id,
    text_snapshot: report.body_text,
  });
  if (eventError) return { error: "Marcado como enviado, mas não foi possível registrar o histórico." };

  revalidatePath("/reports");
  return { message: "Marcado como enviado." };
}

/** "Desfazer" (pedido: "permita desfazer uma marcação feita por engano") —
 * volta pra "Pronto para enviar"; o texto (`body_text`) NÃO regride (fica
 * com a versão que tinha sido enviada), só os campos de envio em si são
 * limpos. `sent_text`/o evento `marcado_enviado` continuam no histórico
 * pra sempre (pedido: "mantenha a versão enviada no histórico"). */
export async function undoReportSentAction(reportId: string): Promise<WeeklyReportActionResult> {
  const profile = await requireActiveProfile();
  const supabase = await createSupabaseClient();

  const report = await loadReportForAction(reportId);
  if (!report) return { error: "Report não encontrado." };
  if (report.status !== "enviado") return { error: "Este report não está marcado como enviado." };

  const { error: updateError } = await supabase
    .from("weekly_reports")
    .update({ status: "pronto_para_enviar", sent_by: null, sent_at: null })
    .eq("id", reportId);
  if (updateError) return { error: "Não foi possível desfazer o envio." };

  const { error: eventError } = await supabase.from("weekly_report_events").insert({
    report_id: reportId,
    event_type: "envio_desfeito",
    actor_id: profile.id,
  });
  if (eventError) return { error: "Envio desfeito, mas não foi possível registrar o histórico." };

  revalidatePath("/reports");
  return { message: "Envio desfeito — o report voltou para \"Pronto para enviar\"." };
}
