import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperationalEventType, TaskType } from "@/lib/supabase/database.types";
import { OperationalEventType as EventType, OPERATIONAL_EVENT_TYPE_LABEL } from "@/lib/operational-events";
import { buildReviewPresentation, fetchOptimizationActionsByReviewId, type ReviewPresentation } from "@/lib/client-operational-history";
import { formatEventReference, parseEventRelation, type EventRelation } from "@/lib/event-reference";

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
 *
 * Etapa "Timeline 2.0": a página separada "Conquistas" (`/achievements`)
 * deixa de ser um destino de produto — os acontecimentos positivos que ela
 * mostrava (`achievement_unlocked`, motor intocado em `achievement-engine.ts`)
 * passam a aparecer AQUI, na mesma linha do tempo das ações humanas, sob a
 * família `"performance"` (nunca `"acao"` — distinção estrutural, seção 2 do
 * pedido: AÇÃO HUMANA ≠ RESULTADO OBSERVADO). Nenhum motor novo: esta função
 * só lê `metadata.headline`/`detail` do mesmo evento que o cron já grava
 * (`record_achievement_event`, `supabase/achievements.sql`) — a MESMA leitura
 * que `achievements-data.ts#toRow` já faz, sem duplicar a lógica de parse
 * (os dois arquivos leem o mesmo formato de metadata porque o formato é
 * canônico, não porque um importa o outro — inverter essa dependência
 * acoplaria a Timeline a uma página que deixou de existir).
 *
 * Toda conquista já persistida é, hoje, um acontecimento POSITIVO (patamar
 * atingido, meta batida, recuperação confirmada — nenhum detector emite algo
 * negativo ainda). `performanceTone: "positivo"` reflete esse fato honesto,
 * nunca uma suposição — o dia em que existir um detector negativo
 * (documentado como próxima fase no relatório desta etapa), ele populará
 * `"atencao"` pelo mesmo campo, sem precisar de nenhuma mudança estrutural
 * aqui.
 */
const PERFORMANCE_EVENT_TYPES: OperationalEventType[] = [EventType.ACHIEVEMENT_UNLOCKED];

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

/** Etapa "Timeline 2.0" (seção 2 do pedido, princípio central): distinção
 * ESTRUTURAL entre ação humana e resultado observado — nunca inferida do
 * texto na UI. `"acao"` = qualquer tipo de `AGENCY_TIMELINE_EVENT_TYPES`
 * (alguém fez algo); `"performance"` = automático, hoje só `achievement_unlocked`. */
export type AgencyTimelineEventFamily = "acao" | "performance";

/** Só existe quando `family === "performance"`. Todo `achievement_unlocked`
 * já persistido é positivo (ver comentário de `PERFORMANCE_EVENT_TYPES`
 * acima) — `"atencao"` é reservado pro primeiro detector negativo (próxima
 * fase, ver relatório da etapa), nunca fabricado aqui. */
export type PerformanceTone = "positivo" | "atencao";

export interface AgencyTimelineRow {
  id: string;
  eventType: OperationalEventType;
  family: AgencyTimelineEventFamily;
  occurredAt: string;
  clientId: string | null;
  clientName: string | null;
  actorName: string | null;
  label: string;
  detail: string | null;
  /** Etapa "Histórico de Decisões Operacionais" (seção 8/9 do pedido) — só
   * presente em `account_review_recorded`; quando presente, a página
   * desenha a hierarquia de 3 níveis (diagnóstico/ações/observação) em vez
   * de `label`/`detail`. `label`/`detail` continuam preenchidos pra este
   * evento (nunca ficam `undefined`) só por consistência de tipo — a UI
   * simplesmente não os usa quando `reviewPresentation` existe. */
  reviewPresentation?: ReviewPresentation;
  /** Só presente em `family === "performance"`. */
  performanceTone?: PerformanceTone;
  /** Etapa "Timeline 2.0" (seção 11) — referência humana curta e ESTÁVEL
   * (`#EVT-XXXXXXXX`, derivada do próprio `id`, nunca de posição na lista —
   * ver `lib/event-reference.ts`). Sempre presente, em toda linha. */
  eventReference: string;
  /** Etapa "Timeline 2.0" (seção 12) — relação temporal com outro evento,
   * quando o `metadata` já carrega uma (`related_event_id`/`relation_type`).
   * `null` pra praticamente todo evento hoje: nenhum detector desta etapa
   * ainda escreve essa relação (arquitetura pronta, população fica pra
   * próxima fase — ver relatório). Nunca afirma causalidade (seção 3) — só
   * "ocorreu depois de". */
  relation: EventRelation | null;
}

/** Filtro "Tipo" (seção 10 do pedido) — recorte por CIMA da curadoria de
 * `AGENCY_TIMELINE_EVENT_TYPES` de sempre, nunca uma segunda lista de
 * eventos "soltos". "Tarefas" não é uma categoria própria de propósito: sob
 * a curadoria atual só existe `task_completed` (tarefa avulsa, tipo
 * genérico "outro") junto de marcos de reunião/criativo/saldo — poucos
 * tipos, já rotulados individualmente, sem volume/semântica suficiente pra
 * merecer filtro isolado (auditado por código antes de decidir, nunca uma
 * categoria inventada sem consumidor real). */
export type AgencyTimelineType = "todos" | "otimizacoes" | "reports" | "outros";

export const AGENCY_TIMELINE_TYPE_LABEL: Record<AgencyTimelineType, string> = {
  todos: "Todos",
  otimizacoes: "Otimizações",
  reports: "Reports",
  outros: "Outros",
};
export const AGENCY_TIMELINE_TYPE_OPTIONS: { value: AgencyTimelineType; label: string }[] = [
  { value: "todos", label: AGENCY_TIMELINE_TYPE_LABEL.todos },
  { value: "otimizacoes", label: AGENCY_TIMELINE_TYPE_LABEL.otimizacoes },
  { value: "reports", label: AGENCY_TIMELINE_TYPE_LABEL.reports },
  { value: "outros", label: AGENCY_TIMELINE_TYPE_LABEL.outros },
];

const OTIMIZACOES_EVENT_TYPES: OperationalEventType[] = [EventType.ACCOUNT_REVIEW_RECORDED];
const REPORTS_EVENT_TYPES: OperationalEventType[] = [EventType.CLIENT_REPORT_GENERATED, EventType.CLIENT_REPORT_SENT];
const OUTROS_EVENT_TYPES: OperationalEventType[] = AGENCY_TIMELINE_EVENT_TYPES.filter(
  (type) => !OTIMIZACOES_EVENT_TYPES.includes(type) && !REPORTS_EVENT_TYPES.includes(type),
);

/** Resolve `?type=` da URL pra um `AgencyTimelineType` seguro — mesmo padrão
 * de fallback já usado por `resolveOperationChannel`/`resolveOperationGoal`
 * (Operação): valor ausente/inválido cai em `"todos"`, nunca um recorte
 * "chutado". Exportado só pra teste. */
export function resolveAgencyTimelineType(paramValue: string | undefined): AgencyTimelineType {
  return paramValue === "otimizacoes" || paramValue === "reports" || paramValue === "outros" ? paramValue : "todos";
}

/** Exportado só pra teste (`scripts/test-account-review-diagnosis.ts`) —
 * confirma que Otimizações/Reports/Outros particionam
 * `AGENCY_TIMELINE_EVENT_TYPES` sem sobreposição nem perda de tipo. */
export function eventTypesForFilter(type: AgencyTimelineType): OperationalEventType[] {
  if (type === "otimizacoes") return OTIMIZACOES_EVENT_TYPES;
  if (type === "reports") return REPORTS_EVENT_TYPES;
  if (type === "outros") return OUTROS_EVENT_TYPES;
  return AGENCY_TIMELINE_EVENT_TYPES;
}

/** Etapa "Timeline 2.0" (seção 7 do pedido): experiência simples "Todos |
 * Ações | Performance" — uma dimensão nova, ORTOGONAL ao filtro "Tipo"
 * (`AgencyTimelineType`, que continua só recortando DENTRO das ações).
 * `"acoes"` = só `AGENCY_TIMELINE_EVENT_TYPES` (curadoria de sempre);
 * `"performance"` = só `PERFORMANCE_EVENT_TYPES` (ignora o filtro "Tipo",
 * que não faz sentido pra conquista); `"todos"` = os dois juntos, "Tipo"
 * ainda recortando a parte de ações — "a história completa intercalada
 * cronologicamente" (pedido explícito), nunca duas listas separadas. */
export type AgencyTimelineFamilyFilter = "todos" | "acoes" | "performance";

export const AGENCY_TIMELINE_FAMILY_LABEL: Record<AgencyTimelineFamilyFilter, string> = {
  todos: "Todos",
  acoes: "Ações",
  performance: "Performance",
};
export const AGENCY_TIMELINE_FAMILY_OPTIONS: { value: AgencyTimelineFamilyFilter; label: string }[] = [
  { value: "todos", label: AGENCY_TIMELINE_FAMILY_LABEL.todos },
  { value: "acoes", label: AGENCY_TIMELINE_FAMILY_LABEL.acoes },
  { value: "performance", label: AGENCY_TIMELINE_FAMILY_LABEL.performance },
];

/** Resolve `?family=` da URL — mesmo padrão de fallback seguro de sempre:
 * valor ausente/inválido cai em `"todos"`. Exportado só pra teste. */
export function resolveAgencyTimelineFamily(paramValue: string | undefined): AgencyTimelineFamilyFilter {
  return paramValue === "acoes" || paramValue === "performance" ? paramValue : "todos";
}

/** Combina família + tipo num único `.in()` da query — nunca duas queries
 * nem filtro em memória. Exportado só pra teste. */
export function eventTypesForFilters(family: AgencyTimelineFamilyFilter, type: AgencyTimelineType): OperationalEventType[] {
  if (family === "performance") return PERFORMANCE_EVENT_TYPES;
  const actionTypes = eventTypesForFilter(type);
  if (family === "acoes") return actionTypes;
  return [...actionTypes, ...PERFORMANCE_EVENT_TYPES];
}

export interface AgencyTimelineFilters {
  /** `null` = todos os gestores — `actor_team_member_id`, quem EXECUTOU a
   * ação (mesmo critério já usado em `fetchTeamMemberTimeline`), não a
   * carteira do cliente. */
  actorId: string | null;
  clientId: string | null;
  /** Etapa "Histórico de Decisões Operacionais" — recorte por tipo de
   * evento (seção 10 do pedido). Combina livremente com gestor/cliente
   * (todos viram `.eq()`/`.in()` na MESMA query, nunca filtro em memória). */
  type: AgencyTimelineType;
  /** Etapa "Timeline 2.0" — Ações/Performance/Todos (ver `AgencyTimelineFamilyFilter`). */
  family: AgencyTimelineFamilyFilter;
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

/** Um único evento, buscado direto pelo `id` real (nunca pela referência
 * curta — ver `lib/event-reference.ts`) — usado só pra mostrar o evento
 * RELACIONADO de outra linha (`row.relation`), que pode estar em qualquer
 * página/fora do filtro atual. `null` = evento não encontrado (id inválido,
 * ou de outra organização — a mesma policy de RLS de sempre já impede ver
 * evento de outra organização; aqui o filtro explícito por `organizationId`
 * é só defesa em profundidade, nunca a única barreira). */
export interface AgencyTimelineEventById {
  id: string;
  eventReference: string;
  label: string;
  detail: string | null;
  clientName: string | null;
  occurredAt: string;
}

export async function fetchAgencyTimelineEventById(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  id: string,
): Promise<AgencyTimelineEventById | null> {
  const { data } = await supabase
    .from("operational_events")
    .select("id, event_type, occurred_at, metadata, client:clients(name)")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const eventType = data.event_type as OperationalEventType;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const isPerformance = eventType === EventType.ACHIEVEMENT_UNLOCKED;

  return {
    id: data.id,
    eventReference: formatEventReference(data.id),
    label: isPerformance && typeof metadata.headline === "string" ? metadata.headline : OPERATIONAL_EVENT_TYPE_LABEL[eventType],
    detail: isPerformance && typeof metadata.detail === "string" ? metadata.detail : null,
    clientName: data.client?.name ?? null,
    occurredAt: data.occurred_at,
  };
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
    .in("event_type", eventTypesForFilters(filters.family, filters.type))
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
      const family: AgencyTimelineEventFamily = eventType === EventType.ACHIEVEMENT_UNLOCKED ? "performance" : "acao";
      const base = {
        id: row.id,
        eventType,
        family,
        occurredAt: row.occurred_at,
        clientId: row.client?.id ?? null,
        clientName: row.client?.name ?? null,
        actorName: row.actor?.name ?? null,
        eventReference: formatEventReference(row.id),
        relation: parseEventRelation(metadata),
      };

      // Etapa "Timeline 2.0": conquista já persistida — só LÊ o headline/
      // detail que o motor já gravou (`record_achievement_event`), nunca
      // recalcula. Mesmo formato de metadata que `achievements-data.ts#toRow`
      // já lê (`headline`/`detail`), aqui só pra apresentação na Timeline.
      if (family === "performance") {
        return {
          ...base,
          label: typeof metadata.headline === "string" ? metadata.headline : OPERATIONAL_EVENT_TYPE_LABEL[eventType],
          detail: typeof metadata.detail === "string" ? metadata.detail : null,
          performanceTone: "positivo" as PerformanceTone,
        };
      }

      if (eventType === EventType.TASK_COMPLETED) {
        return { ...base, ...buildTaskCompletedPresentation(metadata) };
      }

      if (eventType === EventType.ACCOUNT_REVIEW_RECORDED) {
        const reviewPresentation = buildReviewPresentation(metadata, optimizationActionsByReviewId.get(row.entity_id ?? ""));
        return {
          ...base,
          label: OPERATIONAL_EVENT_TYPE_LABEL[eventType],
          detail: null,
          reviewPresentation: reviewPresentation ?? undefined,
        };
      }

      return { ...base, label: OPERATIONAL_EVENT_TYPE_LABEL[eventType], detail: null };
    }),
  };
}
