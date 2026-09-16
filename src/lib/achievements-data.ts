import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { AchievementLevel, AchievementMetricSnapshot, AchievementScope, AchievementSeverity, AchievementSourceInfo } from "@/lib/achievement-types";

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
  /** Etapa "Comunicação de Conquistas" — objetivo de performance ATUAL do
   * cliente (`clients.performance_goal`, fonte canônica já usada por
   * `achievement-metrics.ts` pra montar o contexto de avaliação — nunca
   * reintroduzida como campo próprio no metadata do evento). Determina se a
   * mensagem copiável fala em CPA/venda, CPL/lead ou custo por novo
   * seguidor (`achievement-messages.ts`). `null` = cliente sem objetivo
   * configurado (evento legado ou cliente ainda não configurado) — a
   * mensagem cai num rótulo neutro, nunca adivinha CPA/CPL. */
  clientPerformanceGoal: PerformanceGoal | null;
  actorTeamMemberId: string | null;
  actorTeamMemberName: string | null;
  /** Etapa "Conquistas por Granularidade" — `"account"` pra todo evento
   * legado (gravado antes desta etapa, sem o campo no metadata) e pra
   * escopo agência/pessoa. Fallback seguro, nunca `undefined` na leitura. */
  level: AchievementLevel;
  /** Nome da campanha/público/criativo — `null` quando `level === "account"`
   * ou em evento legado sem o campo. */
  entityName: string | null;
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
  /** Etapa "Conquistas por Granularidade" — só faz sentido pra `scope:
   * "client"` (Agência/Pessoa nunca têm nível); `null`/ausente = todos. */
  level?: AchievementLevel | null;
  /** Etapa "Filtros de Gestor/Objetivo" — responsável operacional ATUAL da
   * conta (`clients.primary_manager_id`, mesma fonte canônica de
   * `clients/page.tsx`/`operation-channel-state-data.ts` — nunca duplicado
   * no metadata do evento). Só faz sentido pra `scope: "client"`. */
  managerId?: string | null;
  /** Objetivo de performance ATUAL da conta (`clients.performance_goal`,
   * mesma fonte canônica de `operation/page.tsx`). Só faz sentido pra
   * `scope: "client"`. */
  goal?: PerformanceGoal | null;
}

const ACHIEVEMENTS_PAGE_SIZE = 20;

/** Resolve Gestor/Objetivo pro conjunto de `client_id` que os satisfaz,
 * consultando `clients` diretamente (a configuração CANÔNICA ATUAL da
 * conta) — nunca uma segunda cópia desses valores dentro do evento. `null`
 * = nenhum dos dois filtros está ativo (não restringe nada, diferente de um
 * array vazio, que significa "nenhum cliente satisfaz os dois filtros
 * juntos"). Compartilhado por `fetchAchievements`/`fetchClientAchievementsMonthSummary`
 * — nunca duas implementações da mesma resolução. */
async function resolveClientIdsForManagerAndGoal(
  supabase: SupabaseClient<Database>,
  managerId: string | null | undefined,
  goal: PerformanceGoal | null | undefined,
): Promise<string[] | null> {
  if (!managerId && !goal) return null;

  let query = supabase.from("clients").select("id");
  if (managerId) query = query.eq("primary_manager_id", managerId);
  if (goal) query = query.eq("performance_goal", goal);

  const { data } = await query;
  return (data ?? []).map((c) => c.id);
}

function toRow(row: {
  id: string;
  occurred_at: string;
  recorded_at: string;
  client_id: string | null;
  actor_team_member_id: string | null;
  metadata: Record<string, unknown> | null;
  client: { name: string; performance_goal: PerformanceGoal | null } | null;
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
    clientPerformanceGoal: row.client?.performance_goal ?? null,
    actorTeamMemberId: row.actor_team_member_id,
    actorTeamMemberName: row.actor?.name ?? null,
    level: (metadata.level as AchievementLevel | undefined) ?? "account",
    entityName: (metadata.entity_name as string | undefined) ?? null,
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

  const managerGoalClientIds = await resolveClientIdsForManagerAndGoal(supabase, filters.managerId, filters.goal);
  if (managerGoalClientIds !== null && managerGoalClientIds.length === 0) {
    // Nenhum cliente satisfaz Gestor+Objetivo juntos — resultado vazio sem
    // nem consultar operational_events (mesmo espírito de curto-circuito
    // seguro já usado nesta camada, nunca um `.in([])` ambíguo pro PostgREST).
    return { rows: [], hasMore: false };
  }

  let query = supabase
    .from("operational_events")
    .select("id, occurred_at, recorded_at, client_id, actor_team_member_id, metadata, client:clients(name, performance_goal), actor:team_members(name)")
    .eq("organization_id", organizationId)
    .eq("event_type", "achievement_unlocked")
    .eq("metadata->>scope", filters.scope)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (managerGoalClientIds !== null) query = query.in("client_id", managerGoalClientIds);
  if (filters.actorTeamMemberId) query = query.eq("actor_team_member_id", filters.actorTeamMemberId);
  if (filters.family) query = query.eq("metadata->>family", filters.family);
  if (filters.level) {
    // Evento legado (anterior à Etapa "Conquistas por Granularidade") nunca
    // teve `metadata.level` — sempre foi conceitualmente "Conta", então
    // "Nível: Conta" também precisa incluir esses eventos (chave ausente),
    // nunca só os que já têm o campo explícito. Só o nível "account" precisa
    // desse `.or` — campanha/público/criativo são inteiramente novos nesta
    // etapa, sem ambiguidade histórica.
    query =
      filters.level === "account"
        ? query.or("metadata->>level.eq.account,metadata->>level.is.null")
        : query.eq("metadata->>level", filters.level);
  }

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

/** Filtros que também recortam o resumo — os MESMOS filtros da aba Cliente
 * abaixo dele (`AchievementFilters`, sem `scope`/`actorTeamMemberId`, que
 * não existem nesta aba), pra "9 conquistas · 2 clientes · ..." sempre
 * corresponder à população realmente visível no feed, nunca um total global
 * dissociado do que os filtros já recortaram. */
export interface AchievementMonthSummaryFilters {
  clientId?: string | null;
  managerId?: string | null;
  goal?: PerformanceGoal | null;
  family?: string | null;
  level?: AchievementLevel | null;
}

/** Resumo compacto do mês — só pra Cliente (a única aba com volume
 * suficiente pra fazer sentido, seção 36 da Auditoria: "não transformar a
 * página em Dashboard"). Uma única query agregada, nunca N+1. */
export async function fetchClientAchievementsMonthSummary(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  monthRange: { firstDay: string; lastDay: string },
  filters: AchievementMonthSummaryFilters = {},
): Promise<AchievementMonthSummary> {
  const managerGoalClientIds = await resolveClientIdsForManagerAndGoal(supabase, filters.managerId, filters.goal);
  if (managerGoalClientIds !== null && managerGoalClientIds.length === 0) {
    return { total: 0, distinctClients: 0, records: 0, goalsReached: 0 };
  }

  let query = supabase
    .from("operational_events")
    .select("client_id, metadata")
    .eq("organization_id", organizationId)
    .eq("event_type", "achievement_unlocked")
    .eq("metadata->>scope", "client")
    .gte("occurred_at", `${monthRange.firstDay}T00:00:00Z`)
    .lte("occurred_at", `${monthRange.lastDay}T23:59:59.999Z`);

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (managerGoalClientIds !== null) query = query.in("client_id", managerGoalClientIds);
  if (filters.family) query = query.eq("metadata->>family", filters.family);
  if (filters.level) {
    query =
      filters.level === "account"
        ? query.or("metadata->>level.eq.account,metadata->>level.is.null")
        : query.eq("metadata->>level", filters.level);
  }

  const { data } = await query;
  const rows = data ?? [];
  const distinctClients = new Set(rows.map((r) => r.client_id).filter((id): id is string => id !== null)).size;
  const records = rows.filter((r) => (r.metadata as Record<string, unknown> | null)?.severity === "record").length;
  const goalsReached = rows.filter((r) => (r.metadata as Record<string, unknown> | null)?.family === "metas").length;

  return { total: rows.length, distinctClients, records, goalsReached };
}
