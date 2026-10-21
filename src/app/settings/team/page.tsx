import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { TeamTable, type TeamTableRow } from "./team-table";
import { EditTeamMemberDrawer, NewTeamMemberDrawer } from "./team-member-drawer";
import { SettingsPageShell } from "../settings-shell";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  // Etapa "Equipe — Perfil Profissional": esta gestão administrativa de
  // membros (convidar/editar/cargo) mudou de rota (`/team` -> `/settings/team`)
  // pra abrir espaço pro novo Perfil Profissional em `/team`, acessível a
  // qualquer membro interno ativo. Junto da mudança de rota, adota o mesmo
  // gate `requireAdmin()` que toda outra subpágina de Configurações já usa
  // (`/settings/clients`, etc.) — antes, esta tela permitia visualização
  // (sem editar) por qualquer usuário logado; agora, como as demais irmãs
  // em Configurações, é admin-only mesmo pra leitura.
  const profile = await requireAdmin();

  const { new: openNew, edit: editId, error, saved } = await searchParams;
  const isAdmin = profile.role === "admin";
  const supabase = await createSupabaseClient();

  const [members, clients, clientManagers] = await Promise.all([
    requireQuery(
      supabase
        .from("team_members")
        .select(
          "id, name, email, job_title, system_role, status, invitation_status, auth_user_id, invited_at, organization_id",
        )
        .eq("organization_id", profile.organizationId)
        .order("name"),
      "team_members",
    ),
    // Princípio "Workspace = só cliente ativo": carteira
    // (`assignedClientsCount`) só conta cliente com contrato ativo — um
    // cliente pausado/encerrado não deveria contar como carteira corrente
    // do gestor.
    requireQuery(
      supabase
        .from("clients")
        .select("id, primary_manager_id")
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS),
      "clients",
    ),
    requireQuery(supabase.from("client_managers").select("client_id, user_id"), "client_managers"),
  ]);

  const rows = members;

  const clientsByMember = new Map<string, Set<string>>();
  for (const client of clients) {
    if (!client.primary_manager_id) continue;
    const set = clientsByMember.get(client.primary_manager_id) ?? new Set<string>();
    set.add(client.id);
    clientsByMember.set(client.primary_manager_id, set);
  }
  for (const cm of clientManagers) {
    const set = clientsByMember.get(cm.user_id) ?? new Set<string>();
    set.add(cm.client_id);
    clientsByMember.set(cm.user_id, set);
  }

  const tableRows: TeamTableRow[] = rows.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    job_title: member.job_title,
    system_role: member.system_role,
    status: member.status,
    invitation_status: member.invitation_status,
    assignedClientsCount: clientsByMember.get(member.id)?.size ?? 0,
  }));

  const activeCount = rows.filter((m) => m.status === "ativo").length;
  const withAccessCount = rows.filter((m) => m.invitation_status === "acesso_ativo").length;
  const pendingInviteCount = rows.filter((m) => m.invitation_status === "convite_pendente").length;

  const editingMember = editId ? rows.find((m) => m.id === editId) : undefined;

  return (
    <SettingsPageShell
      title="Equipe"
      description={`${activeCount} membros ativos · ${withAccessCount} com acesso · ${pendingInviteCount} convites pendentes`}
      backHref="/settings"
      actions={
        isAdmin && (
          <Link
            href="/settings/team?new=1"
            scroll={false}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            + Novo membro
          </Link>
        )
      }
    >
      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {saved}
        </p>
      )}

      <TeamTable rows={tableRows} isAdmin={isAdmin} />

      {isAdmin && openNew && <NewTeamMemberDrawer closeHref="/settings/team" />}
      {isAdmin && editingMember && (
        <EditTeamMemberDrawer
          closeHref="/settings/team"
          member={{
            id: editingMember.id,
            name: editingMember.name,
            email: editingMember.email,
            job_title: editingMember.job_title,
            system_role: editingMember.system_role,
            status: editingMember.status,
            invitation_status: editingMember.invitation_status,
            auth_user_id: editingMember.auth_user_id,
            invited_at: editingMember.invited_at,
            assignedClientsCount: clientsByMember.get(editingMember.id)?.size ?? 0,
          }}
        />
      )}
    </SettingsPageShell>
  );
}
