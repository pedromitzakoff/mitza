import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";

/**
 * "Histórico de {mês}" do Acompanhamento da Conta (Etapa 62, seção 9 do
 * pedido) — unifica otimizações, reuniões e entregas de criativo numa única
 * lista cronológica. Reaproveita 100% `operational_events` (nenhum evento
 * novo, nenhuma tabela nova): cada otimização (revisão estratégica da
 * conta) já emite exatamente 1 `account_review_recorded`, mesmo quando teve
 * uma ou mais alterações técnicas registradas (`account_optimizations`) —
 * por isso `account_optimization_recorded` NUNCA entra aqui (Etapa 74,
 * seção 11: uma otimização com 2 alterações não pode virar 3 linhas de
 * histórico; o detalhe da(s) alteração(ões) já vem no metadata do próprio
 * `account_review_recorded`, ver `buildReviewDetail` abaixo). Também nunca
 * inclui os eventos "outcome-specific"
 * (`account_review_no_change`/`_optimization_performed`/`_issue_identified`),
 * que duplicariam a mesma otimização como uma segunda linha. Meeting/entrega
 * só entram aqui quando já têm desfecho (completed/cancelled/late) —
 * agendamento em si não é "histórico", é o que já aparece como "próxima".
 */
const HISTORY_EVENT_TYPES = [
  "account_review_recorded",
  "meeting_completed",
  "meeting_cancelled",
  "creative_delivery_completed",
  "creative_delivery_late",
] as const;

export type ClientHistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export interface ClientHistoryRow {
  id: string;
  eventType: ClientHistoryEventType;
  occurredAt: string;
  responsibleName: string | null;
  label: string;
  detail: string | null;
  /** id da account_review, só quando o evento se refere a uma otimização —
   * usado pra "Ver otimização" abrir o mesmo drawer de sempre (nunca
   * duplica a lógica de detalhe). */
  reviewId: string | null;
}

const EVENT_LABEL: Record<ClientHistoryEventType, string> = {
  account_review_recorded: "Otimização",
  meeting_completed: "Reunião realizada",
  meeting_cancelled: "Reunião não realizada",
  creative_delivery_completed: "Entrega realizada",
  creative_delivery_late: "Entrega não realizada",
};

const HISTORY_PAGE_SIZE = 15;

/** Detalhe compacto de uma otimização a partir do próprio metadata do
 * `account_review_recorded` (outcome + tipos de alteração já gravados ali,
 * ver record_account_review em supabase/account-reviews.sql) — nunca uma
 * segunda consulta a account_optimizations só pra isso. */
/** Exportado (Timeline Geral da Agência, `lib/agency-timeline.ts`) — mesmo
 * detalhe de revisão/otimização usado aqui, nenhuma segunda leitura de
 * metadata pra chegar no mesmo texto. */
export function buildReviewDetail(metadata: Record<string, unknown>): string | null {
  const outcome = metadata.outcome;
  if (typeof outcome !== "string" || !(outcome in ACCOUNT_REVIEW_OUTCOME_LABEL)) return null;
  const outcomeLabel = ACCOUNT_REVIEW_OUTCOME_LABEL[outcome as AccountReviewOutcome];

  if (outcome === "OPTIMIZATION_PERFORMED") {
    const types = Array.isArray(metadata.optimization_types) ? metadata.optimization_types : [];
    if (types.length === 1 && typeof types[0] === "string" && types[0] in OPTIMIZATION_TYPE_LABEL) {
      return `${outcomeLabel} · ${OPTIMIZATION_TYPE_LABEL[types[0] as OptimizationType]}`;
    }
    if (types.length > 1) return `${outcomeLabel} · ${types.length} alterações`;
  }

  return outcomeLabel;
}

function buildDetail(eventType: ClientHistoryEventType, metadata: Record<string, unknown>): string | null {
  if (eventType === "account_review_recorded") return buildReviewDetail(metadata);
  return null;
}

/** Página do histórico unificado de um cliente, dentro (ou não) de um
 * intervalo de datas — `monthRange` omitido busca todo o histórico
 * (usado por "Ver todos de {mês}" com paginação; o card compacto sempre
 * passa o mês selecionado). Mesma paginação por range já usada em
 * `fetchTeamMemberTimeline`, nenhum padrão novo. */
export async function fetchClientOperationalHistory(
  supabase: SupabaseClient<Database>,
  clientId: string,
  monthRange: { firstDay: string; lastDay: string },
  page = 0,
  pageSize = HISTORY_PAGE_SIZE,
): Promise<{ rows: ClientHistoryRow[]; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize; // busca 1 a mais só pra saber se há próxima página

  const { data } = await supabase
    .from("operational_events")
    .select("id, event_type, occurred_at, entity_type, entity_id, metadata, actor:team_members(name)")
    .eq("client_id", clientId)
    .in("event_type", HISTORY_EVENT_TYPES)
    .gte("occurred_at", `${monthRange.firstDay}T00:00:00Z`)
    .lte("occurred_at", `${monthRange.lastDay}T23:59:59.999Z`)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  const rows = data ?? [];
  const hasMore = rows.length > pageSize;
  const visible = rows.slice(0, pageSize);

  return {
    hasMore,
    rows: visible.map((row) => {
      const eventType = row.event_type as ClientHistoryEventType;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const reviewId = eventType === "account_review_recorded" ? row.entity_id : null;

      return {
        id: row.id,
        eventType,
        occurredAt: row.occurred_at,
        responsibleName: row.actor?.name ?? null,
        label: EVENT_LABEL[eventType],
        detail: buildDetail(eventType, metadata),
        reviewId,
      };
    }),
  };
}
