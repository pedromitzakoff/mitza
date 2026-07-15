import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import {
  TEAM_INVITATION_BADGE_CLASSES,
  TEAM_INVITATION_STATUS_LABEL,
  TEAM_MEMBER_STATUS_LABEL,
} from "@/lib/team-members";
import type { TeamInvitationStatus, TeamMemberStatus, TeamSystemRole } from "@/lib/supabase/database.types";
import {
  createTeamMemberAction,
  deactivateTeamMemberAction,
  inviteTeamMemberAction,
  reactivateTeamMemberAction,
  resendInviteAction,
  revokeAccessAction,
  updateTeamMemberAction,
} from "./actions";
import { DeactivateMemberButton } from "./deactivate-member-button";
import { OperationalActivityPanel } from "./operational-activity-panel";
import { SubmitButton } from "@/app/submit-button";
import type { ActivityPeriodKey, TeamMemberActivitySummary, TeamMemberTimelineRow } from "@/lib/team-member-activity";

const inputClasses =
  "rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-zinc-500";
const labelClasses = "flex flex-col gap-1 text-sm text-foreground";

export interface TeamMemberDetail {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  system_role: TeamSystemRole;
  status: TeamMemberStatus;
  invitation_status: TeamInvitationStatus;
  auth_user_id: string | null;
  invited_at: string | null;
  assignedClientsCount: number;
  pendingTasksCount: number;
  futureMeetingsCount: number;
}

function DrawerShell({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>
        {children}
      </div>
    </>
  );
}

/** "+ Novo membro" — cria um team_member sem exigir acesso ao sistema (seção
 * 8 do pedido). "Conceder acesso agora?" desmarcado por padrão; quando
 * marcado, a própria action dispara o convite depois de criar o membro. */
export function NewTeamMemberDrawer({ closeHref }: { closeHref: string }) {
  return (
    <DrawerShell title="Novo membro" closeHref={closeHref}>
      <form action={createTeamMemberAction} className="mt-4 flex flex-col gap-3">
        <label className={labelClasses}>
          Nome <span className="text-red-500">*</span>
          <input name="name" required autoFocus className={inputClasses} />
        </label>
        <label className={labelClasses}>
          E-mail <span className="text-red-500">*</span>
          <input type="email" name="email" required className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Cargo <span className="text-xs text-muted-foreground">(opcional, descritivo)</span>
          <input name="job_title" placeholder="Ex.: Gestor de tráfego" className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Papel no sistema
          <select name="system_role" defaultValue="gestor" className={inputClasses}>
            <option value="gestor">Gestor</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="grant_access_now" className="h-4 w-4 rounded border-border" />
          Conceder acesso ao sistema agora
        </label>
        <p className="text-xs text-muted-foreground">
          Se desmarcado, o membro fica disponível pra atribuição em clientes e tarefas, mas sem login.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <SubmitButton
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            pendingChildren="Criando..."
          >
            Criar membro
          </SubmitButton>
          <Link
            href={closeHref}
            scroll={false}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </DrawerShell>
  );
}

/** Perfil do membro (seção 25 do pedido) — DADOS, OPERAÇÃO e ACESSO num só
 * drawer. Nenhum jargão técnico visível (auth_user_id nunca aparece; só os
 * rótulos em linguagem simples de TEAM_INVITATION_STATUS_LABEL). */
export function EditTeamMemberDrawer({
  member,
  closeHref,
  activityPeriod,
  activitySummary,
  timelineRows,
  timelinePage,
  timelineHasMore,
}: {
  member: TeamMemberDetail;
  closeHref: string;
  activityPeriod: ActivityPeriodKey;
  activitySummary: TeamMemberActivitySummary;
  timelineRows: TeamMemberTimelineRow[];
  timelinePage: number;
  timelineHasMore: boolean;
}) {
  return (
    <DrawerShell title={member.name} closeHref={closeHref}>
      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados</h3>
        <form action={updateTeamMemberAction.bind(null, member.id)} className="mt-2 flex flex-col gap-3">
          <label className={labelClasses}>
            Nome <span className="text-red-500">*</span>
            <input name="name" required autoFocus defaultValue={member.name} className={inputClasses} />
          </label>
          <p className="text-xs text-muted-foreground">E-mail: {member.email} (não editável nesta etapa)</p>
          <label className={labelClasses}>
            Cargo
            <input name="job_title" defaultValue={member.job_title ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            Papel no sistema
            <select name="system_role" defaultValue={member.system_role} className={inputClasses}>
              <option value="gestor">Gestor</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <SubmitButton
            className="self-start rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
            pendingChildren="Salvando..."
          >
            Salvar
          </SubmitButton>
        </form>
      </section>

      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operação</h3>
        <dl className="mt-2 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Clientes atribuídos</dt>
            <dd className="font-medium text-foreground">{member.assignedClientsCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tarefas pendentes</dt>
            <dd className="font-medium text-foreground">{member.pendingTasksCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Reuniões futuras</dt>
            <dd className="font-medium text-foreground">{member.futureMeetingsCount}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acesso</h3>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TEAM_INVITATION_BADGE_CLASSES[member.invitation_status]}`}
          >
            {TEAM_INVITATION_STATUS_LABEL[member.invitation_status]}
          </span>
          {member.invited_at && (
            <span className="text-xs text-muted-foreground">desde {formatDateTime(member.invited_at)}</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {member.invitation_status === "sem_acesso" && (
            <form action={inviteTeamMemberAction.bind(null, member.id, member.id)}>
              <SubmitButton
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                pendingChildren="Convidando..."
              >
                Convidar para o sistema
              </SubmitButton>
            </form>
          )}
          {member.invitation_status === "convite_pendente" && (
            <form action={resendInviteAction.bind(null, member.id, member.id)}>
              <SubmitButton
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                pendingChildren="Reenviando..."
              >
                Reenviar convite
              </SubmitButton>
            </form>
          )}
          {member.invitation_status === "acesso_ativo" && (
            <form action={revokeAccessAction.bind(null, member.id, member.id)}>
              <SubmitButton
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                pendingChildren="Revogando..."
              >
                Revogar acesso
              </SubmitButton>
            </form>
          )}
        </div>
      </section>

      <section className="mt-5 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Equipe</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Status atual: <span className="font-medium text-foreground">{TEAM_MEMBER_STATUS_LABEL[member.status]}</span>
        </p>
        <div className="mt-2">
          {member.status === "ativo" ? (
            <DeactivateMemberButton action={deactivateTeamMemberAction.bind(null, member.id, member.id)} />
          ) : (
            <form action={reactivateTeamMemberAction.bind(null, member.id, member.id)}>
              <SubmitButton
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                pendingChildren="Reativando..."
              >
                Reativar membro
              </SubmitButton>
            </form>
          )}
        </div>
      </section>

      <OperationalActivityPanel
        memberId={member.id}
        period={activityPeriod}
        summary={activitySummary}
        timelineRows={timelineRows}
        timelinePage={timelinePage}
        timelineHasMore={timelineHasMore}
      />
    </DrawerShell>
  );
}
