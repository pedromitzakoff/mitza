import type { TaskOrigin, TaskPriority, TaskStatus, TaskType, TeamMemberStatus } from "@/lib/supabase/database.types";
import { TASK_PRIORITY_REGISTRY, TASK_STATUS_REGISTRY } from "@/lib/status-registry";

const VALID_STATUSES: readonly TaskStatus[] = [
  "pendente",
  "em_andamento",
  "aguardando",
  "bloqueado",
  "feito",
  "atrasado",
  "nao_realizado",
];
const VALID_PRIORITIES: readonly TaskPriority[] = ["urgente", "alta", "normal", "baixa"];
const VALID_QUICK_FILTERS: readonly PendenciaQuickFilter[] = ["abertas", "minhas", "aguardando", "concluidas"];
const VALID_GROUP_BY: readonly PendenciaGroupBy[] = ["status", "cliente", "responsavel", "prazo", "nenhum"];

/**
 * Núcleo puro da Etapa "Pendências" — filtro/agrupamento da listagem
 * central de tarefas (`/pendencias`), separado da busca de dados
 * (`pendencias-data.ts`) pro mesmo padrão já usado no projeto (ex.:
 * `client-funnels.ts` puro + `client-funnels-data.ts` de busca). Opera
 * sobre itens já com status EFETIVO calculado (`effectiveTaskStatus`,
 * chamado uma única vez na camada de dados) — nunca recalcula "atrasado"
 * aqui, só filtra/agrupa em cima do que já foi resolvido.
 */

export interface PendenciaClientRef {
  id: string;
  name: string;
}

export interface PendenciaAssigneeRef {
  id: string;
  name: string;
  status: TeamMemberStatus;
}

export interface PendenciaItem {
  id: string;
  title: string;
  type: TaskType;
  /** Status gravado de verdade no banco — nunca "atrasado" (isso é sempre
   * `status`, o efetivo). Só existe pra permitir reabrir/editar sabendo o
   * valor real por trás de um "Concluído"/"Não realizado". */
  rawStatus: TaskStatus;
  /** Status EFETIVO (`effectiveTaskStatus`) — o que a lista/agrupamento
   * usa pra tudo (filtro, badge, coluna "Atrasadas"). */
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  notes: string | null;
  sprintId: string | null;
  client: PendenciaClientRef | null;
  assignee: PendenciaAssigneeRef | null;
}

/** Etapa "Pendências — Demandas": recorte por STATUS (não mais por prazo —
 * "Atrasadas"/"Hoje"/"Esta semana" continuam plenamente acessíveis via
 * filtro de status/agrupamento por prazo, só deixaram de ser atalho de
 * primeira linha). "abertas" (default) = tudo que não é terminal; nenhum
 * recorte extra além da regra padrão de esconder concluídas. */
export type PendenciaQuickFilter = "abertas" | "minhas" | "aguardando" | "concluidas";
export type PendenciaGroupBy = "status" | "cliente" | "responsavel" | "prazo" | "nenhum";

export interface PendenciasFilterState {
  quickFilter: PendenciaQuickFilter;
  /** Cliente específico (combinável) — ignorado quando `internalOnly`. */
  clientId: string | null;
  /** "Interna" — pendência sem cliente (seção 8 do pedido). */
  internalOnly: boolean;
  assigneeId: string | null;
  /** Multi-seleção de status efetivo — vazio = todos. Selecionar
   * "Concluído"/"Não realizado" aqui SEMPRE os mostra, mesmo com
   * `includeCompleted` false (seleção explícita nunca é escondida). */
  statuses: TaskStatus[];
  /** Multi-seleção de prioridade — vazio = todas. */
  priorities: TaskPriority[];
  /** Mostra "Concluído"/"Não realizado" mesmo sem seleção explícita de
   * status — replica o toggle "mostrar concluídas" comum em listas de
   * tarefas. Default: false (lista nasce mostrando só o que está aberto). */
  includeCompleted: boolean;
}

export const DEFAULT_PENDENCIAS_FILTERS: PendenciasFilterState = {
  quickFilter: "abertas",
  clientId: null,
  internalOnly: false,
  assigneeId: null,
  statuses: [],
  priorities: [],
  includeCompleted: false,
};

export const DEFAULT_PENDENCIAS_GROUP_BY: PendenciaGroupBy = "status";

const INTERNAL_CLIENT_PARAM = "interna";

/** Lê o estado de filtro/agrupamento direto da query string (seção 3 do
 * pedido: "filtros preservados na URL") — nunca guarda em nenhum outro
 * lugar (localStorage, contexto React persistente): a URL é a única fonte
 * de verdade, o que também é o que torna a lista compartilhável/copiável. */
export function parsePendenciasFilters(params: URLSearchParams): PendenciasFilterState {
  const quick = params.get("quick");
  const clientParam = params.get("client");
  const statuses = params.getAll("status").filter((value): value is TaskStatus => (VALID_STATUSES as string[]).includes(value));
  const priorities = params.getAll("priority").filter((value): value is TaskPriority => (VALID_PRIORITIES as string[]).includes(value));

  return {
    quickFilter: quick && (VALID_QUICK_FILTERS as string[]).includes(quick) ? (quick as PendenciaQuickFilter) : DEFAULT_PENDENCIAS_FILTERS.quickFilter,
    clientId: clientParam && clientParam !== INTERNAL_CLIENT_PARAM ? clientParam : null,
    internalOnly: clientParam === INTERNAL_CLIENT_PARAM,
    assigneeId: params.get("assignee"),
    statuses,
    priorities,
    includeCompleted: params.get("done") === "1",
  };
}

export function parsePendenciasGroupBy(params: URLSearchParams): PendenciaGroupBy {
  const group = params.get("group");
  return group && (VALID_GROUP_BY as string[]).includes(group) ? (group as PendenciaGroupBy) : DEFAULT_PENDENCIAS_GROUP_BY;
}

/** Inverso de `parsePendenciasFilters`/`parsePendenciasGroupBy` — usado
 * pra reescrever a URL (`history.replaceState`, sem navegação/reload) a
 * cada mudança de filtro. Omite qualquer chave no valor padrão, pra manter
 * a URL curta quando nada foi customizado. */
export function serializePendenciasFilters(filters: PendenciasFilterState, groupBy: PendenciaGroupBy): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.quickFilter !== DEFAULT_PENDENCIAS_FILTERS.quickFilter) params.set("quick", filters.quickFilter);
  if (filters.internalOnly) params.set("client", INTERNAL_CLIENT_PARAM);
  else if (filters.clientId) params.set("client", filters.clientId);
  if (filters.assigneeId) params.set("assignee", filters.assigneeId);
  for (const status of filters.statuses) params.append("status", status);
  for (const priority of filters.priorities) params.append("priority", priority);
  if (filters.includeCompleted) params.set("done", "1");
  if (groupBy !== DEFAULT_PENDENCIAS_GROUP_BY) params.set("group", groupBy);
  return params;
}

/** Domingo (fim da semana ISO, seguindo o mesmo padrão de segunda-a-domingo
 * já usado no resto da plataforma) a partir de uma data YYYY-MM-DD. */
export function endOfWeek(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay(); // 1=segunda..7=domingo
  date.setUTCDate(date.getUTCDate() + (7 - isoWeekday));
  return date.toISOString().slice(0, 10);
}

const TERMINAL_STATUSES: TaskStatus[] = ["feito", "nao_realizado"];

export interface PendenciasFilterContext {
  /** YYYY-MM-DD, fuso da agência (`todayDateString()`). */
  today: string;
  /** team_members.id de quem está logado — resolve o quick filter
   * "Minhas". `null` só deveria ocorrer em contexto de teste sem sessão. */
  currentTeamMemberId: string | null;
}

/**
 * Filtro combinável (seção 3 do pedido: quick filters + filtros por
 * dimensão, ambos ativos ao mesmo tempo) — nunca dois sistemas de filtro
 * concorrentes, um só predicado aplicado item a item.
 */
export function filterPendencias(
  items: PendenciaItem[],
  filters: PendenciasFilterState,
  context: PendenciasFilterContext,
): PendenciaItem[] {
  const explicitlyShowsCompleted = filters.statuses.some((status) => TERMINAL_STATUSES.includes(status));
  const quickFilterShowsCompleted = filters.quickFilter === "concluidas";

  return items.filter((item) => {
    if (filters.internalOnly) {
      if (item.client !== null) return false;
    } else if (filters.clientId) {
      if (item.client?.id !== filters.clientId) return false;
    }

    if (filters.assigneeId && item.assignee?.id !== filters.assigneeId) return false;

    switch (filters.quickFilter) {
      case "minhas":
        if (!context.currentTeamMemberId || item.assignee?.id !== context.currentTeamMemberId) return false;
        break;
      case "aguardando":
        if (item.status !== "aguardando") return false;
        break;
      case "concluidas":
        if (!TERMINAL_STATUSES.includes(item.status)) return false;
        break;
      case "abertas":
        break;
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes(item.status)) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(item.priority)) return false;

    if (!filters.includeCompleted && !explicitlyShowsCompleted && !quickFilterShowsCompleted && TERMINAL_STATUSES.includes(item.status)) {
      return false;
    }

    return true;
  });
}

/** Campos do original lidos do banco antes de duplicar (seção 6 do pedido
 * "Pendências — Segunda Rodada"). */
export interface PendenciaDuplicateSource {
  client_id: string | null;
  title: string;
  type: TaskType;
  assignee_id: string | null;
  due_date: string;
  priority: TaskPriority;
  notes: string | null;
}

/** Campos da nova linha a inserir — sem `original_due_date` (isso é
 * responsabilidade de `withOriginalDueDate`, aplicado por cima do
 * resultado desta função, nunca duplicado aqui). */
export interface PendenciaDuplicateRow {
  client_id: string | null;
  title: string;
  type: TaskType;
  assignee_id: string | null;
  due_date: string;
  priority: TaskPriority;
  notes: string | null;
  sprint_id: null;
  status: TaskStatus;
  origin: TaskOrigin;
}

/**
 * Regra pura de duplicação (seção 6 do pedido) — extraída de
 * `duplicateTasksAction` pra ser testável sem banco. Copia
 * título/descrição/cliente/responsável/prioridade/prazo; NUNCA copia
 * comentários/histórico/timestamps/identidade original (a nova linha nem
 * carrega `id` — quem chama recebe um id novo do INSERT). Status inicial
 * sempre "pendente" (nunca herdado — mesmo raciocínio de `reopenTaskAction`,
 * que também sempre volta pra "pendente"). `origin: "manual"` sempre —
 * duplicar é, em si, um ato humano explícito, mesmo quando o original era
 * `origin: "template"`.
 */
export function buildDuplicateTaskRow(original: PendenciaDuplicateSource): PendenciaDuplicateRow {
  return {
    client_id: original.client_id,
    title: original.title,
    type: original.type,
    assignee_id: original.assignee_id,
    due_date: original.due_date,
    priority: original.priority,
    notes: original.notes,
    sprint_id: null,
    status: "pendente",
    origin: "manual",
  };
}

function sortPendencias(items: PendenciaItem[]): PendenciaItem[] {
  return [...items].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    const priorityDiff = TASK_PRIORITY_REGISTRY[`task_priority.${a.priority}`].order - TASK_PRIORITY_REGISTRY[`task_priority.${b.priority}`].order;
    if (priorityDiff !== 0) return priorityDiff;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

export interface PendenciaGroup {
  key: string;
  label: string;
  items: PendenciaItem[];
}

const PRAZO_BUCKET_ORDER = ["atrasadas", "hoje", "semana", "depois"] as const;
const PRAZO_BUCKET_LABEL: Record<(typeof PRAZO_BUCKET_ORDER)[number], string> = {
  atrasadas: "Atrasadas",
  hoje: "Hoje",
  semana: "Esta semana",
  depois: "Mais adiante",
};

function prazoBucket(item: PendenciaItem, today: string, weekEnd: string): (typeof PRAZO_BUCKET_ORDER)[number] {
  if (item.status === "atrasado") return "atrasadas";
  if (item.dueDate === today) return "hoje";
  if (item.dueDate > today && item.dueDate <= weekEnd) return "semana";
  return "depois";
}

/**
 * Agrupamento configurável (seção 4 do pedido) — sempre reordena por
 * `sortPendencias` dentro de cada grupo (prazo, depois prioridade, depois
 * título); a ORDEM DOS GRUPOS segue uma sequência fixa e previsível (nunca
 * alfabética pra status/prazo, que têm uma progressão natural), exceto
 * cliente/responsável (alfabética, com "Interna"/"Sem responsável" sempre
 * por último).
 */
export function groupPendencias(items: PendenciaItem[], groupBy: PendenciaGroupBy, today: string): PendenciaGroup[] {
  const sorted = sortPendencias(items);

  if (groupBy === "nenhum") {
    return sorted.length > 0 ? [{ key: "todas", label: "Todas", items: sorted }] : [];
  }

  if (groupBy === "status") {
    const buckets = new Map<TaskStatus, PendenciaItem[]>();
    for (const item of sorted) {
      const list = buckets.get(item.status) ?? [];
      list.push(item);
      buckets.set(item.status, list);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => TASK_STATUS_REGISTRY[`task.${a}`].order - TASK_STATUS_REGISTRY[`task.${b}`].order)
      .map(([status, groupItems]) => ({
        key: status,
        label: TASK_STATUS_REGISTRY[`task.${status}`].label,
        items: groupItems,
      }));
  }

  if (groupBy === "prazo") {
    const weekEnd = endOfWeek(today);
    const buckets = new Map<(typeof PRAZO_BUCKET_ORDER)[number], PendenciaItem[]>();
    for (const item of sorted) {
      const bucket = prazoBucket(item, today, weekEnd);
      const list = buckets.get(bucket) ?? [];
      list.push(item);
      buckets.set(bucket, list);
    }
    return PRAZO_BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
      key: bucket,
      label: PRAZO_BUCKET_LABEL[bucket],
      items: buckets.get(bucket) ?? [],
    }));
  }

  if (groupBy === "cliente") {
    const buckets = new Map<string, { label: string; items: PendenciaItem[] }>();
    for (const item of sorted) {
      const key = item.client?.id ?? "__internal__";
      const label = item.client?.name ?? "Interna";
      const entry = buckets.get(key) ?? { label, items: [] };
      entry.items.push(item);
      buckets.set(key, entry);
    }
    return Array.from(buckets.entries())
      .sort(([keyA, a], [keyB, b]) => {
        if (keyA === "__internal__") return 1;
        if (keyB === "__internal__") return -1;
        return a.label.localeCompare(b.label, "pt-BR");
      })
      .map(([key, { label, items: groupItems }]) => ({ key, label, items: groupItems }));
  }

  // responsavel
  const buckets = new Map<string, { label: string; items: PendenciaItem[] }>();
  for (const item of sorted) {
    const key = item.assignee?.id ?? "__unassigned__";
    const label = item.assignee?.name ?? "Sem responsável";
    const entry = buckets.get(key) ?? { label, items: [] };
    entry.items.push(item);
    buckets.set(key, entry);
  }
  return Array.from(buckets.entries())
    .sort(([keyA, a], [keyB, b]) => {
      if (keyA === "__unassigned__") return 1;
      if (keyB === "__unassigned__") return -1;
      return a.label.localeCompare(b.label, "pt-BR");
    })
    .map(([key, { label, items: groupItems }]) => ({ key, label, items: groupItems }));
}
