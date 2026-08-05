import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { ReminderRow } from "@/lib/reminders";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

// `reminders` tem 3 FKs pra `team_members` (assignee_id/created_by/
// completed_by) — precisa do nome explícito da constraint pra o PostgREST
// desambiguar o embed (mesmo motivo de `client_reports_created_by_fkey`/
// `client_reports_sent_by_fkey`, ver client-report-data.ts).
const REMINDER_SELECT =
  "id, title, scope, client_id, due_date, notes, created_at, client:clients(name), assignee:team_members!reminders_assignee_id_fkey(id, name), completed_by_member:team_members!reminders_completed_by_fkey(name), completed_at";

interface ReminderQueryRow {
  id: string;
  title: string;
  scope: "agency" | "client";
  client_id: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  client: { name: string } | null;
  assignee: { id: string; name: string } | null;
  completed_by_member: { name: string } | null;
  completed_at: string | null;
}

function toReminderRow(row: ReminderQueryRow): ReminderRow {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    clientId: row.client_id,
    clientName: row.client?.name ?? null,
    assigneeId: row.assignee?.id ?? null,
    assigneeName: row.assignee?.name ?? null,
    dueDate: row.due_date,
    notes: row.notes,
    createdAt: row.created_at,
    completedByName: row.completed_by_member?.name ?? null,
    completedAt: row.completed_at,
  };
}

export async function getOpenReminders(supabase: Supabase): Promise<ReminderRow[]> {
  const rows = await requireQuery(
    supabase.from("reminders").select(REMINDER_SELECT).eq("status", "pending").order("created_at", { ascending: true }),
    "reminders:open",
  );
  return (rows as unknown as ReminderQueryRow[]).map(toReminderRow);
}

export async function getCompletedReminders(supabase: Supabase): Promise<ReminderRow[]> {
  const rows = await requireQuery(
    supabase.from("reminders").select(REMINDER_SELECT).eq("status", "done").order("completed_at", { ascending: false }),
    "reminders:completed",
  );
  return (rows as unknown as ReminderQueryRow[]).map(toReminderRow);
}

/** Uma pendência específica pra edição — mesma forma de `ReminderRow`, só
 * buscada por id em vez da lista inteira. */
export async function getReminderById(supabase: Supabase, reminderId: string): Promise<ReminderRow | null> {
  const rows = await requireQuery(
    supabase.from("reminders").select(REMINDER_SELECT).eq("id", reminderId),
    "reminders:detail",
  );
  const row = (rows as unknown as ReminderQueryRow[])[0];
  return row ? toReminderRow(row) : null;
}
