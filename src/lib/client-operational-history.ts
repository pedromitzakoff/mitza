import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_ACTION_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";

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

/** Item estruturado de uma otimização (`account_optimizations`), usado só
 * pra montar o texto de detalhe — nunca pra decidir estado (a tabela
 * continua sendo a fonte de verdade, isso aqui é leitura de apresentação). */
export interface OptimizationActionDetail {
  type: OptimizationType;
  action: string;
  quantity: number;
}

/** Busca em lote as otimizações de um conjunto de revisões (Auditoria da
 * Timeline — "informação desperdiçada", seção 4/9: `optimization_action` já
 * existe em `account_optimizations`, só não era lido). Uma única query
 * `.in(account_review_id, ids)` pros ids já presentes na página atual —
 * nunca N+1, nunca busca por revisão isolada. `reviewIds` vazio não bate no
 * banco. */
export async function fetchOptimizationActionsByReviewId(
  supabase: SupabaseClient<Database>,
  reviewIds: string[],
): Promise<Map<string, OptimizationActionDetail[]>> {
  const map = new Map<string, OptimizationActionDetail[]>();
  if (reviewIds.length === 0) return map;

  const { data } = await supabase
    .from("account_optimizations")
    .select("account_review_id, optimization_type, optimization_action, quantity")
    .in("account_review_id", reviewIds)
    .order("created_at", { ascending: true });

  for (const row of data ?? []) {
    const list = map.get(row.account_review_id) ?? [];
    list.push({ type: row.optimization_type, action: row.optimization_action, quantity: row.quantity });
    map.set(row.account_review_id, list);
  }

  return map;
}

const OPTIMIZATION_ITEMS_INLINE_LIMIT = 3;
const OPTIMIZATION_ITEMS_TRUNCATED_SHOWN = 2;

/** Texto de um item ("Substituiu criativo", "Aumentou orçamento ×2") —
 * reaproveita só os labels já existentes (`OPTIMIZATION_ACTION_LABEL`/
 * `OPTIMIZATION_TYPE_LABEL`), nunca inventa texto novo. Ação desconhecida
 * (evento histórico com valor fora do mapa) cai pro tipo sozinho, nunca
 * mostra a string bruta nem quebra a renderização. */
function formatOptimizationItem(item: OptimizationActionDetail): string {
  const typeLabel = OPTIMIZATION_TYPE_LABEL[item.type] as string | undefined;
  const actionLabel = OPTIMIZATION_ACTION_LABEL[item.action] as string | undefined;
  const quantitySuffix = item.quantity > 1 ? ` ×${item.quantity}` : "";

  if (actionLabel && typeLabel) return `${actionLabel} ${typeLabel.toLowerCase()}${quantitySuffix}`;
  if (typeLabel) return `${typeLabel}${quantitySuffix}`;
  return "Otimização";
}

/** Detalhe compacto de uma otimização. Prioriza as ações reais já buscadas
 * em lote (`actions`, via `fetchOptimizationActionsByReviewId`) — "Substituiu
 * criativo · Aumentou orçamento" em vez de só "Criativo". Sem esse lote (ex.:
 * chamador que ainda não busca `account_optimizations`, ou revisão sem
 * itens resolvidos), cai pro fallback histórico: só os tipos já gravados no
 * metadata do próprio `account_review_recorded` (nunca uma segunda leitura
 * pra isso). Nunca lê `account_optimization_recorded`/eventos
 * outcome-specific — uma revisão continua sendo uma unidade só de leitura,
 * nunca N linhas. Exportado (Timeline Geral, `lib/agency-timeline.ts`) —
 * mesmo texto nas duas Timelines. */
export function buildReviewDetail(metadata: Record<string, unknown>, actions?: OptimizationActionDetail[]): string | null {
  const outcome = metadata.outcome;
  if (typeof outcome !== "string" || !(outcome in ACCOUNT_REVIEW_OUTCOME_LABEL)) return null;
  const outcomeLabel = ACCOUNT_REVIEW_OUTCOME_LABEL[outcome as AccountReviewOutcome];

  if (outcome === "OPTIMIZATION_PERFORMED") {
    if (actions && actions.length > 0) {
      const items = actions.map(formatOptimizationItem);
      const list =
        items.length <= OPTIMIZATION_ITEMS_INLINE_LIMIT
          ? items.join(" · ")
          : `${items.slice(0, OPTIMIZATION_ITEMS_TRUNCATED_SHOWN).join(" · ")} · +${items.length - OPTIMIZATION_ITEMS_TRUNCATED_SHOWN} alterações`;
      return `${outcomeLabel} · ${list}`;
    }

    // Fallback: evento histórico (ou lote ainda não buscado pelo chamador) —
    // só os tipos já salvos no metadata da própria revisão.
    const types = Array.isArray(metadata.optimization_types) ? metadata.optimization_types : [];
    if (types.length === 1 && typeof types[0] === "string" && types[0] in OPTIMIZATION_TYPE_LABEL) {
      return `${outcomeLabel} · ${OPTIMIZATION_TYPE_LABEL[types[0] as OptimizationType]}`;
    }
    if (types.length > 1) return `${outcomeLabel} · ${types.length} alterações`;
  }

  return outcomeLabel;
}

function buildDetail(eventType: ClientHistoryEventType, metadata: Record<string, unknown>, actions?: OptimizationActionDetail[]): string | null {
  if (eventType === "account_review_recorded") return buildReviewDetail(metadata, actions);
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

  const reviewIds = visible
    .filter((row) => row.event_type === "account_review_recorded")
    .map((row) => row.entity_id);
  const optimizationActionsByReviewId = await fetchOptimizationActionsByReviewId(supabase, reviewIds);

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
        detail: buildDetail(eventType, metadata, reviewId ? optimizationActionsByReviewId.get(reviewId) : undefined),
        reviewId,
      };
    }),
  };
}
