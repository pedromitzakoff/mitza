import type { TeamInvitationStatus, TeamMemberStatus, TeamSystemRole } from "@/lib/supabase/database.types";

/** Rótulos em linguagem simples — nunca expor os nomes técnicos de coluna
 * (auth_user_id, invitation_status) na UI (seção 24 do pedido). */
export const TEAM_MEMBER_STATUS_LABEL: Record<TeamMemberStatus, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
};

export const TEAM_INVITATION_STATUS_LABEL: Record<TeamInvitationStatus, string> = {
  sem_acesso: "Sem acesso",
  convite_pendente: "Convite pendente",
  acesso_ativo: "Acesso ativo",
};

export const TEAM_INVITATION_BADGE_CLASSES: Record<TeamInvitationStatus, string> = {
  sem_acesso: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  convite_pendente: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  acesso_ativo: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
};

export const TEAM_SYSTEM_ROLE_LABEL: Record<TeamSystemRole, string> = {
  admin: "Admin",
  gestor: "Gestor",
};

/** trim + lowercase — mesma normalização usada na constraint única
 * `team_members_org_email_unique` (organization_id, lower(email)). */
export function normalizeTeamMemberEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

export function getTeamMemberInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export interface TeamMemberSelectOption {
  id: string;
  name: string;
  job_title: string | null;
}
