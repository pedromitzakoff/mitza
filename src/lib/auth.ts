import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";
import { OperationalEventType } from "@/lib/operational-events";
import { recordOperationalEvent } from "@/lib/record-operational-event";

export interface CurrentProfile {
  id: string;
  name: string;
  role: UserRole;
  organizationId: string;
  /** uuid de auth.users de quem está logado — usado só como `actor_auth_user_id`
   * em operational_events (Etapa 56); nunca usado como identidade
   * operacional (isso é sempre `id`, o team_members.id). */
  authUserId: string;
}

/**
 * Vincula o usuário autenticado a um team_member pendente, quando o convite
 * foi aceito mas o vínculo direto (feito na Server Action de convite, que já
 * recebe o auth_user_id de volta da chamada admin) ainda não aconteceu por
 * algum motivo (ex.: usuário aceitou via link e nunca passou pelo fluxo que
 * chamou a action). Idempotente: só atualiza se ainda não houver
 * auth_user_id vinculado a este e-mail; nunca sobrescreve um vínculo já
 * existente, nunca autoriza globalmente só por causa do e-mail (seção 11 do
 * pedido) — o vínculo é permanente a partir daqui, sempre via auth_user_id.
 */
async function linkPendingTeamMember(authUserId: string, email: string | undefined) {
  if (!email) return;
  const supabase = await createClient();

  const { data: linked } = await supabase
    .from("team_members")
    .update({ auth_user_id: authUserId, invitation_status: "acesso_ativo" })
    .eq("invitation_status", "convite_pendente")
    .is("auth_user_id", null)
    .eq("status", "ativo")
    .ilike("email", email)
    .select("id, organization_id")
    .maybeSingle();

  if (linked) {
    // Ativação de acesso pelo fluxo de fallback (login após aceitar o
    // convite, sem ter passado pela Server Action de convite) — mesmo
    // evento que inviteTeamMemberCore registraria se o vínculo já tivesse
    // acontecido lá.
    await recordOperationalEvent(
      supabase,
      { teamMemberId: linked.id, authUserId, organizationId: linked.organization_id },
      {
        eventType: OperationalEventType.TEAM_MEMBER_ACCESS_ACTIVATED,
        entityType: "team_member",
        entityId: linked.id,
        source: "server",
        metadata: { via: "post_login_fallback" },
      },
    );
  }
}

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, system_role, organization_id")
    .eq("auth_user_id", user.id)
    .eq("status", "ativo")
    .maybeSingle();

  if (member) {
    return {
      id: member.id,
      name: member.name,
      role: member.system_role,
      organizationId: member.organization_id,
      authUserId: user.id,
    };
  }

  // Sem vínculo direto ainda — tenta o fallback idempotente e verifica de novo,
  // uma única vez. Se ainda assim não houver membro, o usuário autenticado
  // não tem acesso operacional válido (nunca liberar acesso automático).
  await linkPendingTeamMember(user.id, user.email);

  const { data: linked } = await supabase
    .from("team_members")
    .select("id, name, system_role, organization_id")
    .eq("auth_user_id", user.id)
    .eq("status", "ativo")
    .maybeSingle();

  if (!linked) return null;
  return {
    id: linked.id,
    name: linked.name,
    role: linked.system_role,
    organizationId: linked.organization_id,
    authUserId: user.id,
  };
}

/** Redireciona para a home se o usuário logado não for admin. */
export async function requireAdmin(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    redirect("/");
  }

  return profile;
}
