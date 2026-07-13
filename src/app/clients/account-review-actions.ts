"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile, requireAdmin } from "@/lib/auth";
import {
  ACCOUNT_REVIEW_REASONS,
  ACCOUNT_REVIEW_OUTCOMES,
  OPTIMIZATION_TYPES,
  OPTIMIZATION_ACTIONS_BY_TYPE,
} from "@/lib/account-reviews";
import type { AccountReviewOutcome, AccountReviewReason, OptimizationType } from "@/lib/supabase/database.types";

interface OptimizationInput {
  type: OptimizationType;
  action: string;
  description: string;
  reason: string;
  expectedImpact: string;
}

function parseOptimizations(raw: string): OptimizationInput[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: OptimizationInput[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    const action = (item as Record<string, unknown>).action;
    if (typeof type !== "string" || !OPTIMIZATION_TYPES.includes(type as OptimizationType)) continue;
    if (typeof action !== "string" || !OPTIMIZATION_ACTIONS_BY_TYPE[type as OptimizationType].includes(action)) continue;

    valid.push({
      type: type as OptimizationType,
      action,
      description: String((item as Record<string, unknown>).description ?? "").trim(),
      reason: String((item as Record<string, unknown>).reason ?? "").trim(),
      expectedImpact: String((item as Record<string, unknown>).expectedImpact ?? "").trim(),
    });
  }
  return valid;
}

/**
 * Registra uma Análise da Conta (Etapa 57) — toda a validação de negócio e a
 * gravação (análise + otimizações + tarefa opcional + eventos operacionais)
 * acontece atomicamente em `record_account_review` (supabase/account-
 * reviews.sql); esta action só resolve o ator, normaliza o input do
 * formulário e traduz erros do banco em mensagens curtas.
 */
export async function recordAccountReviewAction(clientId: string, returnTo: string, formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reviewError=${encodeURIComponent("Sessão expirada, faça login de novo")}`);
  }

  const supabase = await createSupabaseClient();

  const reason = String(formData.get("reason") ?? "") as AccountReviewReason;
  const reasonOtherDescription = String(formData.get("reason_other_description") ?? "").trim() || null;
  const outcome = String(formData.get("outcome") ?? "") as AccountReviewOutcome;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const issueDescription = String(formData.get("issue_description") ?? "").trim() || null;
  const issueCategory = String(formData.get("issue_category") ?? "").trim() || null;
  const createTask = formData.get("create_task") === "on";
  const taskResponsibleId = String(formData.get("task_responsible_id") ?? "") || null;
  const taskDueDate = String(formData.get("task_due_date") ?? "") || null;
  const optimizations = parseOptimizations(String(formData.get("optimizations_json") ?? ""));

  function fail(message: string): never {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}reviewError=${encodeURIComponent(message)}`);
  }

  if (!ACCOUNT_REVIEW_REASONS.includes(reason)) fail("Selecione o motivo da análise.");
  if (reason === "OTHER" && !reasonOtherDescription) fail('Descreva o motivo quando selecionar "Outro".');
  if (!ACCOUNT_REVIEW_OUTCOMES.includes(outcome)) fail("Selecione o resultado da análise.");
  if (outcome === "OPTIMIZATION_PERFORMED" && optimizations.length === 0) {
    fail("Adicione ao menos uma otimização realizada.");
  }
  if (outcome === "ISSUE_IDENTIFIED" && !issueDescription) fail("Descreva o problema identificado.");

  const { data, error } = await supabase.rpc("record_account_review", {
    p_client_id: clientId,
    p_team_member_id: profile.id,
    p_auth_user_id: profile.authUserId,
    p_reason: reason,
    p_reason_other_description: reasonOtherDescription,
    p_outcome: outcome,
    p_notes: notes,
    p_issue_description: issueDescription,
    p_issue_category: issueCategory,
    p_optimizations: optimizations.map((opt) => ({
      type: opt.type,
      action: opt.action,
      description: opt.description || null,
      reason: opt.reason || null,
      expected_impact: opt.expectedImpact || null,
    })),
    p_create_task: outcome === "ISSUE_IDENTIFIED" && createTask,
    p_task_responsible_id: outcome === "ISSUE_IDENTIFIED" && createTask ? taskResponsibleId : null,
    p_task_due_date: outcome === "ISSUE_IDENTIFIED" && createTask ? taskDueDate : null,
    p_source: "web",
  });

  if (error || !data) fail(error?.message ?? "Não foi possível registrar a análise.");

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/sprints");
  redirect(returnTo);
}

/** Configuração de cadência (Etapa 57, seção 25) — admin-only, mesmo padrão
 * de orçamento/KPIs. Nunca cria data fixa de otimização, só a meta de
 * frequência semanal e o intervalo máximo tolerado em dias úteis. */
export async function updateAccountReviewCadenceAction(clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const reviewsPerWeek = Math.max(1, Math.trunc(Number(formData.get("reviews_per_week") ?? 3)) || 3);
  const maxBusinessDays = Math.max(1, Math.trunc(Number(formData.get("max_business_days_without_review") ?? 3)) || 3);
  const isActive = formData.get("is_active") === "on";

  await supabase.from("account_review_cadences").upsert(
    {
      client_id: clientId,
      reviews_per_week: reviewsPerWeek,
      max_business_days_without_review: maxBusinessDays,
      is_active: isActive,
    },
    { onConflict: "client_id" },
  );

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}
