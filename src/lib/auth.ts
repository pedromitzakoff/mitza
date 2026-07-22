import { cache } from "react";
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

/**
 * Envolvida em `cache()` do React — Navigation Performance & Perceived
 * Speed 1.0: antes, o layout raiz E cada página chamavam esta função de
 * forma independente, repetindo `auth.getUser()` + a mesma consulta em
 * `team_members` duas vezes por navegação. `cache()` memoiza só dentro do
 * mesmo request/render (React cria um escopo de cache por renderização de
 * Server Components, descartado ao final do request) — nunca entre
 * usuários, nunca entre requests, nunca persistido em disco/memória
 * compartilhada. Isolamento multi-tenant preservado: a segunda chamada
 * dentro da MESMA navegação só reaproveita o resultado já resolvido PARA
 * AQUELE MESMO REQUEST; a próxima navegação (novo request) sempre resolve
 * de novo, do zero. O `auth.getUser()` do proxy (`src/lib/supabase/middleware.ts`)
 * continua completamente separado — roda antes deste código e não é
 * afetado por este cache.
 *
 * Instrumentação temporária de performance (console.log, só no servidor,
 * sem dados pessoais/tokens) — remover depois de confirmado o ganho em
 * produção.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const start = performance.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.log(`[perf] getCurrentProfile sem usuário — ${(performance.now() - start).toFixed(0)}ms`);
    return null;
  }

  const { data: member } = await supabase
    .from("team_members")
    .select("id, name, system_role, organization_id, invitation_status")
    .eq("auth_user_id", user.id)
    .eq("status", "ativo")
    .maybeSingle();

  if (member) {
    // User Feedback Resolution 1.0 (Bug 1): inviteTeamMemberCore já grava
    // `auth_user_id` no momento do convite (não só quando ele é aceito),
    // então a checagem acima encontra o vínculo direto e nunca passa pelo
    // fallback abaixo (`linkPendingTeamMember`) — sem isto,
    // `invitation_status` permanecia "convite_pendente" para sempre no
    // fluxo normal de convite, mesmo com o login já funcionando. Este é o
    // único lugar que sabe, com certeza, que o convite foi aceito de
    // verdade (autenticação bem-sucedida), então a transição acontece
    // aqui. Autolimitado: só grava na primeira vez (o `.eq` abaixo garante
    // que não repete a escrita nas próximas navegações, quando o status já
    // estiver "acesso_ativo").
    if (member.invitation_status === "convite_pendente") {
      const { error: activationError } = await supabase
        .from("team_members")
        .update({ invitation_status: "acesso_ativo" })
        .eq("id", member.id)
        .eq("invitation_status", "convite_pendente");

      if (!activationError) {
        await recordOperationalEvent(
          supabase,
          { teamMemberId: member.id, authUserId: user.id, organizationId: member.organization_id },
          {
            eventType: OperationalEventType.TEAM_MEMBER_ACCESS_ACTIVATED,
            entityType: "team_member",
            entityId: member.id,
            source: "server",
            metadata: { via: "login_confirmed" },
          },
        );
      }
    }

    console.log(`[perf] getCurrentProfile — ${(performance.now() - start).toFixed(0)}ms`);
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

  console.log(`[perf] getCurrentProfile (fallback de vínculo) — ${(performance.now() - start).toFixed(0)}ms`);

  if (!linked) return null;
  return {
    id: linked.id,
    name: linked.name,
    role: linked.system_role,
    organizationId: linked.organization_id,
    authUserId: user.id,
  };
});

/** Redireciona para a home se o usuário logado não for admin. */
export async function requireAdmin(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") {
    redirect("/");
  }

  return profile;
}

/** Redireciona para a home se não houver ninguém logado — sem checar
 * papel (admin ou gestor, ambos passam). Usado por ações que qualquer
 * membro ativo da equipe pode executar, sem distinção de carteira/cliente
 * (ex.: mover cliente entre pastas na árvore "Contas da Agência"). */
export async function requireActiveProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/");
  }

  return profile;
}

/**
 * Garante permissão de ESCRITA sobre um cliente específico — admin sempre
 * tem; gestor quando está em `client_managers` ("Gestores de apoio") OU é o
 * `clients.primary_manager_id` ("Gestor principal") — as duas formas de ser
 * responsável por um cliente na plataforma. Corrigido depois de um caso
 * real em produção: um gestor definido só como principal (nunca marcado
 * manualmente também em "Gestores de apoio") não conseguia escrever nada
 * que dependesse desta checagem. Mesmo critério usado por `is_client_manager()`
 * no RLS (ver supabase/is-client-manager-include-primary.sql) — esta função
 * só existe pra dar um redirect amigável ANTES da escrita chegar ao banco,
 * nunca substitui a policy correspondente. Hoje usada só por
 * `updateSprintPerformanceAction` ("Atualizar performance" da sprint).
 */
export async function requireClientManagerAccess(clientId: string): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/");
  }

  if (profile.role === "admin") {
    return profile;
  }

  const supabase = await createClient();
  const [{ data: managerRow }, { data: client }] = await Promise.all([
    supabase.from("client_managers").select("client_id").eq("client_id", clientId).eq("user_id", profile.id).maybeSingle(),
    supabase.from("clients").select("primary_manager_id").eq("id", clientId).maybeSingle(),
  ]);

  if (!managerRow && client?.primary_manager_id !== profile.id) {
    redirect("/");
  }

  return profile;
}
