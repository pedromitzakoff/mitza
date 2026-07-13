import Link from "next/link";
import {
  TEAM_INVITATION_BADGE_CLASSES,
  TEAM_INVITATION_STATUS_LABEL,
  TEAM_MEMBER_STATUS_LABEL,
  TEAM_SYSTEM_ROLE_LABEL,
  getTeamMemberInitial,
} from "@/lib/team-members";
import type { TeamInvitationStatus, TeamMemberStatus, TeamSystemRole } from "@/lib/supabase/database.types";
import { deactivateTeamMemberAction, reactivateTeamMemberAction, resendInviteAction } from "./actions";

export interface TeamTableRow {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  system_role: TeamSystemRole;
  status: TeamMemberStatus;
  invitation_status: TeamInvitationStatus;
  assignedClientsCount: number;
}

/**
 * Tabela compacta — sem cards grandes, sem jargão técnico (seção 7/24 do
 * pedido). Ações rápidas (Reenviar convite/Desativar/Reativar) ficam
 * inline; edição completa e "Convidar"/"Revogar" (ações mais sensíveis)
 * vivem no drawer (EditTeamMemberDrawer), aberto por "Editar".
 */
export function TeamTable({ rows }: { rows: TeamTableRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Nenhum membro cadastrado ainda.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Membro</th>
            <th className="px-3 py-2 font-medium">Cargo</th>
            <th className="px-3 py-2 font-medium">Papel</th>
            <th className="px-3 py-2 font-medium">Clientes</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Acesso</th>
            <th className="px-3 py-2 font-medium">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                    {getTeamMemberInitial(member.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{member.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{member.job_title ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{TEAM_SYSTEM_ROLE_LABEL[member.system_role]}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{member.assignedClientsCount}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    member.status === "ativo"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {TEAM_MEMBER_STATUS_LABEL[member.status]}
                </span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${TEAM_INVITATION_BADGE_CLASSES[member.invitation_status]}`}
                >
                  {TEAM_INVITATION_STATUS_LABEL[member.invitation_status]}
                </span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/team?edit=${member.id}`}
                    scroll={false}
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Editar
                  </Link>
                  <details className="relative">
                    <summary className="cursor-pointer list-none rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-zinc-100 [&::-webkit-details-marker]:hidden dark:hover:bg-zinc-900">
                      •••
                    </summary>
                    <div className="absolute right-0 z-10 mt-1 flex w-44 flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg">
                      {member.invitation_status === "convite_pendente" && (
                        <form action={resendInviteAction.bind(null, member.id)}>
                          <button
                            type="submit"
                            className="w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Reenviar convite
                          </button>
                        </form>
                      )}
                      {member.status === "ativo" ? (
                        <form action={deactivateTeamMemberAction.bind(null, member.id)}>
                          <button
                            type="submit"
                            className="w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Desativar
                          </button>
                        </form>
                      ) : (
                        <form action={reactivateTeamMemberAction.bind(null, member.id)}>
                          <button
                            type="submit"
                            className="w-full rounded px-2 py-1 text-left text-xs text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Reativar
                          </button>
                        </form>
                      )}
                    </div>
                  </details>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
