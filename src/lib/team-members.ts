import type { TeamInvitationStatus, TeamMemberStatus, TeamSystemRole } from "@/lib/supabase/database.types";
import { TEAM_INVITATION_STATUS_REGISTRY, TEAM_MEMBER_STATUS_REGISTRY } from "@/lib/status-registry";

/** Rótulos em linguagem simples — nunca expor os nomes técnicos de coluna
 * (auth_user_id, invitation_status) na UI (seção 24 do pedido). Deriva do
 * Status Registry (`@/lib/status-registry`), ver Platform Integrity
 * Wave 1. `TeamMemberStatus` (status principal da pessoa) e
 * `TeamInvitationStatus` (sub-estado de acesso) continuam dois enums
 * distintos — Decisão 014 da Platform Integrity Review: sempre exibidos
 * com hierarquia visual clara entre eles, nunca como dois badges do
 * mesmo peso. */
export const TEAM_MEMBER_STATUS_LABEL: Record<TeamMemberStatus, string> = {
  ativo: TEAM_MEMBER_STATUS_REGISTRY["team_member.ativo"].label,
  inativo: TEAM_MEMBER_STATUS_REGISTRY["team_member.inativo"].label,
};

export const TEAM_INVITATION_STATUS_LABEL: Record<TeamInvitationStatus, string> = {
  sem_acesso: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.sem_acesso"].label,
  convite_pendente: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.convite_pendente"].label,
  acesso_ativo: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.acesso_ativo"].label,
};

export const TEAM_INVITATION_BADGE_CLASSES: Record<TeamInvitationStatus, string> = {
  sem_acesso: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.sem_acesso"].badgeClassName,
  convite_pendente: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.convite_pendente"].badgeClassName,
  acesso_ativo: TEAM_INVITATION_STATUS_REGISTRY["team_invitation.acesso_ativo"].badgeClassName,
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
