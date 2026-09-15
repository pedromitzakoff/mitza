"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin, requireClientManagerAccess } from "@/lib/auth";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { ClientContractStatus, PerformanceGoalDb } from "@/lib/supabase/database.types";

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

/**
 * MITZA 2.0 — Refinamento da Identidade do Cliente: sobe a foto (campo
 * "photo" do formulário, opcional) pro bucket público `client-photos`
 * (ver supabase/client-identity.sql), sempre no mesmo caminho por cliente
 * (`upsert: true` — substitui a anterior). `?v=timestamp` na URL salva é
 * cache-busting: sem isso, trocar a foto no mesmo caminho poderia
 * continuar servindo a versão antiga em cache do navegador/CDN. Retorna
 * `{}` quando nenhum arquivo foi enviado (edição sem trocar a foto) — quem
 * chama nunca sobrescreve `avatar_url` nesse caso. Falha de upload nunca
 * derruba a criação/edição do cliente inteira, só fica sem a foto nova.
 */
async function uploadClientPhotoIfProvided(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  clientId: string,
  formData: FormData,
): Promise<{ avatarUrl?: string; error?: string }> {
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return {};

  const ext = photo.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${clientId}/photo.${ext}`;
  const { error } = await supabase.storage
    .from("client-photos")
    .upload(path, photo, { upsert: true, contentType: photo.type || undefined });

  if (error) {
    return { error: error.message };
  }

  const { data } = supabase.storage.from("client-photos").getPublicUrl(path);
  return { avatarUrl: `${data.publicUrl}?v=${Date.now()}` };
}

/**
 * Campos estruturais (Etapa 27, reduzida na Etapa "Simplificação do Cadastro
 * do Cliente") — lidos e persistidos juntos tanto na criação quanto na
 * edição. Nenhum deles substitui `planned_spend` da sprint, que continua
 * sendo a fonte operacional semanal.
 *
 * Etapa "Simplificação do Cadastro do Cliente": esta função só lê o que o
 * `ClientForm` simplificado ainda envia — CRÍTICO nunca ler um campo que
 * saiu do formulário e ainda assim incluí-lo aqui: `updateClientAction`
 * salva `{...structural}` inteiro a cada edição, então uma chave presente
 * neste objeto sempre SOBRESCREVE a coluna correspondente (com `null`
 * quando o campo não existe mais no FormData) — apagaria silenciosamente
 * dado histórico de clientes já cadastrados a cada salvamento. Os campos
 * removidos do formulário (`legal_name`, `cnpj`, datas de contrato,
 * contatos, comercial, `contracted_services`, contexto estratégico,
 * `main_objective`, `monthly_planned_spend`, `primary_kpi`/`_target`,
 * `meta_ad_account_name`, links sociais) continuam existindo no banco —
 * só pararam de ser lidos/reescritos por aqui. `cnpj`/`contract_start_date`/
 * `main_contact_email`/`agency_monthly_fee` continuam editáveis em
 * Settings > Clientes (`app/settings/clients/actions.ts`), que já era o
 * lugar canônico pra eles.
 */
function readStructuralFields(formData: FormData) {
  return {
    status: (String(formData.get("status") ?? "ativo") || "ativo") as ClientContractStatus,
    primary_manager_id: optionalText(formData, "primary_manager_id"),
    dashboard_url: optionalText(formData, "dashboard_url"),
    balance_url: optionalText(formData, "balance_url"),
    monthly_closing_sheet_url: optionalText(formData, "monthly_closing_sheet_url"),
    // Etapa "Canais Ativos por Cliente": fonte única de verdade de "em quais
    // plataformas este cliente investe" — controla o seletor de canal da
    // Visão Geral (ver lib/traffic-channels.ts). Validado como "pelo menos 1"
    // em createClientAction/updateClientAction, nunca aqui (esta função só
    // lê o formulário, nunca decide se o valor é aceitável).
    media_channels: formData.getAll("media_channels").map(String),
    performance_goal: optionalText(formData, "performance_goal") as PerformanceGoalDb | null,
    // Meta/fallback de custo-alvo (canal → consolidado → este campo,
    // `resolveTargetCostPerResult`, lib/client-plan.ts — regra intocada) —
    // vive na área "Configuração avançada" do formulário, nunca removida,
    // só com menos peso visual.
    target_cost_per_result: optionalNumber(formData, "target_cost_per_result"),
  };
}

function readClientFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    // Etapa "Simplificação do Cadastro do Cliente": conta Meta deixou de
    // ser obrigatória pra todo cliente (constraint relaxada em
    // `client-meta-account-optional.sql`) — cliente Google-only
    // (`media_channels` sem "meta") não precisa mais preencher isso.
    // `optionalText` converte string vazia em `null`, nunca `""` (que
    // quebraria o check de formato `act_\d+` no banco). Obrigatoriedade
    // CONDICIONAL ("meta em media_channels -> precisa ter conta") é
    // validada logo abaixo, em `createClientAction`/`updateClientAction`.
    meta_ad_account_id: optionalText(formData, "meta_ad_account_id"),
    ...readStructuralFields(formData),
  };
}

/** Etapa "Simplificação do Cadastro do Cliente": única regra de "quando a
 * conta Meta é obrigatória" — reaproveitada por `createClientAction` e
 * `updateClientAction`, nunca duplicada. Meta só é exigida quando o cliente
 * de fato opera esse canal (`media_channels` inclui "meta"); um cliente
 * Google-only nunca precisa preencher isso. */
function validateMetaAccountRequirement(mediaChannels: string[], metaAdAccountId: string | null): string | null {
  if (mediaChannels.includes("meta") && !metaAdAccountId) {
    return "Informe a conta de anúncios do Meta (obrigatória enquanto Meta Ads estiver marcado em Canais de mídia)";
  }
  return null;
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
  const { name, meta_ad_account_id, ...structural } = readClientFields(formData);

  // Objetivo de performance é obrigatório só na CRIAÇÃO (Etapa 71, seção 2)
  // — clientes já existentes continuam podendo ficar sem objetivo
  // configurado, então esta validação nunca entra em updateClientAction.
  if (!structural.performance_goal) {
    redirect(`/clients/new?error=${encodeURIComponent("Selecione o objetivo principal de performance")}`);
  }

  // Etapa "Canais Ativos por Cliente": pelo menos 1 canal é obrigatório
  // (aqui E em updateClientAction, nunca só na criação — diferente do
  // objetivo de performance acima) — sem nenhum canal ativo não haveria
  // opção nenhuma pro seletor da Visão Geral mostrar.
  if (structural.media_channels.length === 0) {
    redirect(`/clients/new?error=${encodeURIComponent("Selecione pelo menos um canal de mídia")}`);
  }

  const metaAccountError = validateMetaAccountRequirement(structural.media_channels, meta_ad_account_id);
  if (metaAccountError) {
    redirect(`/clients/new?error=${encodeURIComponent(metaAccountError)}`);
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

  // MITZA 2.0 — Refinamento da Identidade do Cliente: a foto só pode subir
  // depois do insert (o caminho no Storage é `${clientId}/photo.ext`) —
  // por isso é sempre um update separado, nunca no mesmo insert acima.
  const photoResult = await uploadClientPhotoIfProvided(supabase, client.id, formData);
  if (photoResult.avatarUrl) {
    await supabase.from("clients").update({ avatar_url: photoResult.avatarUrl }).eq("id", client.id);
  } else if (photoResult.error) {
    console.error("[createClientAction] falha ao salvar foto do cliente:", photoResult.error);
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

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/settings/clients");
  redirect(`/clients/${client.id}`);
}

/** Next.js sinaliza `redirect()`/`notFound()` lançando um erro especial com
 * `digest` prefixado assim — precisa ser relançado sem tocar, senão o
 * catch-all de `updateClientAction` intercepta a navegação esperada e a
 * transforma num "erro inesperado". */
function isNextControlFlowError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    /^NEXT_(REDIRECT|NOT_FOUND)/.test((error as { digest: string }).digest)
  );
}

export async function updateClientAction(clientId: string, returnTo: string, formData: FormData) {
  // Habilitar Gestores 3.0: editar o Cadastro do Cliente deixou de ser
  // admin-only — qualquer usuário interno autorizado da KOFF também pode
  // (Etapa "Correção do Modelo de Autorização — Acesso Amplo Interno":
  // `requireClientManagerAccess` não exige mais ser o GESTOR PRINCIPAL
  // deste cliente específico — ver `lib/auth.ts`). "Gestor de apoio"
  // (`client_managers`) continua fora da decisão — nem nunca precisou
  // voltar, já que qualquer membro interno ativo está autorizado.
  // `createClientAction`/`deleteClientAction` continuam admin-only
  // (criar/excluir cliente é mais estrutural, fora do pedido).
  const profile = await requireClientManagerAccess(clientId);
  const { name, meta_ad_account_id, ...structural } = readClientFields(formData);

  if (structural.media_channels.length === 0) {
    redirect(`/clients/${clientId}/edit?error=${encodeURIComponent("Selecione pelo menos um canal de mídia")}`);
  }

  const metaAccountError = validateMetaAccountRequirement(structural.media_channels, meta_ad_account_id);
  if (metaAccountError) {
    redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(metaAccountError)}`);
  }

  const supabase = await createSupabaseClient();

  // Ponto real de crash em produção pra um gestor não-admin (visto em
  // 22/07): sem este catch, qualquer falha inesperada aqui virava uma
  // tela de erro genérica em vez de voltar pro Cadastro com uma mensagem —
  // e o log real do servidor ficava sem contexto nenhum de qual ação
  // falhou.
  try {
    const { data: previous } = await supabase
      .from("clients")
      .select("primary_manager_id")
      .eq("id", clientId)
      .single();

    const photoResult = await uploadClientPhotoIfProvided(supabase, clientId, formData);
    if (photoResult.error) {
      console.error("[updateClientAction] falha ao salvar foto do cliente:", photoResult.error);
    }

    const { error } = await supabase
      .from("clients")
      .update({
        name,
        meta_ad_account_id,
        ...structural,
        ...(photoResult.avatarUrl ? { avatar_url: photoResult.avatarUrl } : {}),
      })
      .eq("id", clientId);

    if (error) {
      redirect(`/clients/${clientId}/edit?error=${encodeURIComponent(toUserFacingError(error, "Não foi possível salvar as alterações do cliente."))}`);
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
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error("[updateClientAction] falha inesperada ao salvar cliente:", error);
    redirect(
      `/clients/${clientId}/edit?error=${encodeURIComponent("Não foi possível salvar as alterações. Tente novamente ou avise o time responsável.")}`,
    );
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
