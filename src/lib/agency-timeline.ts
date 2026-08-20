import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperationalEventType } from "@/lib/supabase/database.types";
import { OperationalEventType as EventType, OPERATIONAL_EVENT_TYPE_LABEL } from "@/lib/operational-events";
import { buildReviewDetail } from "@/lib/client-operational-history";

/**
 * Timeline Geral da Agência — "o que aconteceu na operação da agência hoje/
 * nesta semana?", reaproveitando 100% `operational_events` (Auditoria da
 * Timeline Geral: nenhuma tabela nova, nenhum cron novo, nenhum tracking
 * novo — o mesmo padrão já provado por `lib/team-member-activity.ts`'s
 * `fetchTeamMemberTimeline`, só sem o filtro de um único ator). Nunca
 * decide "estado atual" de nada (isso continua sempre nas tabelas de
 * domínio) — é só um log de leitura do que já aconteceu.
 *
 * Curadoria deliberada (v1 "memória operacional, não tracking de clique"):
 * inclui só marcos operacionais que respondem "o que aconteceu" de forma
 * significativa — nunca CRUD granular de tarefa (criar/atribuir/mudar
 * prazo — só a CONCLUSÃO é o marco), nunca eventos administrativos de
 * equipe (contratação/acesso — isso não é "o que aconteceu na operação da
 * agência", é gestão de equipe), nunca edições/reversões (editar update,
 * marcar como não enviado) — só os marcos "algo aconteceu de fato".
 * `account_review_recorded` sozinho representa revisão E otimização (mesma
 * regra de dedupe já usada em `client-operational-history.ts`: uma revisão
 * com otimização(ões) já carrega o detalhe no próprio metadata — nunca
 * `account_optimization_recorded`/os eventos "outcome-specific" ao lado,
 * que triplicariam a mesma revisão como 3 linhas).
 */
const AGENCY_TIMELINE_EVENT_TYPES: OperationalEventType[] = [
  EventType.CLIENT_CREATED,
  EventType.CLIENT_STATUS_CHANGED,
  EventType.CLIENT_MANAGER_ASSIGNED,
  EventType.CLIENT_MANAGER_CHANGED,
  EventType.ACCOUNT_REVIEW_RECORDED,
  EventType.TASK_COMPLETED,
  EventType.MEETING_COMPLETED,
  EventType.CREATIVE_DELIVERY_COMPLETED,
  EventType.MONTHLY_BUDGET_CREATED,
  EventType.MONTHLY_BUDGET_CHANGED,
  EventType.MONTHLY_REPORT_STARTED,
  EventType.MONTHLY_REPORT_READY_FOR_REVIEW,
  EventType.MONTHLY_REPORT_FINALIZED,
  EventType.MONTHLY_REPORT_REOPENED,
  EventType.CLIENT_UPDATE_GENERATED,
  EventType.CLIENT_UPDATE_MARKED_SENT,
  EventType.CLIENT_REPORT_GENERATED,
  EventType.CLIENT_REPORT_SENT,
];

export interface AgencyTimelineRow {
  id: string;
  eventType: OperationalEventType;
  occurredAt: string;
  clientId: string | null;
  clientName: string | null;
  actorName: string | null;
  label: string;
  detail: string | null;
}

export interface AgencyTimelineFilters {
  /** `null` = todos os gestores — `actor_team_member_id`, quem EXECUTOU a
   * ação (mesmo critério já usado em `fetchTeamMemberTimeline`), não a
   * carteira do cliente. */
  actorId: string | null;
  clientId: string | null;
}

/** Só o que cada `event_type` já carrega de detalhe (metadata) sem
 * reimplementar nenhuma leitura nova — revisão/otimização reaproveita
 * `buildReviewDetail` (a mesma função que já monta esse texto na Timeline
 * por Cliente); conclusão de tarefa mostra o título (mesmo campo já lido em
 * `team-member-activity.ts`). Os demais tipos ficam só com o rótulo — v1
 * deliberadamente simples, sem inventar leitura de metadata nova por tipo. */
function buildDetail(eventType: OperationalEventType, metadata: Record<string, unknown>): string | null {
  if (eventType === EventType.ACCOUNT_REVIEW_RECORDED) return buildReviewDetail(metadata);
  if (eventType === EventType.TASK_COMPLETED) {
    return typeof metadata.task_title === "string" ? metadata.task_title : null;
  }
  return null;
}

const AGENCY_TIMELINE_PAGE_SIZE = 20;

/** Página da Timeline Geral, mais recente primeiro — mesmo padrão de
 * paginação (busca 1 a mais, corta, usa a sobra pra saber se há próxima
 * página) já usado em `fetchClientOperationalHistory`/`fetchTeamMemberTimeline`,
 * nenhum padrão novo. Filtros (gestor/cliente) viram `.eq()` na própria
 * query — nunca carrega tudo e filtra em memória. */
export async function fetchAgencyTimeline(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  filters: AgencyTimelineFilters,
  page = 0,
  pageSize = AGENCY_TIMELINE_PAGE_SIZE,
): Promise<{ rows: AgencyTimelineRow[]; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize;

  let query = supabase
    .from("operational_events")
    .select("id, event_type, occurred_at, entity_id, metadata, actor:team_members(name), client:clients(id, name)")
    .eq("organization_id", organizationId)
    .in("event_type", AGENCY_TIMELINE_EVENT_TYPES)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (filters.actorId) query = query.eq("actor_team_member_id", filters.actorId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);

  const { data } = await query;
  const rows = data ?? [];
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);

  return {
    hasMore,
    rows: visible.map((row) => {
      const eventType = row.event_type as OperationalEventType;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;

      return {
        id: row.id,
        eventType,
        occurredAt: row.occurred_at,
        clientId: row.client?.id ?? null,
        clientName: row.client?.name ?? null,
        actorName: row.actor?.name ?? null,
        label: OPERATIONAL_EVENT_TYPE_LABEL[eventType],
        detail: buildDetail(eventType, metadata),
      };
    }),
  };
}
