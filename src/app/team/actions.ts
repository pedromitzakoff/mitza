"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { isValidEmail } from "@/lib/validation";
import { normalizeTeamMemberEmail } from "@/lib/team-members";
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

function failure(message: string): never {
  redirect(`/team?error=${encodeURIComponent(message)}`);
}

function success(message: string): never {
  redirect(`/team?saved=${encodeURIComponent(message)}`);
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

  revalidateTeam();

  if (grantAccessNow) {
    await inviteTeamMemberCore(member.id);
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

  if (!name) failure("Informe o nome do membro.");
  if (!SYSTEM_ROLES.includes(systemRole)) failure("Papel no sistema inválido.");

  const { error } = await supabase
    .from("team_members")
    .update({ name, job_title: jobTitle, system_role: systemRole })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) failure("Não foi possível salvar as alterações.");

  revalidateTeam();
  success("Membro atualizado.");
}

export async function deactivateTeamMemberAction(memberId: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("team_members")
    .update({ status: "inativo" })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) failure("Não foi possível desativar o membro.");

  revalidateTeam();
  success("Membro desativado. Clientes, tarefas e histórico foram preservados.");
}

export async function reactivateTeamMemberAction(memberId: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { error } = await supabase
    .from("team_members")
    .update({ status: "ativo" })
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId);

  if (error) failure("Não foi possível reativar o membro.");

  revalidateTeam();
  success("Membro reativado.");
}

/**
 * Núcleo do convite — reaproveitado tanto por `inviteTeamMemberAction`
 * quanto por `createTeamMemberAction` quando "Conceder acesso agora?" está
 * marcado. Nunca lança: qualquer falha vira um redirect com mensagem curta,
 * o membro em si permanece criado (nunca é apagado por causa de uma falha
 * no envio do convite — seção 27 do pedido).
 */
async function inviteTeamMemberCore(memberId: string): Promise<never> {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, status, auth_user_id, organization_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) failure("Membro não encontrado.");
  if (member.status !== "ativo") failure("Reative o membro antes de convidar.");
  if (!isValidEmail(member.email)) failure("Este membro não tem um e-mail válido cadastrado.");
  if (member.auth_user_id) failure("Este membro já tem acesso ao sistema.");

  const admin = createAdminClient();

  const invite = await admin.auth.admin.inviteUserByEmail(member.email, {
    data: { name: member.name },
  });

  let authUserId: string | null = invite.data?.user?.id ?? null;
  let alreadyExisted = false;

  if (!authUserId) {
    const message = invite.error?.message?.toLowerCase() ?? "";
    const isDuplicate = message.includes("already") || message.includes("registered") || message.includes("exists");
    if (!isDuplicate) failure("Não foi possível enviar o convite.");

    // E-mail já existe no Supabase Auth: localiza o usuário no servidor
    // (nunca no navegador) em vez de criar uma conta duplicada.
    const found = await findAuthUserByEmail(admin, member.email);
    if (!found) failure("Não foi possível localizar o usuário existente para este e-mail.");
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

  if (linkedElsewhere) failure("Este e-mail já está vinculado a outro membro da equipe.");

  const { error: updateError } = await supabase
    .from("team_members")
    .update({
      auth_user_id: authUserId,
      invitation_status: alreadyExisted ? "acesso_ativo" : "convite_pendente",
      invited_at: new Date().toISOString(),
      invited_by: profile.id,
    })
    .eq("id", member.id);

  if (updateError) failure("Convite enviado, mas houve um erro ao registrar o status. Tente novamente.");

  revalidateTeam();
  success(alreadyExisted ? `${member.name} foi vinculado ao usuário existente.` : `Convite enviado para ${member.name}.`);
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

export async function inviteTeamMemberAction(memberId: string) {
  await inviteTeamMemberCore(memberId);
}

export async function resendInviteAction(memberId: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, email, invitation_status")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) failure("Membro não encontrado.");
  if (member.invitation_status !== "convite_pendente") failure("Este membro não tem convite pendente.");

  const admin = createAdminClient();
  // inviteUserByEmail reenvia o e-mail de convite quando o usuário já existe
  // mas ainda não confirmou a conta (mesmo comportamento do Supabase Auth
  // pra um convite ainda não aceito).
  const { error } = await admin.auth.admin.inviteUserByEmail(member.email, { data: { name: member.name } });
  if (error) failure("Não foi possível reenviar o convite.");

  await supabase.from("team_members").update({ invited_at: new Date().toISOString() }).eq("id", member.id);

  revalidateTeam();
  success(`Convite reenviado para ${member.name}.`);
}

export async function revokeAccessAction(memberId: string) {
  const profile = await requireAdmin();
  const supabase = await createSupabaseClient();

  const { data: member } = await supabase
    .from("team_members")
    .select("id, auth_user_id")
    .eq("id", memberId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (!member) failure("Membro não encontrado.");

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

  if (error) failure("Não foi possível revogar o acesso.");

  revalidateTeam();
  success("Acesso revogado.");
}
