"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/validation";
import { normalizeTeamMemberEmail } from "@/lib/team-members";
import { OperationalEventType } from "@/lib/operational-events";
import { actorFromProfile, recordOperationalEvent } from "@/lib/record-operational-event";
import { toUserFacingError } from "@/lib/user-facing-error";
import type { TeamSystemRole } from "@/lib/supabase/database.types";

/**
 * Todas as operações administrativas de Supabase Auth (convidar, localizar
 * usuário existente, bloquear acesso) rodam SÓ aqui — Server Actions, nunca
 * no navegador — usando `createAdminClient()` (service_role). A service_role
 * key nunca é passada pro cliente: estas funções sempre retornam só um
 * redirect com uma mensagem curta (?error=...), nunca o objeto de erro cru
 * do Supabase nem qualquer detalhe da conta do usuário (seção 9/10/21 do
 * pedido).
 */

function revalidateTeam() {
  revalidatePath("/team");
}

/** Volta pro drawer de edição de onde a ação partiu (`editId`), em vez de
 * sempre fechar tudo e voltar pra lista — Interaction Design System 1.0,
 * princípio "não fechar elementos desnecessariamente após salvar". Ações
 * disparadas do menu rápido da tabela (sem drawer aberto) não passam
 * `editId`, então continuam fechando pra lista como sempre. */
function failure(message: string, editId?: string): never {
  const params = new URLSearchParams({ error: message });
  if (editId) params.set("edit", editId);
  redirect(`/team?${params.toString()}`);
}

function success(message: string, editId?: string): never {
  const params = new URLSearchParams({ saved: message });
  if (editId) params.set("edit", editId);
  redirect(`/team?${params.toString()}`);
}

const SYSTEM_ROLES: TeamSystemRole[] = ["admin", "gestor"];

export async function createTeamMemberAction(formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeTeamMemberEmail(String(formData.get("email") ?? ""));
  const jobTitle = String(formData.get("job_title") ?? "").trim() || null;
  const systemRole = String(formData.get("system_role") ?? "gestor") as TeamSystemRole;
  const grantAccessNow = formData.get("grant_access_now") === "on";

  if (!name) failure("Informe o nome do membro.");
  if (!email || !isValidEmail(email)) failure("Informe um e-mail válido.");
  if (!SYSTEM_ROLES.includes(systemRole)) failure("Papel no sistema inválido.");

  const { data: existing } = await supabase
    .from("team_members")
    .select("id, status")
    .eq("organization_id", profile.organizationId)
    .ilike("email", email)
    .maybeSingle();

  if (existing?.status === "ativo") failure("Já existe um membro ativo com este e-mail.");
  if (existing?.status === "inativo") {
    failure('Já existe um membro inativo com este e-mail — use "Reativar" na lista em vez de criar outro.');
  }

  const { data: member, error } = await supabase
    .from("team_members")
    .insert({
      organization_id: profile.organizationId,
      name,
      email,
      job_title: jobTitle,
      system_role: systemRole,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !member) failure("Não foi possível criar o membro.");

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_CREATED,
    entityType: "team_member",
    entityId: member.id,
    source: "web",
    metadata: { name, job_title: jobTitle, system_role: systemRole },
  });

  revalidateTeam();

  if (grantAccessNow) {
    const inviteResult = await inviteTeamMemberCore(member.id);
    if (inviteResult.error) failure(inviteResult.error);
    return;
  }

  success(`${name} foi adicionado à equipe.`);
}

export async function updateTeamMemberAction(memberId: string, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const name = String(formData.get("name") ?? "").trim();
  const jobTitle = String(formData.get("job_title") ?? "").trim() || null;
  const systemRole = String(formData.get("system_role") ?? "gestor") as TeamSystemRole;

  if (!name) failure("Informe o nome do membro.", memberId);
  if (!SYSTEM_ROLES.includes(systemRole)) failure("Papel no sistema inválido.", memberId);

  const { error } = await supabase
    .from("team_members")
    .update({ name, job_title: jobTitle, system_role: systemRole })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) failure("Não foi possível salvar as alterações.", memberId);

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_UPDATED,
    entityType: "team_member",
    entityId: memberId,
    source: "web",
    metadata: { name, job_title: jobTitle, system_role: systemRole },
  });

  // Platform Continuity System 1.0: sem redirect — o drawer já estava
  // aberto neste mesmo membro antes do submit; sem navegar, a URL nunca
  // muda, então ele continua aberto sozinho, sem precisar de `editId`.
  revalidateTeam();
}

/**
 * Etapa "MITZA Platform Integrity Wave 3" — contrato alinhado ao padrão da
 * Sprint (concluir/excluir tarefa): sem redirect, `{error?/message?}` pro
 * botão (`ToastActionButton`) mostrar erro inline ou disparar o toast.
 * Antes, um `editId` opcional decidia pra qual URL o redirect voltava (o
 * mesmo drawer ou a lista) — sem redirect, essa distinção deixa de fazer
 * sentido: a tela em que o gestor já estava nunca muda de qualquer jeito.
 * Desativar é seguro e reversível (existe "Reativar"), então a interface
 * não pergunta antes — executa na hora.
 */
export async function deactivateTeamMemberAction(memberId: string): Promise<{ error?: string; message?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("team_members")
    .update({ status: "inativo" })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) return { error: toUserFacingError(error, "Não foi possível desativar o membro.") };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_DEACTIVATED,
    entityType: "team_member",
    entityId: memberId,
    source: "web",
  });

  revalidateTeam();
  return { message: "Membro desativado." };
}

export async function reactivateTeamMemberAction(memberId: string): Promise<{ error?: string; message?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("team_members")
    .update({ status: "ativo" })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) return { error: toUserFacingError(error, "Não foi possível reativar o membro.") };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_REACTIVATED,
    entityType: "team_member",
    entityId: memberId,
    source: "web",
  });

  revalidateTeam();
  return { message: "Membro reativado." };
}

/**
 * Núcleo do convite — reaproveitado tanto por `inviteTeamMemberAction`
 * quanto por `createTeamMemberAction` quando "Conceder acesso agora?" está
 * marcado. O membro em si permanece criado mesmo que o convite falhe
 * (nunca é apagado por causa de uma falha no envio — seção 27 do pedido).
 *
 * Platform Continuity System 1.0: "Convite enviado" não deixa nenhum
 * rastro óbvio na tela (o badge de status muda, mas é fácil não notar) —
 * por isso não usa mais `redirect()`/`?saved=`: devolve `{ error }` ou
 * `{ message }` pro botão (client component) mostrar erro inline ou
 * disparar o toast de confirmação.
 */
async function inviteTeamMemberCore(memberId: string): Promise<{ error?: string; message?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, status, auth_user_id, organization_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) return { error: "Membro não encontrado." };
  if (member.status !== "ativo") return { error: "Reative o membro antes de convidar." };
  if (!isValidEmail(member.email)) return { error: "Este membro não tem um e-mail válido cadastrado." };
  if (member.auth_user_id) return { error: "Este membro já tem acesso ao sistema." };

  const admin = createAdminClient();

  const invite = await admin.auth.admin.inviteUserByEmail(member.email, {
    data: { name: member.name },
  });

  let authUserId: string | null = invite.data?.user?.id ?? null;
  let alreadyExisted = false;

  if (!authUserId) {
    const message = invite.error?.message?.toLowerCase() ?? "";
    const isDuplicate = message.includes("already") || message.includes("registered") || message.includes("exists");
    if (!isDuplicate) return { error: "Não foi possível enviar o convite." };

    // E-mail já existe no Supabase Auth: localiza o usuário no servidor
    // (nunca no navegador) em vez de criar uma conta duplicada.
    const found = await findAuthUserByEmail(admin, member.email);
    if (!found) return { error: "Não foi possível localizar o usuário existente para este e-mail." };
    authUserId = found;
    alreadyExisted = true;
  }

  // O e-mail já pode estar vinculado a outro membro (nesta ou em outra
  // organização) — nunca mover o vínculo sem revisão, e nunca revelar
  // detalhes de outra organização na resposta.
  const { data: linkedElsewhere } = await supabase
    .from("team_members")
    .select("id, organization_id")
    .eq("auth_user_id", authUserId)
    .neq("id", member.id)
    .maybeSingle();

  if (linkedElsewhere) return { error: "Este e-mail já está vinculado a outro membro da equipe." };

  const { error: updateError } = await supabase
    .from("team_members")
    .update({
      auth_user_id: authUserId,
      invitation_status: alreadyExisted ? "acesso_ativo" : "convite_pendente",
      invited_at: new Date().toISOString(),
      invited_by: profile.id,
    })
    .eq("id", member.id);

  if (updateError) return { error: "Convite enviado, mas houve um erro ao registrar o status. Tente novamente." };

  const actor = actorFromProfile(profile);
  await recordOperationalEvent(supabase, actor, {
    eventType: OperationalEventType.TEAM_MEMBER_INVITED,
    entityType: "team_member",
    entityId: member.id,
    source: "server",
    metadata: { already_existed_in_auth: alreadyExisted },
  });

  if (alreadyExisted) {
    await recordOperationalEvent(supabase, actor, {
      eventType: OperationalEventType.TEAM_MEMBER_ACCESS_ACTIVATED,
      entityType: "team_member",
      entityId: member.id,
      source: "server",
      metadata: { via: "existing_auth_account" },
    });
  }

  revalidateTeam();
  return {
    message: alreadyExisted ? `${member.name} foi vinculado ao usuário existente.` : `Convite enviado para ${member.name}.`,
  };
}

/** Busca paginada por e-mail (case-insensitive) na Auth — usada só quando
 * inviteUserByEmail falha por já existir. Escopo pequeno (equipe de uma
 * agência), então um número limitado de páginas é suficiente. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;

    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;

    if (data.users.length < perPage) break;
  }

  return null;
}

export async function inviteTeamMemberAction(memberId: string): Promise<{ error?: string; message?: string }> {
  return inviteTeamMemberCore(memberId);
}

export async function resendInviteAction(memberId: string): Promise<{ error?: string; message?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, invitation_status")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) return { error: "Membro não encontrado." };
  if (member.invitation_status !== "convite_pendente") return { error: "Este membro não tem convite pendente." };

  const admin = createAdminClient();
  // inviteUserByEmail reenvia o e-mail de convite quando o usuário já existe
  // mas ainda não confirmou a conta (mesmo comportamento do Supabase Auth
  // pra um convite ainda não aceito).
  const { error } = await admin.auth.admin.inviteUserByEmail(member.email, { data: { name: member.name } });
  if (error) return { error: "Não foi possível reenviar o convite." };

  await supabase.from("team_members").update({ invited_at: new Date().toISOString() }).eq("id", member.id);

  revalidateTeam();
  return { message: `Convite reenviado para ${member.name}.` };
}

export async function revokeAccessAction(memberId: string): Promise<{ error?: string; message?: string }> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, auth_user_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) return { error: "Membro não encontrado." };

  if (member.auth_user_id) {
    const admin = createAdminClient();
    // Bloqueia o login sem apagar a conta — nunca excluir o usuário do Auth
    // sem revisão explícita (seção 18/21 do pedido). A autoria de
    // comentários/tarefas antigas continua íntegra (aponta pra
    // team_members.id, nunca pra auth.users diretamente).
    await admin.auth.admin.updateUserById(member.auth_user_id, { ban_duration: "876000h" });
  }

  const { error } = await supabase
    .from("team_members")
    .update({ invitation_status: "sem_acesso" })
    .eq("id", memberId);

  if (error) return { error: "Não foi possível revogar o acesso." };

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_ACCESS_REVOKED,
    entityType: "team_member",
    entityId: memberId,
    source: "web",
  });

  revalidateTeam();
  return { message: "Acesso revogado." };
}

/**
 * Exclusão definitiva do cadastro — diferente de Desativar (preserva tudo),
 * esta apaga de vez o auth.users (login) e a linha de team_members. Exige
 * que o membro já esteja "inativo" (Desativar primeiro é uma etapa
 * separada, de propósito: reduz o risco de excluir por engano alguém que
 * ainda está em atividade) e que não seja mais gestor principal de nenhum
 * cliente ativo (senão o cliente ficaria sem gestor principal do nada).
 * Tarefas, comentários e eventos antigos deste membro continuam existindo
 * — as FKs pra team_members(id) são todas "on delete set null" (só
 * client_managers usa cascade, e ali é só a linha de atribuição, não dado
 * de negócio). Nunca permite excluir o próprio cadastro de quem está
 * logado.
 */
export async function deleteTeamMemberAction(memberId: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  if (memberId === profile.id) failure("Você não pode excluir o próprio cadastro.");

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, status, auth_user_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) failure("Membro não encontrado.");
  if (member.status !== "inativo") failure('Desative o membro antes de excluir definitivamente.');

  const { count: primaryManagerCount } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("primary_manager_id", memberId)
    .is("deleted_at", null);

  if (primaryManagerCount && primaryManagerCount > 0) {
    failure(`Este membro ainda é gestor principal de ${primaryManagerCount} cliente(s) — reatribua antes de excluir.`);
  }

  if (member.auth_user_id) {
    const admin = createAdminClient();
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(member.auth_user_id);
    if (deleteAuthError) failure("Não foi possível excluir o acesso do membro. Tente novamente.");
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) failure("Não foi possível excluir o membro.");

  await recordOperationalEvent(supabase, actorFromProfile(profile), {
    eventType: OperationalEventType.TEAM_MEMBER_DELETED,
    entityType: "team_member",
    entityId: memberId,
    source: "web",
    metadata: { name: member.name },
  });

  revalidateTeam();
  success(`${member.name} foi excluído definitivamente.`);
}
