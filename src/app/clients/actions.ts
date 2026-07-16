"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { normalizeCnpj } from "@/lib/cnpj";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { ClientContractStatus, ClientMainObjective, PerformanceGoalDb } from "@/lib/supabase/database.types";

function optionalText(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function optionalNumber(formData: FormData, name: string): number | null {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInt(formData: FormData, name: string): number | null {
  const value = optionalNumber(formData, name);
  return value === null ? null : Math.trunc(value);
}

/** Campos estruturais (Etapa 27) — todos opcionais, lidos e persistidos
 * juntos tanto na criação quanto na edição. Nenhum deles substitui
 * `planned_spend` da sprint, que continua sendo a fonte operacional semanal. */
function readStructuralFields(formData: FormData) {
  return {
    legal_name: optionalText(formData, "legal_name"),
    cnpj: normalizeCnpj(String(formData.get("cnpj") ?? "")) || null,
    status: (String(formData.get("status") ?? "ativo") || "ativo") as ClientContractStatus,
    contract_start_date: optionalText(formData, "contract_start_date"),
    contract_end_date: optionalText(formData, "contract_end_date"),
    renewal_date: optionalText(formData, "renewal_date"),
    primary_manager_id: optionalText(formData, "primary_manager_id"),
    main_contact_name: optionalText(formData, "main_contact_name"),
    main_contact_role: optionalText(formData, "main_contact_role"),
    main_contact_email: optionalText(formData, "main_contact_email"),
    main_contact_phone: optionalText(formData, "main_contact_phone"),
    financial_contact_name: optionalText(formData, "financial_contact_name"),
    financial_contact_email: optionalText(formData, "financial_contact_email"),
    financial_contact_phone: optionalText(formData, "financial_contact_phone"),
    instagram_url: optionalText(formData, "instagram_url"),
    website_url: optionalText(formData, "website_url"),
    facebook_url: optionalText(formData, "facebook_url"),
    commercial_whatsapp: optionalText(formData, "commercial_whatsapp"),
    meta_ad_account_name: optionalText(formData, "meta_ad_account_name"),
    main_objective: optionalText(formData, "main_objective") as ClientMainObjective | null,
    monthly_planned_spend: optionalNumber(formData, "monthly_planned_spend"),
    primary_kpi: optionalText(formData, "primary_kpi"),
    primary_kpi_target: optionalText(formData, "primary_kpi_target"),
    operational_summary: optionalText(formData, "operational_summary"),
    important_notes: optionalText(formData, "important_notes"),
    agency_monthly_fee: optionalNumber(formData, "agency_monthly_fee"),
    billing_due_day: optionalInt(formData, "billing_due_day"),
    contracted_services: formData.getAll("contracted_services").map(String).length
      ? formData.getAll("contracted_services").map(String)
      : null,
    notice_period_days: optionalInt(formData, "notice_period_days"),
    main_product_or_service: optionalText(formData, "main_product_or_service"),
    operation_region: optionalText(formData, "operation_region"),
    primary_audience: optionalText(formData, "primary_audience"),
    client_differentials: optionalText(formData, "client_differentials"),
    client_restrictions: optionalText(formData, "client_restrictions"),
    important_seasonal_dates: optionalText(formData, "important_seasonal_dates"),
    performance_goal: optionalText(formData, "performance_goal") as PerformanceGoalDb | null,
    target_cost_per_result: optionalNumber(formData, "target_cost_per_result"),
  };
}

function readClientFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    meta_ad_account_id: String(formData.get("meta_ad_account_id") ?? "").trim(),
    managerIds: formData.getAll("manager_ids").map(String),
    ...readStructuralFields(formData),
  };
}

function appendSaved(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}saved=1`;
}

// Códigos SQLSTATE que representam uma violação diretamente ligada aos
// campos que o próprio formulário de cliente controla (ex.: formato do
// meta_ad_account_id) — únicos casos em que a mensagem crua do Postgres é
// realmente útil pro gestor corrigir algo no formulário. Qualquer outro
// código (ex.: not_null_violation vindo de uma tarefa gerada automaticamente
// por um trigger, foreign_key_violation, etc.) é uma falha inesperada:
// nunca mostrar a mensagem técnica bruta pro usuário final, só logar.
const CLIENT_FORM_VALIDATION_ERROR_CODES = new Set(["23514", "23505"]); // check_violation, unique_violation

/** Traduz um erro de criação de cliente pra uma mensagem segura de exibir —
 * erros de validação do próprio formulário passam direto; qualquer falha
 * inesperada (ex.: geração automática de sprints/tarefas quebrando por
 * baixo) vira uma mensagem genérica, com o erro técnico completo só no log
 * do servidor. */
function resolveClientCreationErrorMessage(error: { code?: string; message: string } | null): string {
  if (!error) return "Erro ao criar cliente";
  if (error.code && CLIENT_FORM_VALIDATION_ERROR_CODES.has(error.code)) {
    return error.message;
  }
  console.error("[createClientAction] falha inesperada ao criar cliente:", error);
  return "Não foi possível criar o cliente. Tente novamente ou verifique as configurações de tarefas padrão.";
}

export async function createClientAction(formData: FormData) {
  const profile = await requireAdmin();
  const { name, meta_ad_account_id, managerIds, ...structural } = readClientFields(formData);

  // Objetivo de performance é obrigatório só na CRIAÇÃO (Etapa 71, seção 2)
  // — clientes já existentes continuam podendo ficar sem objetivo
  // configurado, então esta validação nunca entra em updateClientAction.
  if (!structural.performance_goal) {
    redirect(`/clients/new?error=${encodeURIComponent("Selecione o objetivo principal de performance")}`);
  }

  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase
    .from("clients")
    .insert({ name, meta_ad_account_id, ...structural })
    .select("id")
    .single();

  if (error || !client) {
    redirect(`/clients/new?error=${encodeURIComponent(resolveClientCreationErrorMessage(error))}`);
  }

  if (managerIds.length > 0) {
    await supabase
      .from("client_managers")
      .insert(managerIds.map((user_id) => ({ client_id: client.id, user_id })));
  }

  const actor = actorFromProfile(profile);
  await recordOperationalEvent(supabase, actor, {
    eventType: OperationalEventType.CLIENT_CREATED,
    entityType: "client",
    entityId: client.id,
    clientId: client.id,
    source: "web",
    metadata: { name },
  });

  if (structural.primary_manager_id) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.CLIENT_MANAGER_ASSIGNED,
      entityType: "client",
      entityId: client.id,
      clientId: client.id,
      source: "web",
      metadata: { role: "primary", manager_team_member_id: structural.primary_manager_id },
    });
  }
  for (const managerId of managerIds) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.CLIENT_MANAGER_ASSIGNED,
      entityType: "client",
      entityId: client.id,
      clientId: client.id,
      source: "web",
      metadata: { role: "support", manager_team_member_id: managerId },
    });
  }

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/settings/clients");
  redirect(`/clients/${client.id}`);
}

export async function updateClientAction(clientId: string, returnTo: string, formData: FormData) {
  const profile = await requireAdmin();
  const { name, meta_ad_account_id, managerIds, ...structural } = readClientFields(formData);
  const supabase = await createSupabaseClient();

  const { data: previous } = await supabase
    .from("clients")
    .select("primary_manager_id")
    .eq("id", clientId)
    .single();
  const { data: previousManagers } = await supabase
    .from("client_managers")
    .select("user_id")
    .eq("client_id", clientId);
  const previousManagerIds = new Set((previousManagers ?? []).map((m) => m.user_id));

  const { error } = await supabase
    .from("clients")
    .update({ name, meta_ad_account_id, ...structural })
    .eq("id", clientId);

  if (error) {
    redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(toUserFacingError(error, "Não foi possível salvar as alterações do cliente."))}`);
  }

  await supabase.from("client_managers").delete().eq("client_id", clientId);

  if (managerIds.length > 0) {
    await supabase
      .from("client_managers")
      .insert(managerIds.map((user_id) => ({ client_id: clientId, user_id })));
  }

  const actor = actorFromProfile(profile);

  if (structural.primary_manager_id !== (previous?.primary_manager_id ?? null)) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.CLIENT_MANAGER_CHANGED,
      entityType: "client",
      entityId: clientId,
      clientId,
      source: "web",
      metadata: {
        role: "primary",
        previous_manager_team_member_id: previous?.primary_manager_id ?? null,
        new_manager_team_member_id: structural.primary_manager_id,
      },
    });
  }

  for (const managerId of managerIds) {
    if (!previousManagerIds.has(managerId)) {
      await recordOperationalEvent(supabase, actor, {
        eventType: OperationalEventType.CLIENT_MANAGER_ASSIGNED,
        entityType: "client",
        entityId: clientId,
        clientId,
        source: "web",
        metadata: { role: "support", manager_team_member_id: managerId },
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/settings/clients");
  revalidatePath(`/clients/${clientId}`);
  redirect(appendSaved(returnTo));
}

export async function deleteClientAction(clientId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) {
    redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(toUserFacingError(error, "Não foi possível excluir o cliente."))}`);
  }

  revalidatePath("/");
  revalidatePath("/painel-mensal");
  revalidatePath("/clients");
  revalidatePath("/settings/clients");
  redirect("/");
}

export async function restoreClientAction(clientId: string) {
  await requireAdmin();
  const supabase = await createSupabaseClient();

  await supabase.from("clients").update({ deleted_at: null }).eq("id", clientId);

  // Platform Continuity System 1.0: sem redirect — `restoreClientAction` já
  // é chamada da própria lista de excluídos; `revalidatePath` sozinho tira
  // o cliente restaurado da lista sem recarregar a página.
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/settings/clients");
  revalidatePath("/settings/deleted-clients");
}
