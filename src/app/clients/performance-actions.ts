"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { PerformanceGoalDb } from "@/lib/supabase/database.types";

/**
 * Lança/atualiza (upsert) o resultado de UM canal de UMA sprint — a
 * estratégia de entrada manual é sempre por sprint (Etapa 71, seção 22);
 * consolidado mensal é sempre soma das sprints do mês, nunca lançamento
 * independente, pra nunca contar em dobro. Mesma autorização de
 * `updateSprintActualSpendAction` (admin) — "quem edita gasto real edita
 * resultados" (Etapa 71, seção 20), nenhuma permissão nova é criada.
 *
 * `result_type` vem do `performance_goal` ATUAL do cliente no momento do
 * lançamento — nunca um campo editável separado, e o valor gravado fica
 * imutável dali em diante (histórico nunca é reescrito se o objetivo do
 * cliente mudar depois).
 */
export async function upsertSprintPerformanceResultAction(
  sprintId: string,
  clientId: string,
  formData: FormData,
) {
  await requireAdmin();

  const channel = String(formData.get("channel") ?? "");
  if (!AVAILABLE_TRAFFIC_CHANNELS.includes(channel as TrafficChannel)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Canal inválido")}`);
  }

  const resultCountRaw = String(formData.get("result_count") ?? "").trim();
  const resultCount = Number(resultCountRaw);
  if (!Number.isFinite(resultCount) || resultCount < 0 || !Number.isInteger(resultCount)) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Resultado inválido — informe um número inteiro maior ou igual a zero")}`);
  }

  const supabase = await createSupabaseClient();

  // Nunca confia em client_id vindo só do formulário — confirma
  // server-side que a sprint pertence de fato ao cliente da URL.
  const { data: sprint } = await supabase
    .from("sprints")
    .select("id, client_id, start_date, end_date")
    .eq("id", sprintId)
    .single();

  if (!sprint || sprint.client_id !== clientId) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent("Sprint não encontrada")}`);
  }

  const { data: client } = await supabase
    .from("clients")
    .select("performance_goal")
    .eq("id", clientId)
    .single();

  if (!client?.performance_goal) {
    redirect(
      `/clients/${clientId}?error=${encodeURIComponent("Configure o objetivo de performance do cliente antes de lançar resultados")}`,
    );
  }

  const { error } = await supabase.from("performance_records").upsert(
    {
      client_id: clientId,
      sprint_id: sprintId,
      channel: channel as TrafficChannel,
      result_type: client!.performance_goal as PerformanceGoalDb,
      result_count: resultCount,
      period_start: sprint!.start_date,
      period_end: sprint!.end_date,
      source: "manual",
      source_updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,sprint_id,channel,result_type" },
  );

  if (error) {
    redirect(`/clients/${clientId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}`);
}
