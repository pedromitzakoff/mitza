"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { buildClientUpdateText } from "@/lib/client-updates";

/** Janela de coalescência pra CLIENT_UPDATE_EDITED (seção 12 do pedido) — o
 * autosave já é debounced no cliente (500-1000ms), mas uma sessão inteira de
 * edição ainda dispararia um evento por pausa na digitação. Só grava um novo
 * evento se o último (gerado ou editado) desta atualização tem mais do que
 * esta janela — o conteúdo em si é sempre salvo, a cada chamada; só o
 * evento é coalescido. Não é um sistema de versionamento, só deduplicação
 * razoável, como pedido.
 */
const EDIT_EVENT_DEDUP_MS = 2 * 60 * 1000;

function buildRedirectWithError(href: string, param: string, message: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(message)}`;
}

/**
 * Gera a Atualização para o Cliente a partir de uma análise já registrada
 * (seção 5 do pedido) — busca a análise + otimizações direto do banco
 * (nunca confia em dados vindos do formulário), monta o texto só com
 * `buildClientUpdateText` (nenhuma IA, seção 2) e grava. Idempotente: se já
 * existir uma atualização para esta análise, não cria outra — só reabre a
 * existente (seção 11).
 */
export async function generateClientUpdateAction(reviewId: string, closeHref: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(buildRedirectWithError(closeHref, "clientUpdateError", "Sessão expirada, faça login de novo"));

  const supabase = await createSupabaseClient();

  const { data: existing } = await supabase
    .from("client_updates")
    .select("id")
    .eq("account_review_id", reviewId)
    .maybeSingle();

  if (existing) {
    // Platform Continuity System 1.0: sem redirect — o drawer que chamou
    // esta action já troca sozinho pro editor de texto assim que
    // `review.clientUpdate` deixa de ser nulo (revalidatePath abaixo cuida
    // disso), sem precisar fechar e reabrir.
    return;
  }

  const { data: review, error: reviewError } = await supabase
    .from("account_reviews")
    .select(
      "id, client_id, outcome, notes, issue_description, optimizations:account_optimizations(optimization_type, optimization_action, description, reason)",
    )
    .eq("id", reviewId)
    .single();

  if (reviewError || !review) {
    redirect(buildRedirectWithError(closeHref, "clientUpdateError", "Análise não encontrada."));
  }

  const content = buildClientUpdateText({
    outcome: review.outcome,
    notes: review.notes,
    issueDescription: review.issue_description,
    optimizations: review.optimizations.map((opt) => ({
      type: opt.optimization_type,
      action: opt.optimization_action,
      description: opt.description,
      reason: opt.reason,
    })),
  });

  const { data: inserted, error: insertError } = await supabase
    .from("client_updates")
    .insert({
      organization_id: profile.organizationId,
      client_id: review.client_id,
      account_review_id: reviewId,
      created_by: profile.id,
      content,
      generation_method: "template",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    redirect(buildRedirectWithError(closeHref, "clientUpdateError", "Não foi possível gerar a atualização."));
  }

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.CLIENT_UPDATE_GENERATED,
    entityType: "client_update",
    entityId: inserted.id,
    clientId: review.client_id,
    source: "web",
    metadata: { account_review_id: reviewId, generation_method: "template" },
  });

  // Platform Continuity System 1.0: sem redirect — o drawer permanece
  // aberto e passa a mostrar o texto recém-gerado (ClientUpdateEditor) no
  // lugar do botão "Gerar atualização", assim que os dados revalidarem.
  revalidatePath(`/clients/${review.client_id}`);
}

/**
 * Autosave do texto editável (seção 8) — chamada diretamente pelo
 * componente cliente (sem `<form>`/redirect), debounced lá. Nunca exige
 * botão "Salvar"; retorna o resultado pro componente mostrar
 * "Salvando.../Salvo/Erro ao salvar".
 */
export async function updateClientUpdateContentAction(
  clientUpdateId: string,
  clientId: string,
  content: string,
): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sessão expirada, faça login de novo." };

  const supabase = await createSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("client_updates")
    .update({ content, updated_at: now })
    .eq("id", clientUpdateId);

  if (error) return { ok: false, error: "Não foi possível salvar." };

  const { data: lastEvent } = await supabase
    .from("operational_events")
    .select("occurred_at")
    .eq("entity_type", "client_update")
    .eq("entity_id", clientUpdateId)
    .in("event_type", [OperationalEventType.CLIENT_UPDATE_GENERATED, OperationalEventType.CLIENT_UPDATE_EDITED])
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const withinDedupWindow =
    lastEvent && Date.now() - new Date(lastEvent.occurred_at).getTime() < EDIT_EVENT_DEDUP_MS;

  if (!withinDedupWindow) {
    await recordOperationalEvent(supabase, actorFromProfile(profile), {
      eventType: OperationalEventType.CLIENT_UPDATE_EDITED,
      entityType: "client_update",
      entityId: clientUpdateId,
      clientId,
      source: "web",
      metadata: {},
    });
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, updatedAt: now };
}

/** "Copiar texto" (seção 9) — o clipboard em si acontece no navegador
 * (client component); esta action só registra data/hora/usuário/evento. */
export async function copyClientUpdateAction(
  clientUpdateId: string,
  clientId: string,
): Promise<{ ok: boolean; copiedAt?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false };

  const supabase = await createSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("client_updates")
    .update({ copied_at: now, copied_by: profile.id })
    .eq("id", clientUpdateId);

  if (error) return { ok: false };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.CLIENT_UPDATE_COPIED,
    entityType: "client_update",
    entityId: clientUpdateId,
    clientId,
    source: "web",
    metadata: {},
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, copiedAt: now };
}

/** "Marcar como enviada" (seção 10) — confirmação compacta já acontece no
 * componente cliente antes de chamar esta action. */
export async function markClientUpdateSentAction(
  clientUpdateId: string,
  clientId: string,
): Promise<{ ok: boolean; sentAt?: string; sentByName?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false };

  const supabase = await createSupabaseClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("client_updates")
    .update({ sent_at: now, sent_by: profile.id })
    .eq("id", clientUpdateId);

  if (error) return { ok: false };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.CLIENT_UPDATE_MARKED_SENT,
    entityType: "client_update",
    entityId: clientUpdateId,
    clientId,
    source: "web",
    metadata: {},
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true, sentAt: now, sentByName: profile.name };
}

/** "Marcar como não enviada" (seção 10) — só através do menu contextual,
 * depois que já foi marcada como enviada. */
export async function markClientUpdateUnsentAction(
  clientUpdateId: string,
  clientId: string,
): Promise<{ ok: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false };

  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("client_updates")
    .update({ sent_at: null, sent_by: null })
    .eq("id", clientUpdateId);

  if (error) return { ok: false };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.CLIENT_UPDATE_MARKED_UNSENT,
    entityType: "client_update",
    entityId: clientUpdateId,
    clientId,
    source: "web",
    metadata: {},
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
