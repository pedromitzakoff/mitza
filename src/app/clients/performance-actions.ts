"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin, requireClientManagerAccess } from "@/lib/auth";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { PerformanceGoalDb } from "@/lib/supabase/database.types";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { toUserFacingError } from "@/lib/user-facing-error";

function withError(returnTo: string, message: string): string {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`;
}

/**
 * "Atualizar performance" — ação única que substitui os antigos "Editar"
 * (investimento) e "Editar resultados" (por canal): um só submit grava
 * investimento realizado (`sprints.manual_actual_spend`) e o resultado de
 * cada canal presente no formulário (`performance_records`) — nenhuma fonte
 * de verdade nova, só as duas mesmas tabelas de sempre, na mesma transação
 * de UI. Um canal cujo campo ficou em branco é ignorado (nunca zera um
 * resultado que o gestor só não quis tocar agora). CPL/CPA continuam 100%
 * derivados — nenhum campo aqui os aceita diretamente.
 *
 * Permissão: admin ou o gestor responsável por este cliente
 * (`requireClientManagerAccess`) — sem isso o gestor não conseguia
 * registrar a própria execução. RLS (`sprints_update`/`performance_records_write`,
 * ver supabase/manager-write-sprint-performance.sql) aplica exatamente a
 * mesma regra no banco, com um trigger extra travando qualquer coluna de
 * planejamento da sprint (planned_spend/datas/snapshots) — só admin altera
 * isso, mesmo que a checagem daqui seja contornada.
 *
 * `returnTo` (Etapa MVP 1.3) — quem chama decide pra onde volta depois de
 * salvar (página do cliente ou tela Sprints, preservando o contexto de
 * onde a edição começou) — nunca mais um redirect fixo pra `/clients/{id}`.
 */
export async function updateSprintPerformanceAction(
  sprintId: string,
  clientId: string,
  returnTo: string,
  formData: FormData,
) {
  await requireClientManagerAccess(clientId);

  const actualSpend = Number(formData.get("actual_spend"));
  if (!Number.isFinite(actualSpend) || actualSpend < 0) {
    redirect(withError(returnTo, "Valor de investimento inválido"));
  }

  const channelEntries: { channel: TrafficChannel; resultCount: number }[] = [];
  for (const channel of AVAILABLE_TRAFFIC_CHANNELS) {
    const raw = String(formData.get(`result_${channel}`) ?? "").trim();
    if (!raw) continue; // em branco = não alterar este canal agora

    const resultCount = Number(raw);
    if (!Number.isFinite(resultCount) || resultCount < 0 || !Number.isInteger(resultCount)) {
      redirect(withError(returnTo, "Resultado inválido — informe um número inteiro maior ou igual a zero"));
    }
    channelEntries.push({ channel, resultCount });
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
    redirect(withError(returnTo, "Sprint não encontrada"));
  }

  const nowIso = new Date().toISOString();

  const { error: spendError } = await supabase
    .from("sprints")
    .update({ spend_source: "manual", manual_actual_spend: actualSpend, manual_spend_updated_at: nowIso })
    .eq("id", sprintId);

  if (spendError) {
    redirect(withError(returnTo, toUserFacingError(spendError, "Não foi possível salvar o investimento.")));
  }

  if (channelEntries.length > 0) {
    const { data: client } = await supabase.from("clients").select("performance_goal").eq("id", clientId).single();

    if (!client?.performance_goal) {
      redirect(withError(returnTo, "Configure o objetivo de performance do cliente antes de lançar resultados"));
    }

    const { error: perfError } = await supabase.from("performance_records").upsert(
      channelEntries.map(({ channel, resultCount }) => ({
        client_id: clientId,
        sprint_id: sprintId,
        channel,
        result_type: client!.performance_goal as PerformanceGoalDb,
        result_count: resultCount,
        period_start: sprint!.start_date,
        period_end: sprint!.end_date,
        source: "manual",
        source_updated_at: nowIso,
      })),
      { onConflict: "client_id,sprint_id,channel,result_type" },
    );

    if (perfError) {
      redirect(withError(returnTo, toUserFacingError(perfError, "Não foi possível salvar os resultados.")));
    }
  }

  // Platform Continuity System 1.0: sem redirect no sucesso — ver
  // justificativa em `resetSprintSpendSourceAction` (mesmo padrão).
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Etapa "Refinamento de Densidade, Hierarquia e Contexto Operacional" (Parte
 * 3) — edição inline do objetivo de performance direto na Sprint, sem
 * navegar até `/clients/{id}/edit`. Mesma coluna (`clients.performance_goal`)
 * já usada pelo formulário de edição do cliente — nenhum campo novo, nenhuma
 * segunda fonte de verdade. Mesma permissão de sempre (só admin, igual ao
 * resto de `client-form.tsx`/`updateClientAction`) — esta etapa não amplia
 * quem pode editar, só onde a edição pode ser feita. Sem redirect no
 * sucesso/erro (Platform Continuity System 1.0): quem chama decide o
 * feedback (toast) e a UI local decide se fecha o popover.
 */
export async function updateClientPerformanceGoalAction(
  clientId: string,
  goal: PerformanceGoal,
): Promise<{ error?: string }> {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({ performance_goal: goal as PerformanceGoalDb })
    .eq("id", clientId);

  if (error) {
    return { error: toUserFacingError(error, "Não foi possível atualizar o objetivo de performance.") };
  }

  // Visão Geral, Sprints, Relatórios e a página do próprio cliente precisam
  // refletir o novo objetivo (Parte 3 do pedido) — Relatórios não exibe o
  // objetivo diretamente hoje, mas é revalidado por segurança/futuro mesmo
  // assim, já que consome dados do mesmo cliente.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/sprints");
  revalidatePath("/reports");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/reports/${clientId}`);

  return {};
}
