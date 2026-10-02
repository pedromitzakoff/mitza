import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperationalEventType, TaskOrigin } from "@/lib/supabase/database.types";
import { OperationalEventType as EventType } from "@/lib/operational-events";
import { fetchAgencyEvents, type PerformanceTone } from "@/lib/agency-timeline";
import type { ReviewPresentation } from "@/lib/client-operational-history";

/**
 * Timeline do CLIENTE (Etapa "MEGA FACELIFT — Fase 6: Timeline") — "o que
 * aconteceu com este cliente?", a memória do Growth. Reaproveita 100%
 * `fetchAgencyEvents` (`lib/agency-timeline.ts`, já aceita `clientId` — a
 * MESMA função que "/timeline" usa pra agência inteira): nenhuma segunda
 * query a `operational_events`, nenhuma segunda regra de dedupe de
 * task_completed/meeting/criativo, nenhuma segunda leitura de
 * `account_optimizations` — tudo isso já vem pronto da função canônica. A
 * única coisa genuinamente NOVA aqui é a TAXONOMIA por categoria pedida pra
 * esta tela (Planejamento/Operação/Demandas/Performance/Conta, derivada dos
 * `event_type` reais, nunca inventada) e a resolução de `tasks.origin` pra
 * separar DEMANDA (origin='manual') de item operacional (origin='template')
 * dentro do mesmo `task_created`/`task_completed`/`task_reopened` — a única
 * ambiguidade real encontrada na auditoria (seção 12 do pedido: "preservar
 * tasks.origin, nunca misturar Demandas com tasks operacionais/template na
 * mesma semântica").
 *
 * Auditoria completa (ver relatório de entrega) confirmou: NENHUM evento de
 * planejamento de meta (`client_goals`), funil (`client_funnels`/
 * `campaign_funnel_assignments`) ou sincronização de Dados (`import_sources`/
 * `data_sync_runs`) existe em `operational_events` hoje — por isso nenhum
 * deles aparece aqui. Documentado como GAP (seção 23 do pedido), nunca
 * fabricado retroativamente.
 */

export type ClientTimelineCategory = "todos" | "planejamento" | "operacao" | "demandas" | "performance" | "conta";

export const CLIENT_TIMELINE_CATEGORY_OPTIONS: ClientTimelineCategory[] = [
  "todos",
  "planejamento",
  "operacao",
  "demandas",
  "performance",
  "conta",
];

export const CLIENT_TIMELINE_CATEGORY_LABEL: Record<ClientTimelineCategory, string> = {
  todos: "Todos",
  planejamento: "Planejamento",
  operacao: "Operação",
  demandas: "Demandas",
  performance: "Performance",
  conta: "Conta",
};

/** Resolve `?category=` da URL — mesmo padrão de fallback seguro já usado em
 * `resolveAgencyTimelineType`/`resolveOperationChannel`: valor ausente ou
 * desconhecido cai em "todos", nunca um recorte chutado. */
export function resolveClientTimelineCategory(paramValue: string | undefined): ClientTimelineCategory {
  return (CLIENT_TIMELINE_CATEGORY_OPTIONS as string[]).includes(paramValue ?? "") ? (paramValue as ClientTimelineCategory) : "todos";
}

/** Mapa estático — a imensa maioria dos `event_type` da taxonomia não tem
 * ambiguidade nenhuma (ao contrário de task_created/completed/reopened,
 * tratados separadamente abaixo via `tasks.origin`). Derivado da auditoria
 * real de cada evento (ver relatório, seção E) — nunca uma categoria
 * inventada sem um evento real por trás. */
const STATIC_EVENT_CATEGORY: Partial<Record<OperationalEventType, Exclude<ClientTimelineCategory, "todos">>> = {
  [EventType.MONTHLY_BUDGET_CREATED]: "planejamento",
  [EventType.MONTHLY_BUDGET_CHANGED]: "planejamento",

  [EventType.ACCOUNT_REVIEW_RECORDED]: "operacao",
  [EventType.MEETING_COMPLETED]: "operacao",
  [EventType.CREATIVE_DELIVERY_COMPLETED]: "operacao",

  [EventType.ACHIEVEMENT_UNLOCKED]: "performance",

  [EventType.CLIENT_CREATED]: "conta",
  [EventType.CLIENT_STATUS_CHANGED]: "conta",
  [EventType.CLIENT_MANAGER_ASSIGNED]: "conta",
  [EventType.CLIENT_MANAGER_CHANGED]: "conta",
  [EventType.MONTHLY_REPORT_STARTED]: "conta",
  [EventType.MONTHLY_REPORT_READY_FOR_REVIEW]: "conta",
  [EventType.MONTHLY_REPORT_FINALIZED]: "conta",
  [EventType.MONTHLY_REPORT_REOPENED]: "conta",
  [EventType.CLIENT_UPDATE_GENERATED]: "conta",
  [EventType.CLIENT_UPDATE_MARKED_SENT]: "conta",
  [EventType.CLIENT_REPORT_GENERATED]: "conta",
  [EventType.CLIENT_REPORT_SENT]: "conta",
};

/** `task_created`/`task_completed`/`task_reopened`: o ÚNICO `event_type`
 * cuja categoria depende de um dado fora do próprio evento (`tasks.origin`).
 * `task_assigned`/`task_reassigned`/`task_due_date_changed`/`task_deleted`
 * ficam de fora de propósito (seção 12/21 do pedido: "Timeline não deve
 * virar espelho de todas as interações de Demandas" — CRUD granular de
 * tarefa não ajuda reconstruir a história do Growth; "responsável alterado"
 * do exemplo do pedido é entendido aqui como `client_manager_changed`, o
 * gestor DA CONTA, não o assignee de uma tarefa pontual). */
const TASK_DERIVED_EVENT_TYPES: OperationalEventType[] = [EventType.TASK_CREATED, EventType.TASK_COMPLETED, EventType.TASK_REOPENED];

const ALL_CLIENT_TIMELINE_EVENT_TYPES: OperationalEventType[] = [
  ...(Object.keys(STATIC_EVENT_CATEGORY) as OperationalEventType[]),
  ...TASK_DERIVED_EVENT_TYPES,
];

const OPERACAO_EVENT_TYPES: OperationalEventType[] = [
  EventType.ACCOUNT_REVIEW_RECORDED,
  EventType.MEETING_COMPLETED,
  EventType.CREATIVE_DELIVERY_COMPLETED,
  EventType.TASK_COMPLETED,
];

/** `tasks.origin` ausente (tarefa excluída — `TASK_DELETED` não entra na
 * Timeline, mas a linha original `task_completed`/`task_reopened` dela
 * continua existindo em `operational_events`, append-only) cai em "operacao"
 * — a opção mais neutra/menos proeminente, nunca assumida como Demanda sem
 * prova. Documentado como decisão explícita, nunca um bug silencioso. */
function resolveTaskDerivedCategory(origin: TaskOrigin | null): "demandas" | "operacao" {
  return origin === "manual" ? "demandas" : "operacao";
}

function categoryEventTypes(category: ClientTimelineCategory): OperationalEventType[] {
  if (category === "todos") return ALL_CLIENT_TIMELINE_EVENT_TYPES;
  if (category === "demandas") return TASK_DERIVED_EVENT_TYPES;
  if (category === "operacao") return OPERACAO_EVENT_TYPES;
  return (Object.keys(STATIC_EVENT_CATEGORY) as OperationalEventType[]).filter((type) => STATIC_EVENT_CATEGORY[type] === category);
}

export interface ClientTimelineEventLink {
  href: string;
  /** Texto do CTA ("Ver Demanda →", "Ver Metas →") — sempre específico do
   * destino real, nunca um "Ver mais →" genérico (seção 11 do pedido). */
  label: string;
}

/** Destino de navegação real por `event_type` (seção 11 do pedido: "nunca
 * criar link genérico só para ter CTA, somente quando soubermos o destino
 * correto"). `achievement_unlocked` e qualquer tipo fora deste mapa
 * devolvem `null` de propósito — não existe uma tela de "Conquistas"
 * dedicada (migrou pra dentro da própria Timeline, Etapa "Timeline 2.0"). */
function resolveClientTimelineEventLink(
  clientId: string,
  eventType: OperationalEventType,
  category: Exclude<ClientTimelineCategory, "todos">,
): ClientTimelineEventLink | null {
  switch (eventType) {
    case EventType.MONTHLY_BUDGET_CREATED:
    case EventType.MONTHLY_BUDGET_CHANGED:
      return { href: `/clients/${clientId}/metas`, label: "Ver Metas →" };
    case EventType.ACCOUNT_REVIEW_RECORDED:
    case EventType.MEETING_COMPLETED:
    case EventType.CREATIVE_DELIVERY_COMPLETED:
      return { href: `/clients/${clientId}/operation`, label: "Ver Operação →" };
    case EventType.TASK_CREATED:
    case EventType.TASK_COMPLETED:
    case EventType.TASK_REOPENED:
      return category === "demandas"
        ? { href: `/clients/${clientId}/demandas`, label: "Ver Demanda →" }
        : { href: `/clients/${clientId}/operation`, label: "Ver Operação →" };
    case EventType.MONTHLY_REPORT_STARTED:
    case EventType.MONTHLY_REPORT_READY_FOR_REVIEW:
    case EventType.MONTHLY_REPORT_FINALIZED:
    case EventType.MONTHLY_REPORT_REOPENED:
    case EventType.CLIENT_REPORT_GENERATED:
    case EventType.CLIENT_REPORT_SENT:
      return { href: `/reports/${clientId}`, label: "Ver Relatório →" };
    case EventType.CLIENT_UPDATE_GENERATED:
    case EventType.CLIENT_UPDATE_MARKED_SENT:
      return { href: `/clients/${clientId}`, label: "Ver Painel →" };
    case EventType.CLIENT_CREATED:
    case EventType.CLIENT_STATUS_CHANGED:
    case EventType.CLIENT_MANAGER_ASSIGNED:
    case EventType.CLIENT_MANAGER_CHANGED:
      return { href: `/clients/${clientId}/edit`, label: "Ver Configurações →" };
    default:
      return null;
  }
}

/** Rótulo humano de um evento derivado de tarefa — só sobrescreve quando a
 * categoria resolvida é "demandas" (seção 7 do pedido: `task_completed`
 * nunca deve virar texto principal; `buildTaskCompletedPresentation`,
 * `lib/agency-timeline.ts`, já cobre bem o caso "operacao" com rótulos por
 * `task_type` — nunca duplicado/sobrescrito aqui). `taskTitle` vem do MESMO
 * lote que resolve `origin` (`tasks.select("id, origin, title")`), nunca uma
 * segunda consulta — cobre inclusive `task_reopened`, cujo metadata não
 * carrega `task_title` (achado da auditoria, seção F do relatório). */
function buildTaskDerivedLabel(
  eventType: OperationalEventType,
  category: "demandas" | "operacao",
  taskTitle: string | null,
  fallback: { label: string; detail: string | null },
): { label: string; detail: string | null } {
  if (category !== "demandas") return fallback;
  const label =
    eventType === EventType.TASK_CREATED ? "Demanda criada" : eventType === EventType.TASK_REOPENED ? "Demanda reaberta" : "Demanda concluída";
  return { label, detail: taskTitle ?? fallback.detail };
}

export interface ClientTimelineRow {
  id: string;
  eventType: OperationalEventType;
  category: Exclude<ClientTimelineCategory, "todos">;
  occurredAt: string;
  actorName: string | null;
  label: string;
  detail: string | null;
  reviewPresentation?: ReviewPresentation;
  performanceTone?: PerformanceTone;
  eventReference: string;
  link: ClientTimelineEventLink | null;
}

const CLIENT_TIMELINE_PAGE_SIZE = 20;

/** Página da Timeline de UM cliente, mais recente primeiro — mesma
 * paginação (busca 1 a mais, corta, usa a sobra pra `hasMore`) que
 * `fetchAgencyEvents` já implementa, nunca uma segunda estratégia. Quando
 * `category` recorta um `event_type` ambíguo (task_*), a visibilidade final
 * é decidida DEPOIS da resolução de `origin` — por isso uma página pode
 * devolver menos de `pageSize` linhas mesmo com `hasMore = true` (ex.:
 * filtro "Demandas" numa página onde metade dos `task_completed` buscados
 * eram, na verdade, itens operacionais de template) — comportamento honesto
 * (nunca mistura categoria errada só pra preencher a página), documentado
 * como limitação conhecida no relatório da etapa, nunca um bug. */
export async function fetchClientTimelinePage(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  clientId: string,
  category: ClientTimelineCategory,
  page = 0,
  pageSize = CLIENT_TIMELINE_PAGE_SIZE,
): Promise<{ rows: ClientTimelineRow[]; hasMore: boolean }> {
  const { rows, truncated } = await fetchAgencyEvents(supabase, organizationId, {
    eventTypes: categoryEventTypes(category),
    clientId,
    limit: pageSize,
    offset: page * pageSize,
  });

  const taskIds = Array.from(
    new Set(rows.filter((row) => TASK_DERIVED_EVENT_TYPES.includes(row.eventType)).map((row) => row.entityId)),
  );
  const taskById = new Map<string, { origin: TaskOrigin; title: string }>();
  if (taskIds.length > 0) {
    const { data } = await supabase.from("tasks").select("id, origin, title").in("id", taskIds);
    for (const task of data ?? []) taskById.set(task.id, { origin: task.origin, title: task.title });
  }

  const mapped: ClientTimelineRow[] = rows.map((row) => {
    const isTaskDerived = TASK_DERIVED_EVENT_TYPES.includes(row.eventType);
    const task = isTaskDerived ? (taskById.get(row.entityId) ?? null) : null;

    const resolvedCategory: Exclude<ClientTimelineCategory, "todos"> = isTaskDerived
      ? resolveTaskDerivedCategory(task?.origin ?? null)
      : STATIC_EVENT_CATEGORY[row.eventType] ?? "conta";

    const { label, detail } = isTaskDerived
      ? buildTaskDerivedLabel(row.eventType, resolvedCategory as "demandas" | "operacao", task?.title ?? null, { label: row.label, detail: row.detail })
      : { label: row.label, detail: row.detail };

    return {
      id: row.id,
      eventType: row.eventType,
      category: resolvedCategory,
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      label,
      detail,
      reviewPresentation: row.reviewPresentation,
      performanceTone: row.performanceTone,
      eventReference: row.eventReference,
      link: resolveClientTimelineEventLink(clientId, row.eventType, resolvedCategory),
    };
  });

  const visible = category === "todos" ? mapped : mapped.filter((row) => row.category === category);

  return { rows: visible, hasMore: truncated };
}
