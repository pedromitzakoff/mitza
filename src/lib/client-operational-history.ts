import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";

/**
 * "Histórico de {mês}" do Acompanhamento da Conta (Etapa 62, seção 9 do
 * pedido) — unifica análises, otimizações, reuniões e entregas de criativo
 * numa única lista cronológica. Reaproveita 100% `operational_events`
 * (nenhum evento novo, nenhuma tabela nova): cada análise já emite
 * exatamente 1 `account_review_recorded`, cada otimização já emite 1
 * `account_optimization_recorded` (ver supabase/account-reviews.sql) —
 * nunca inclui os eventos "outcome-specific"
 * (`account_review_no_change`/`_optimization_performed`/`_issue_identified`),
 * que duplicariam a mesma análise como uma segunda linha. Meeting/entrega
 * só entram aqui quando já têm desfecho (completed/cancelled/late) —
 * agendamento em si não é "histórico", é o que já aparece como "próxima".
 */
const HISTORY_EVENT_TYPES = [
  "account_review_recorded",
  "account_optimization_recorded",
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
  /** id da account_review, só quando o evento se refere a uma análise ou
   * otimização — usado pra "Ver análise" abrir o mesmo drawer de sempre
   * (nunca duplica a lógica de detalhe da análise). */
  reviewId: string | null;
}

const EVENT_LABEL: Record<ClientHistoryEventType, string> = {
  account_review_recorded: "Análise",
  account_optimization_recorded: "Otimização",
  meeting_completed: "Reunião realizada",
  meeting_cancelled: "Reunião não realizada",
  creative_delivery_completed: "Entrega realizada",
  creative_delivery_late: "Entrega não realizada",
};

const HISTORY_PAGE_SIZE = 15;

function buildDetail(eventType: ClientHistoryEventType, metadata: Record<string, unknown>): string | null {
  if (eventType === "account_optimization_recorded") {
    const type = metadata.optimization_type;
    return typeof type === "string" && type in OPTIMIZATION_TYPE_LABEL
      ? OPTIMIZATION_TYPE_LABEL[type as keyof typeof OPTIMIZATION_TYPE_LABEL]
      : null;
  }
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
      const isReviewRelated = row.entity_type === "account_review" || row.entity_type === "account_optimization";
      const reviewId = eventType === "account_review_recorded"
        ? row.entity_id
        : eventType === "account_optimization_recorded"
          ? (typeof metadata.account_review_id === "string" ? metadata.account_review_id : null)
          : null;

      return {
        id: row.id,
        eventType,
        occurredAt: row.occurred_at,
        responsibleName: row.actor?.name ?? null,
        label: EVENT_LABEL[eventType],
        detail: buildDetail(eventType, metadata),
        reviewId: isReviewRelated ? reviewId : null,
      };
    }),
  };
}
