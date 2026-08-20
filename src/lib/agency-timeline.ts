import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperationalEventType, TaskType } from "@/lib/supabase/database.types";
import { OperationalEventType as EventType, OPERATIONAL_EVENT_TYPE_LABEL } from "@/lib/operational-events";
import { buildReviewDetail, fetchOptimizationActionsByReviewId } from "@/lib/client-operational-history";

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

/** Rótulo humano de `task_completed` a partir de `metadata.task_type`
 * (Auditoria da Timeline — "task_completed mais humano"): deixa claro que a
 * conclusão veio de uma tarefa avulsa, nunca reaproveita o rótulo de
 * "Otimização"/"Report" usado pelos fluxos estruturados (revisão/
 * `client_reports`) — confundiria os dois caminhos que a própria auditoria
 * identificou como paralelos. `reuniao`/`entrega_criativo` não entram neste
 * mapa de propósito: esse `task_completed` é removido antes de chegar aqui
 * (ver dedupe em `fetchAgencyTimeline`) porque o evento específico
 * (`meeting_completed`/`creative_delivery_completed`) já representa a mesma
 * conclusão — mostrar os dois duplicaria a mesma ação. `outro` (e qualquer
 * tipo ausente/desconhecido, ex. evento histórico) cai no rótulo genérico de
 * sempre, com o título como detalhe — comportamento inalterado. */
const TASK_COMPLETED_TYPE_LABEL: Partial<Record<TaskType, string>> = {
  verificacao_saldo: "Saldo conferido",
  report: "Tarefa de report concluída",
  otimizacao: "Tarefa de otimização concluída",
};

/** Exportado só pra teste (`scripts/test-timeline-detail.ts`) — lógica pura,
 * sem I/O, cobre os cenários E-H do pedido de humanização de `task_completed`. */
export function buildTaskCompletedPresentation(metadata: Record<string, unknown>): { label: string; detail: string | null } {
  const taskType = typeof metadata.task_type === "string" ? (metadata.task_type as TaskType) : null;
  const title = typeof metadata.task_title === "string" ? metadata.task_title : null;
  const typeLabel = taskType ? TASK_COMPLETED_TYPE_LABEL[taskType] : undefined;

  if (!typeLabel) return { label: OPERATIONAL_EVENT_TYPE_LABEL[EventType.TASK_COMPLETED], detail: title };

  // Evita repetir a mesma informação duas vezes quando o título não passa do
  // nome do próprio tipo (ex.: tarefa recorrente antiga nunca renomeada).
  const isTitleRedundant = title !== null && title.trim().toLowerCase() === typeLabel.trim().toLowerCase();
  return { label: typeLabel, detail: isTitleRedundant ? null : title };
}

/** Exportado só pra teste (`scripts/test-timeline-detail.ts`) — decide se
 * uma linha `task_completed` de reunião/entrega de criativo deve ser
 * suprimida porque o evento específico correlacionado
 * (`meeting_completed`/`creative_delivery_completed`) já está no mesmo lote
 * (mesmo `correlation_id`, ver `complete_task_and_record_event`). Os demais
 * `task_type` (`verificacao_saldo`/`report`/`otimizacao`/`outro`) nunca têm
 * um evento específico correlacionado — nunca são suprimidos aqui. */
export function shouldSuppressDuplicateTaskCompleted(
  metadata: Record<string, unknown>,
  correlationId: string | null,
  siblingCorrelationIds: Set<string>,
): boolean {
  if (metadata.task_type !== "reuniao" && metadata.task_type !== "entrega_criativo") return false;
  return correlationId !== null && siblingCorrelationIds.has(correlationId);
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
    .select(
      "id, event_type, occurred_at, entity_id, correlation_id, metadata, actor:team_members(name), client:clients(id, name)",
    )
    .eq("organization_id", organizationId)
    .in("event_type", AGENCY_TIMELINE_EVENT_TYPES)
    .order("occurred_at", { ascending: false })
    .range(from, to);

  if (filters.actorId) query = query.eq("actor_team_member_id", filters.actorId);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);

  const { data } = await query;
  const rawRows = data ?? [];
  const hasMore = rawRows.length > pageSize;
  const pageRows = rawRows.slice(0, pageSize);

  // Reunião/entrega de criativo concluídas emitem `task_completed` +
  // `meeting_completed`/`creative_delivery_completed` correlacionados na
  // mesma transação (ver `complete_task_and_record_event`, ambos já dentro
  // de `AGENCY_TIMELINE_EVENT_TYPES`) — sem isso, a mesma conclusão vira
  // duas linhas. Checa contra `rawRows` (inclui a linha "a mais" da
  // paginação) pra pegar até um par que caia bem na borda da página; a
  // exclusão em si só corta de `pageRows`, nunca muda `range`/offset.
  const completedSiblingCorrelationIds = new Set(
    rawRows
      .filter((row) => row.event_type === EventType.MEETING_COMPLETED || row.event_type === EventType.CREATIVE_DELIVERY_COMPLETED)
      .map((row) => row.correlation_id)
      .filter((id): id is string => id != null),
  );

  const visible = pageRows.filter((row) => {
    if (row.event_type !== EventType.TASK_COMPLETED) return true;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return !shouldSuppressDuplicateTaskCompleted(metadata, row.correlation_id, completedSiblingCorrelationIds);
  });

  const reviewIds = visible
    .filter((row) => row.event_type === EventType.ACCOUNT_REVIEW_RECORDED)
    .map((row) => row.entity_id);
  const optimizationActionsByReviewId = await fetchOptimizationActionsByReviewId(supabase, reviewIds);

  return {
    hasMore,
    rows: visible.map((row) => {
      const eventType = row.event_type as OperationalEventType;
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const base = {
        id: row.id,
        eventType,
        occurredAt: row.occurred_at,
        clientId: row.client?.id ?? null,
        clientName: row.client?.name ?? null,
        actorName: row.actor?.name ?? null,
      };

      if (eventType === EventType.TASK_COMPLETED) {
        return { ...base, ...buildTaskCompletedPresentation(metadata) };
      }

      return {
        ...base,
        label: OPERATIONAL_EVENT_TYPE_LABEL[eventType],
        detail:
          eventType === EventType.ACCOUNT_REVIEW_RECORDED
            ? buildReviewDetail(metadata, optimizationActionsByReviewId.get(row.entity_id ?? ""))
            : null,
      };
    }),
  };
}
