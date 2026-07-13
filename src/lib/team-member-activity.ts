import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { OperationalEventType, formatDelay, type OperationalEventType as OperationalEventTypeUnion } from "@/lib/operational-events";
import { todayDateString } from "@/lib/today";

export type ActivityPeriodKey = "7d" | "30d" | "month";

export const ACTIVITY_PERIOD_LABEL: Record<ActivityPeriodKey, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês atual",
};

export function periodStartDate(period: ActivityPeriodKey, today: string = todayDateString()): string {
  const date = new Date(`${today}T00:00:00Z`);
  if (period === "7d") {
    date.setUTCDate(date.getUTCDate() - 6);
    return date.toISOString().slice(0, 10);
  }
  if (period === "30d") {
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  }
  return `${today.slice(0, 7)}-01`;
}

/**
 * Indicadores DESCRITIVOS de "Atividade operacional" (seção 26 do pedido) —
 * de propósito: nunca chamados de "produtividade total", nunca viram score
 * ou ranking. São só uma leitura do que aconteceu no período, calculados a
 * partir de `operational_events` (nunca reconstruindo estado de domínio a
 * partir daqui — os números de tasks/clients continuam sendo lidos das
 * tabelas de sempre em outras telas).
 */
export interface TeamMemberActivitySummary {
  actionsCount: number;
  tasksCompleted: number;
  tasksCompletedOnTime: number;
  tasksCompletedLate: number;
  onTimeRate: number | null;
  averageDelayLabel: string;
  optimizationsCompleted: number;
  meetingsCompleted: number;
  creativeDeliveriesCompleted: number;
  tasksReopened: number;
  tasksReassignedReceived: number;
  tasksReassignedAway: number;
}

const ACTOR_ACTION_TYPES = new Set<OperationalEventTypeUnion>([
  OperationalEventType.TASK_COMPLETED,
  OperationalEventType.OPTIMIZATION_COMPLETED,
  OperationalEventType.MEETING_COMPLETED,
  OperationalEventType.CREATIVE_DELIVERY_COMPLETED,
  OperationalEventType.TASK_REOPENED,
]);

const RELEVANT_TYPES: OperationalEventTypeUnion[] = [...ACTOR_ACTION_TYPES, OperationalEventType.TASK_REASSIGNED];

export async function computeTeamMemberActivity(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  teamMemberId: string,
  period: ActivityPeriodKey,
): Promise<TeamMemberActivitySummary> {
  const startDate = periodStartDate(period);

  const { data: events } = await supabase
    .from("operational_events")
    .select("event_type, actor_team_member_id, was_on_time, delay_seconds, metadata")
    .eq("organization_id", organizationId)
    .in("event_type", RELEVANT_TYPES)
    .gte("occurred_at", `${startDate}T00:00:00Z`)
    .limit(2000);

  const rows = events ?? [];

  let actionsCount = 0;
  let tasksCompleted = 0;
  let tasksCompletedOnTime = 0;
  let tasksCompletedLate = 0;
  let delaySecondsSum = 0;
  let lateCount = 0;
  let optimizationsCompleted = 0;
  let meetingsCompleted = 0;
  let creativeDeliveriesCompleted = 0;
  let tasksReopened = 0;
  let tasksReassignedReceived = 0;
  let tasksReassignedAway = 0;

  for (const row of rows) {
    const eventType = row.event_type;
    const isActor = row.actor_team_member_id === teamMemberId;

    if (isActor && ACTOR_ACTION_TYPES.has(eventType)) {
      actionsCount += 1;

      if (eventType === OperationalEventType.TASK_COMPLETED) {
        tasksCompleted += 1;
        if (row.was_on_time) {
          tasksCompletedOnTime += 1;
        } else {
          tasksCompletedLate += 1;
          delaySecondsSum += row.delay_seconds ?? 0;
          lateCount += 1;
        }
      } else if (eventType === OperationalEventType.OPTIMIZATION_COMPLETED) {
        optimizationsCompleted += 1;
      } else if (eventType === OperationalEventType.MEETING_COMPLETED) {
        meetingsCompleted += 1;
      } else if (eventType === OperationalEventType.CREATIVE_DELIVERY_COMPLETED) {
        creativeDeliveriesCompleted += 1;
      } else if (eventType === OperationalEventType.TASK_REOPENED) {
        tasksReopened += 1;
      }
    }

    if (eventType === OperationalEventType.TASK_REASSIGNED) {
      const metadata = row.metadata as Record<string, unknown>;
      if (metadata.new_assignee_team_member_id === teamMemberId) tasksReassignedReceived += 1;
      if (metadata.previous_assignee_team_member_id === teamMemberId) tasksReassignedAway += 1;
    }
  }

  return {
    actionsCount,
    tasksCompleted,
    tasksCompletedOnTime,
    tasksCompletedLate,
    onTimeRate: tasksCompleted > 0 ? Math.round((tasksCompletedOnTime / tasksCompleted) * 100) : null,
    averageDelayLabel: lateCount > 0 ? formatDelay(Math.round(delaySecondsSum / lateCount)) : "Sem atrasos no período",
    optimizationsCompleted,
    meetingsCompleted,
    creativeDeliveriesCompleted,
    tasksReopened,
    tasksReassignedReceived,
    tasksReassignedAway,
  };
}

export interface TeamMemberTimelineRow {
  id: string;
  eventType: OperationalEventTypeUnion;
  occurredAt: string;
  clientName: string | null;
  taskTitle: string | null;
  wasOnTime: boolean | null;
  delaySeconds: number | null;
}

const TIMELINE_PAGE_SIZE = 15;

/** Timeline paginada do membro (seção 27) — nunca mostra o metadata JSON
 * bruto, só os campos já resolvidos pra exibição (rótulo, cliente, título,
 * atraso). */
export async function fetchTeamMemberTimeline(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  teamMemberId: string,
  page: number,
): Promise<{ rows: TeamMemberTimelineRow[]; hasMore: boolean }> {
  const from = page * TIMELINE_PAGE_SIZE;
  const to = from + TIMELINE_PAGE_SIZE; // busca 1 a mais pra saber se há próxima página

  const { data } = await supabase
    .from("operational_events")
    .select("id, event_type, occurred_at, was_on_time, delay_seconds, metadata, client:clients(name)")
    .eq("organization_id", organizationId)
    .eq("actor_team_member_id", teamMemberId)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  const rows = data ?? [];
  const hasMore = rows.length > TIMELINE_PAGE_SIZE;
  const visible = rows.slice(0, TIMELINE_PAGE_SIZE);

  return {
    hasMore,
    rows: visible.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const taskTitle = typeof metadata.task_title === "string" ? metadata.task_title : null;
      return {
        id: row.id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        clientName: row.client?.name ?? null,
        taskTitle,
        wasOnTime: row.was_on_time,
        delaySeconds: row.delay_seconds,
      };
    }),
  };
}
