"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin, requireClientManagerAccess } from "@/lib/auth";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { GoalResultSourceDb, PerformanceGoalDb } from "@/lib/supabase/database.types";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { toUserFacingError } from "@/lib/user-facing-error";

/**
 * Server actions de "Objetivos da conta" (Etapa "Múltiplos Objetivos") —
 * config de identidade (`client_goals`) e meta mensal de objetivos
 * SECUNDÁRIOS (`set_goal_monthly_target`, nunca toca `sprint_planned_allocations`
 * — ver comentário em `supabase/client-goals.sql`). O objetivo PRINCIPAL
 * continua sendo editado pelo fluxo de sempre (`channel-plan-editor.tsx` /
 * `apply_monthly_channel_plan_change`, agora também gravando `result_type`).
 *
 * Permissão: admin (mesma regra de RLS de `client_goals`/
 * `client_campaign_goal_assignments` — só admin escreve, gestor só lê).
 */

function withError(returnTo: string, message: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

function parseChannels(formData: FormData): TrafficChannel[] {
  const raw = formData.getAll("channels").map(String);
  return raw.filter((c): c is TrafficChannel => (AVAILABLE_TRAFFIC_CHANNELS as string[]).includes(c));
}

function parseResultType(value: FormDataEntryValue | null): PerformanceGoal | null {
  const raw = String(value ?? "");
  return raw === "leads" || raw === "sales" || raw === "followers" ? raw : null;
}

export async function createClientGoalAction(clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();

  const resultType = parseResultType(formData.get("result_type"));
  if (!resultType) redirect(withError(returnTo, "Selecione um tipo de objetivo válido"));

  const resultSource = (String(formData.get("result_source") ?? "automatic") === "manual" ? "manual" : "automatic") as GoalResultSourceDb;
  const channels = parseChannels(formData);

  const supabase = await createSupabaseClient();

  const { data: existingGoals, error: existingError } = await supabase.from("client_goals").select("id").eq("client_id", clientId);
  if (existingError) redirect(withError(returnTo, toUserFacingError(existingError, "Não foi possível verificar os objetivos existentes.")));

  const { error } = await supabase.from("client_goals").insert({
    client_id: clientId,
    result_type: resultType as PerformanceGoalDb,
    channels,
    result_source: resultSource,
    // Primeiro objetivo do cliente nasce principal automaticamente (nunca
    // fica sem nenhum principal); a partir do segundo, o admin escolhe
    // explicitamente via `setClientGoalPrimaryAction`.
    is_primary: (existingGoals ?? []).length === 0,
  });

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível criar o objetivo — talvez ele já exista para este cliente.")));

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}

export async function updateClientGoalAction(goalId: string, clientId: string, returnTo: string, formData: FormData) {
  await requireAdmin();

  const resultSource = (String(formData.get("result_source") ?? "automatic") === "manual" ? "manual" : "automatic") as GoalResultSourceDb;
  const channels = parseChannels(formData);

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("client_goals")
    .update({ result_source: resultSource, channels })
    .eq("id", goalId)
    .eq("client_id", clientId);

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível atualizar o objetivo.")));

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}

export async function setClientGoalPrimaryAction(goalId: string, clientId: string, returnTo: string) {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("set_client_goal_primary", { p_client_id: clientId, p_goal_id: goalId });

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível definir o objetivo principal.")));

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}

/** Remove um objetivo secundário — nunca o principal (o cliente sempre
 * precisa ter um; trocar o principal antes é obrigatório). Não apaga
 * histórico: `monthly_budget_changes`/`performance_records`/`daily_performance`
 * já lançados continuam intactos, só o vínculo campanha→objetivo
 * (`client_campaign_goal_assignments`) é removido em cascata (FK
 * `on delete cascade`, ver client-goals.sql). */
export async function deleteClientGoalAction(goalId: string, clientId: string, returnTo: string) {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { data: goal, error: fetchError } = await supabase.from("client_goals").select("is_primary").eq("id", goalId).single();
  if (fetchError || !goal) redirect(withError(returnTo, "Objetivo não encontrado."));
  if (goal.is_primary) redirect(withError(returnTo, "Não é possível remover o objetivo principal — defina outro como principal antes."));

  const { error } = await supabase.from("client_goals").delete().eq("id", goalId).eq("client_id", clientId);
  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível remover o objetivo.")));

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}

/** Meta mensal de quantidade de um objetivo SECUNDÁRIO — nunca o principal
 * (esse continua por `channel-plan-editor.tsx`). Rejeita explicitamente se
 * `resultType` for o objetivo principal do cliente (mesma trava de
 * `set_goal_monthly_target` no banco — validada duas vezes, nunca só na
 * aplicação). */
export async function setGoalMonthlyTargetAction(clientId: string, returnTo: string, formData: FormData) {
  const profile = await requireAdmin();

  const resultType = parseResultType(formData.get("result_type"));
  const channel = String(formData.get("channel") ?? "");
  const month = String(formData.get("month") ?? "");
  const targetRaw = String(formData.get("target_result_count") ?? "").trim();
  const target = Number(targetRaw);

  if (!resultType) redirect(withError(returnTo, "Selecione um objetivo válido"));
  if (!(AVAILABLE_TRAFFIC_CHANNELS as string[]).includes(channel)) redirect(withError(returnTo, "Canal inválido"));
  if (!month) redirect(withError(returnTo, "Mês inválido"));
  if (!targetRaw || !Number.isFinite(target) || target < 0) redirect(withError(returnTo, "Meta inválida — informe um número maior ou igual a zero"));

  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("set_goal_monthly_target", {
    p_client_id: clientId,
    p_channel: channel,
    p_month: month,
    p_result_type: resultType,
    p_target_result_count: target,
    p_changed_by: profile.id,
  });

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível salvar a meta deste objetivo.")));

  revalidatePath(`/clients/${clientId}/edit`);
  revalidatePath(`/clients/${clientId}`);
  redirect(returnTo);
}

/**
 * Resultado manual por objetivo, preso a UMA SPRINT (Etapa "Múltiplos
 * Objetivos", seção 12) — reaproveita `performance_records` exatamente como
 * `updateSprintPerformanceAction` já faz pro objetivo principal, nunca uma
 * tabela nova nem um segundo formato de linha. Deliberadamente por sprint,
 * não por período livre: TODA leitura de `performance_records` hoje
 * (`getPerformanceRecordsForPeriod`, `resolvePerformanceRowsForSprints`,
 * Conquistas, Saúde) filtra por `sprint_id` pertencente ao período — uma
 * linha com `sprint_id = null` simplesmente não apareceria em nenhuma
 * dessas leituras. Usar sprint como unidade do lançamento manual (em vez de
 * inventar `period_start`/`period_end` livres) é o que garante que o
 * resultado de Seguidores entra no mesmo pipeline de leitura que já existe,
 * sem duplicar lógica.
 */
export async function recordManualGoalResultAction(clientId: string, returnTo: string, formData: FormData) {
  const profile = await requireClientManagerAccess(clientId);

  const sprintId = String(formData.get("sprint_id") ?? "");
  const resultType = parseResultType(formData.get("result_type"));
  const channel = String(formData.get("channel") ?? "meta");
  const resultCountRaw = String(formData.get("result_count") ?? "").trim();
  const resultCount = Number(resultCountRaw);

  if (!sprintId) redirect(withError(returnTo, "Selecione uma sprint"));
  if (!resultType) redirect(withError(returnTo, "Selecione um objetivo válido"));
  if (!(AVAILABLE_TRAFFIC_CHANNELS as string[]).includes(channel)) redirect(withError(returnTo, "Canal inválido"));
  if (!resultCountRaw || !Number.isFinite(resultCount) || resultCount < 0 || !Number.isInteger(resultCount)) {
    redirect(withError(returnTo, "Resultado inválido — informe um número inteiro maior ou igual a zero"));
  }

  const supabase = await createSupabaseClient();
  const { data: sprint } = await supabase.from("sprints").select("id, client_id, start_date, end_date").eq("id", sprintId).single();
  if (!sprint || sprint.client_id !== clientId) redirect(withError(returnTo, "Sprint não encontrada"));

  const { error } = await supabase.from("performance_records").upsert(
    {
      client_id: clientId,
      sprint_id: sprintId,
      channel: channel as TrafficChannel,
      result_type: resultType as PerformanceGoalDb,
      result_count: resultCount,
      period_start: sprint!.start_date,
      period_end: sprint!.end_date,
      source: "manual",
      source_updated_at: new Date().toISOString(),
      created_by: profile.id,
    },
    { onConflict: "client_id,sprint_id,channel,result_type" },
  );

  if (error) redirect(withError(returnTo, toUserFacingError(error, "Não foi possível registrar o resultado.")));

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/edit`);
  redirect(returnTo);
}
