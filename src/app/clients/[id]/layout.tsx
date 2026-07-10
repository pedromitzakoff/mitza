import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC, todayDateString } from "@/lib/today";
import { currentMonthRange } from "@/lib/sprint-financials";
import { buildOperationClientCard, type OperationClientRawData } from "@/app/operation/operation-data";
import { ClientContextBar } from "../client-context-bar";

/**
 * Layout aplicado a toda rota /clients/[id]/** — o subheader sticky do
 * cliente (ClientContextBar) mora aqui pra aparecer em qualquer subrota
 * (página principal, editar, nova tarefa, editar tarefa) sem precisar
 * repetir a busca/JSX em cada página. Reaproveita buildOperationClientCard
 * (a mesma função de Operação e da Visão Geral) pra não duplicar a regra
 * de saúde da conta.
 */
export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) return children;

  const supabase = await createSupabaseClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!client) notFound();

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = currentMonthRange(today);

  const [{ data: managers }, { data: sprints }, { data: dailySpend }, { data: tasks }, { data: clientActivity }] =
    await Promise.all([
      supabase.from("client_managers").select("user_id, profiles(id, name)").eq("client_id", id),
      supabase
        .from("sprints")
        .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
        .eq("client_id", id)
        .gte("start_date", firstDay)
        .lte("start_date", lastDay),
      supabase
        .from("daily_spend")
        .select("date, spend, synced_at")
        .eq("client_id", id)
        .gte("date", firstDay)
        .lte("date", lastDay),
      supabase
        .from("tasks")
        .select(
          "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:profiles!tasks_assignee_id_fkey(name)",
        )
        .eq("client_id", id),
      supabase.from("client_last_operational_activity").select("last_activity_at").eq("client_id", id).maybeSingle(),
    ]);

  const currentSprint = (sprints ?? []).find((s) => s.start_date <= todayStr && s.end_date >= todayStr);

  const { data: sprintActivity } = currentSprint
    ? await supabase
        .from("sprint_last_operational_activity")
        .select("last_activity_at")
        .eq("sprint_id", currentSprint.id)
        .maybeSingle()
    : { data: null };

  let lastSyncedAt: string | null = null;
  for (const row of dailySpend ?? []) {
    if (!lastSyncedAt || row.synced_at > lastSyncedAt) lastSyncedAt = row.synced_at;
  }

  const raw: OperationClientRawData = {
    id: client.id,
    name: client.name,
    metaAdAccountId: client.meta_ad_account_id,
    managerNames: (managers ?? []).flatMap((m) => (m.profiles ? [m.profiles.name] : [])),
    managerIds: (managers ?? []).flatMap((m) => (m.profiles ? [m.profiles.id] : [])),
    sprints: sprints ?? [],
    dailySpend: (dailySpend ?? []).map((d) => ({ date: d.date, spend: d.spend })),
    tasks: tasks ?? [],
    clientLastActivityAt: clientActivity?.last_activity_at ?? null,
    sprintLastActivityAt: sprintActivity?.last_activity_at ?? null,
    lastSyncedAt,
  };

  const card = buildOperationClientCard(raw, today);

  return (
    <>
      <ClientContextBar
        clientId={card.clientId}
        clientName={card.clientName}
        metaAdAccountId={card.metaAdAccountId}
        managerNames={card.managerNames}
        sprintNumber={card.sprintNumber}
        sprint={card.sprint}
        isAdmin={profile.role === "admin"}
      />
      {children}
    </>
  );
}
