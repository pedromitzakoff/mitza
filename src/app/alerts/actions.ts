"use server";

import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/lib/auth";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { shiftDays } from "@/lib/date-range";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Aba "Alertas" (pedido do usuário, seção 3): as 2 ações manuais de
 * acompanhamento — "dia a dia", não administrativas, por isso
 * `requireActiveProfile()` (qualquer membro interno ativo), nunca
 * `requireAdmin()` — mesmo critério de amplo acesso interno já usado em
 * `is_client_manager` (ver `supabase/alerts.sql`).
 *
 * Existia uma 3ª ação ("Marcar como revisado", só registrava que alguém
 * tinha olhado, sem mudar status/situação nem pedir observação) — removida
 * a pedido do usuário ("esse revisado pode ser em acompanhamento então"):
 * na prática, qualquer alerta olhado ou vira "Acompanhar amanhã" (ainda
 * incerto, quer reavaliar) ou "Resolver manualmente" (já sabe o que
 * houve) — um 3º estado que não compromete com nada não tinha uso real.
 * `'revisado'` continua um `event_type` válido no banco (linhas antigas,
 * se existirem, continuam legíveis) — só não é mais produzido por nenhuma
 * ação daqui pra frente.
 *
 * Nenhuma das 2 decide a próxima avaliação automática — isso é sempre
 * `reduceAlertEvaluation` (`lib/alerts/alert-persistence.ts`), rodado pelo
 * cron. As 2 ações só gravam a INTENÇÃO do gestor (observação/resolução
 * manual) + o evento correspondente em `alert_events` — a MESMA
 * observação que `alerts-data.ts` busca de volta pra mostrar no card
 * (achado do usuário: "o texto que eu escrevo... onde que eu leio depois?"
 * — antes não aparecia em lugar nenhum).
 */

export interface AlertActionResult {
  error?: string;
  message?: string;
}

async function loadAlertForAction(alertId: string): Promise<{ id: string; status: AlertStatus } | null> {
  const supabase = await createSupabaseClient();
  const rows = await requireQuery(supabase.from("alerts").select("id, status").eq("id", alertId).limit(1), "alerts:load-for-action");
  return rows[0] ?? null;
}

/** "Acompanhar amanhã" — pedido: "permite registrar uma observação e
 * adiar a necessidade de nova revisão até a próxima avaliação do dia
 * completo seguinte." `follow_up_until` é só informativo (a avaliação
 * automática já roda todo dia, nunca gated por este campo — ver
 * `lib/alerts/alert-persistence.ts`). */
export async function followUpAlertTomorrowAction(alertId: string, formData: FormData): Promise<AlertActionResult> {
  const profile = await requireActiveProfile();
  const supabase = await createSupabaseClient();

  const alert = await loadAlertForAction(alertId);
  if (!alert) return { error: "Alerta não encontrado." };
  if (alert.status === "resolvido") return { error: "Este alerta já está resolvido — não há o que acompanhar." };

  const note = String(formData.get("note") ?? "").trim();
  const followUpUntil = shiftDays(todayDateString(), 1);

  const { error: updateError } = await supabase
    .from("alerts")
    .update({ status: "acompanhamento", follow_up_until: followUpUntil })
    .eq("id", alertId);
  if (updateError) return { error: "Não foi possível registrar o acompanhamento." };

  const { error: eventError } = await supabase.from("alert_events").insert({
    alert_id: alertId,
    event_type: "acompanhar",
    from_status: alert.status,
    to_status: "acompanhamento",
    note: note || null,
    follow_up_until: followUpUntil,
    actor_id: profile.id,
  });
  if (eventError) return { error: "Acompanhamento salvo, mas não foi possível registrar o histórico." };

  revalidatePath("/alerts");
  return { message: "Em acompanhamento até a próxima avaliação." };
}

/** "Resolver manualmente" — pedido: "exige uma observação curta e mantém
 * o histórico." Única das 3 ações que exige nota — as outras duas aceitam
 * nota vazia. */
export async function resolveAlertManuallyAction(alertId: string, formData: FormData): Promise<AlertActionResult> {
  const profile = await requireActiveProfile();
  const supabase = await createSupabaseClient();

  const alert = await loadAlertForAction(alertId);
  if (!alert) return { error: "Alerta não encontrado." };
  if (alert.status === "resolvido") return { error: "Este alerta já está resolvido." };

  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Descreva brevemente por que este alerta está sendo resolvido." };

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("alerts")
    .update({ status: "resolvido", resolved_at: nowIso, follow_up_until: null })
    .eq("id", alertId);
  if (updateError) return { error: "Não foi possível resolver o alerta." };

  const { error: eventError } = await supabase.from("alert_events").insert({
    alert_id: alertId,
    event_type: "resolvido_manual",
    from_status: alert.status,
    to_status: "resolvido",
    note,
    actor_id: profile.id,
  });
  if (eventError) return { error: "Alerta resolvido, mas não foi possível registrar o histórico." };

  revalidatePath("/alerts");
  return { message: "Alerta resolvido." };
}
