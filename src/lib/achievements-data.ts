import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AchievementMetricSnapshot, AchievementScope, AchievementSeverity, AchievementSourceInfo } from "@/lib/achievement-types";

/**
 * Camada de LEITURA da página `/achievements` — só lê conquistas já
 * persistidas em `operational_events` (`event_type = 'achievement_unlocked'`).
 * Nunca recalcula performance na renderização (salvaguarda de aprovação
 * nº4): toda a decisão "isso é uma conquista?" já aconteceu no cron
 * (`achievement-engine.ts`); esta camada só busca e formata o que já foi
 * gravado. Mesmo padrão de paginação (busca 1 a mais, corta, usa a sobra
 * pra saber se há próxima página) já usado em `agency-timeline.ts`.
 */

export interface AchievementRow {
  id: string;
  occurredAt: string;
  /** Etapa "Conquistas Auditáveis" — `recorded_at` de `operational_events`
   * (default `now()` no insert, nunca alterado depois): quando o MOTOR
   * detectou/gravou a conquista, distinto de `occurredAt` (quando ela
   * aconteceu de fato — meio-dia fixo do dia civil, ver `persistCandidate`).
   * As duas quase sempre caem no mesmo dia (o cron roda diariamente pro dia
   * anterior), mas nunca são o mesmo CAMPO — mostrar as duas é o que torna a
   * conquista auditável ("quando aconteceu" vs. "quando percebemos"). */
  detectedAt: string;
  scope: AchievementScope;
  family: string;
  severity: AchievementSeverity;
  type: string;
  clientId: string | null;
  clientName: string | null;
  actorTeamMemberId: string | null;
  actorTeamMemberName: string | null;
  headline: string;
  detail: string;
  metric: AchievementMetricSnapshot | null;
  source: AchievementSourceInfo | null;
}

export interface AchievementFilters {
  scope: AchievementScope;
  clientId?: string | null;
  actorTeamMemberId?: string | null;
  family?: string | null;
}

const ACHIEVEMENTS_PAGE_SIZE = 20;

function toRow(row: {
  id: string;
  occurred_at: string;
  recorded_at: string;
  client_id: string | null;
  actor_team_member_id: string | null;
  metadata: Record<string, unknown> | null;
  client: { name: string } | null;
  actor: { name: string } | null;
}): AchievementRow {
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    occurredAt: row.occurred_at,
    detectedAt: row.recorded_at,
    scope: (metadata.scope as AchievementScope) ?? "client",
    family: (metadata.family as string) ?? "",
    severity: (metadata.severity as AchievementSeverity) ?? "milestone",
    type: (metadata.achievement_type as string) ?? "",
    clientId: row.client_id,
    clientName: row.client?.name ?? (metadata.client_name as string | null) ?? null,
    actorTeamMemberId: row.actor_team_member_id,
    actorTeamMemberName: row.actor?.name ?? null,
    headline: (metadata.headline as string) ?? "",
    detail: (metadata.detail as string) ?? "",
    metric: (metadata.metric as AchievementMetricSnapshot | undefined) ?? null,
    source: (metadata.source as AchievementSourceInfo | undefined) ?? null,
  };
}

export async function fetchAchievements(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  filters: AchievementFilters,
  page = 0,
  pageSize = ACHIEVEMENTS_PAGE_SIZE,
): Promise<{ rows: AchievementRow[]; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize;

  let query = supabase
    .from("operational_events")
    .select("id, occurred_at, recorded_at, client_id, actor_team_member_id, metadata, client:clients(name), actor:team_members(name)")
    .eq("organization_id", organizationId)
    .eq("event_type", "achievement_unlocked")
    .eq("metadata->>scope", filters.scope)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.actorTeamMemberId) query = query.eq("actor_team_member_id", filters.actorTeamMemberId);
  if (filters.family) query = query.eq("metadata->>family", filters.family);

  const { data } = await query;
  const rows = data ?? [];
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);

  return { hasMore, rows: visible.map(toRow) };
}

export interface AchievementMonthSummary {
  total: number;
  distinctClients: number;
  records: number;
  goalsReached: number;
}

/** Resumo compacto do mês — só pra Cliente (a única aba com volume
 * suficiente pra fazer sentido, seção 36 da Auditoria: "não transformar a
 * página em Dashboard"). Uma única query agregada, nunca N+1. */
export async function fetchClientAchievementsMonthSummary(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  monthRange: { firstDay: string; lastDay: string },
): Promise<AchievementMonthSummary> {
  const { data } = await supabase
    .from("operational_events")
    .select("client_id, metadata")
    .eq("organization_id", organizationId)
    .eq("event_type", "achievement_unlocked")
    .eq("metadata->>scope", "client")
    .gte("occurred_at", `${monthRange.firstDay}T00:00:00Z`)
    .lte("occurred_at", `${monthRange.lastDay}T23:59:59.999Z`);

  const rows = data ?? [];
  const distinctClients = new Set(rows.map((r) => r.client_id).filter((id): id is string => id !== null)).size;
  const records = rows.filter((r) => (r.metadata as Record<string, unknown> | null)?.severity === "record").length;
  const goalsReached = rows.filter((r) => (r.metadata as Record<string, unknown> | null)?.family === "metas").length;

  return { total: rows.length, distinctClients, records, goalsReached };
}
