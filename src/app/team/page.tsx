import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { TeamTable, type TeamTableRow } from "./team-table";
import { EditTeamMemberDrawer, NewTeamMemberDrawer } from "./team-member-drawer";
import { computeTeamMemberActivity, fetchTeamMemberTimeline, type ActivityPeriodKey } from "@/lib/team-member-activity";

const ACTIVITY_PERIODS: ActivityPeriodKey[] = ["7d", "30d", "month"];

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    error?: string;
    saved?: string;
    period?: string;
    timelinePage?: string;
  }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/");

  const { new: openNew, edit: editId, error, saved, period: periodParam, timelinePage: timelinePageParam } =
    await searchParams;
  const activityPeriod: ActivityPeriodKey = ACTIVITY_PERIODS.includes(periodParam as ActivityPeriodKey)
    ? (periodParam as ActivityPeriodKey)
    : "month";
  const timelinePage = Math.max(0, Number(timelinePageParam) || 0);
  const isAdmin = profile.role === "admin";
  const supabase = await createSupabaseClient();

  const [members, clients, clientManagers, tasks] = await Promise.all([
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
    // Princípio "Workspace = só cliente ativo": carga operacional
    // (`assignedClientsCount`) só conta cliente com contrato ativo — um
    // cliente pausado/encerrado não deveria contar como carga de trabalho
    // corrente do gestor.
    requireQuery(
      supabase
        .from("clients")
        .select("id, primary_manager_id")
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS),
      "clients",
    ),
    requireQuery(supabase.from("client_managers").select("client_id, user_id"), "client_managers"),
    requireQuery(supabase.from("tasks").select("assignee_id, status, type, due_date"), "tasks"),
  ]);

  const rows = members;
  const today = todayDateString();

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

  const pendingTasksByMember = new Map<string, number>();
  const futureMeetingsByMember = new Map<string, number>();
  for (const task of tasks) {
    if (!task.assignee_id) continue;
    if (task.status === "pendente") {
      pendingTasksByMember.set(task.assignee_id, (pendingTasksByMember.get(task.assignee_id) ?? 0) + 1);
    }
    if (task.type === "reuniao" && task.status !== "feito" && task.due_date >= today) {
      futureMeetingsByMember.set(task.assignee_id, (futureMeetingsByMember.get(task.assignee_id) ?? 0) + 1);
    }
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

  const [activitySummary, timeline] = editingMember
    ? await Promise.all([
        computeTeamMemberActivity(supabase, profile.organizationId, editingMember.id, activityPeriod),
        fetchTeamMemberTimeline(supabase, profile.organizationId, editingMember.id, timelinePage),
      ])
    : [null, null];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Equipe</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {activeCount} membros ativos · {withAccessCount} com acesso · {pendingInviteCount} convites pendentes
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/team?new=1"
            scroll={false}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            + Novo membro
          </Link>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {saved}
        </p>
      )}

      <div className="mt-4">
        <TeamTable rows={tableRows} isAdmin={isAdmin} />
      </div>

      {isAdmin && openNew && <NewTeamMemberDrawer closeHref="/team" />}
      {isAdmin && editingMember && activitySummary && timeline && (
        <EditTeamMemberDrawer
          closeHref="/team"
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
            pendingTasksCount: pendingTasksByMember.get(editingMember.id) ?? 0,
            futureMeetingsCount: futureMeetingsByMember.get(editingMember.id) ?? 0,
          }}
          activityPeriod={activityPeriod}
          activitySummary={activitySummary}
          timelineRows={timeline.rows}
          timelinePage={timelinePage}
          timelineHasMore={timeline.hasMore}
        />
      )}
    </div>
  );
}
