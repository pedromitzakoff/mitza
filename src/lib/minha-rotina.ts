import type { TaskPriority, TaskStatus } from "@/lib/supabase/database.types";
import type { AgencyTree, AgencyTreeClient } from "@/lib/agency-accounts-tree";

/**
 * MITZA ONE — Minha Rotina. Núcleo puro, sem Supabase — consolida DUAS
 * fontes estruturalmente diferentes (auditoria da Fase 0):
 *
 * - DEMANDAS (`tasks`, origin="manual"): têm `due_date` real e status
 *   efetivo real (`effectiveTaskStatus`, `lib/task-status.ts`) — "atrasada"
 *   é um estado genuíno pra elas.
 * - ROTINAS (`recurring_tasks`/`recurring_task_executions`): são processos
 *   PERMANENTES com meta SEMANAL por sprint, nunca "vencem" — o que existe é
 *   uma "próxima execução esperada" (`computeNextExecutionDate`,
 *   `lib/recurring-tasks.ts`), sempre hoje ou um dia futuro desta sprint,
 *   NUNCA no passado (um slot que já passou simplesmente vira "hoje"). Por
 *   isso Rotina nunca entra no balde "atrasada" aqui — esse estado não
 *   existe pra ela, e fabricar um seria inventar um dado que o sistema não
 *   garante (decisão explícita do usuário, "Não inventar datas ou atrasos
 *   para Rotinas").
 *
 * Cada Rotina pendente já chega aqui como UM item por (cliente, rotina) —
 * `computeNextExecutionDate` só devolve a PRÓXIMA execução, nunca os N
 * slots que ainda faltam pra bater a meta da semana (decisão do usuário:
 * "sem multiplicar visualmente os slots de execução").
 */

export type MinhaRotinaBucket = "atrasada" | "hoje" | "semana" | "depois";

export interface MinhaRotinaDemandaItem {
  kind: "demanda";
  id: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  dueDate: string;
  /** Status efetivo (`effectiveTaskStatus`) — nunca recalculado aqui. */
  status: TaskStatus;
  priority: TaskPriority;
  bucket: MinhaRotinaBucket;
}

export interface MinhaRotinaRotinaItem {
  kind: "rotina";
  /** `recurring_tasks.id` */
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  /** Sprint em que a próxima execução foi calculada — necessário pra abrir
   * o drawer oficial (`RecurringTaskDrawer`/`fetchRecurringTaskDetail`),
   * que é escopado por sprint. `sprintStartDate`/`sprintEndDate` (datas
   * REAIS da sprint, não só o id) são o que `fetchRecurringTaskDetail`
   * precisa pra resolver a meta vigente e recortar "execuções desta
   * semana" corretamente — nunca um intervalo fabricado de 1 dia. */
  sprintId: string;
  sprintStartDate: string;
  sprintEndDate: string;
  /** "Hoje" / nome do dia da semana — igual ao resto da plataforma
   * (`formatNextExecutionLabel`), nunca uma data inventada. */
  nextExecutionLabel: string;
  /** Sempre hoje ou um dia futuro desta sprint — nunca no passado (ver nota
   * do módulo). Só existe pra ordenar/bucketizar; o rótulo exibido é
   * sempre `nextExecutionLabel`. */
  dueDate: string;
  /** Rotina pendente nunca é "atrasada" nem "depois" (sprint é sempre a
   * semana corrente) — só "hoje" ou "semana". */
  bucket: "hoje" | "semana";
  progress: { done: number; goal: number | null };
  /** Registrável em UM clique (sem checklist, sem integração de
   * Otimização/Report) — `!hasChecklist && !usesAccountReview && !usesReport`. */
  canOneClick: boolean;
  hasChecklist: boolean;
  usesAccountReview: boolean;
  usesReport: boolean;
}

export type MinhaRotinaItem = MinhaRotinaDemandaItem | MinhaRotinaRotinaItem;

/**
 * MITZA ONE — Minha Rotina (Fase 4 do pedido, "regra correta" proposta na
 * auditoria e aprovada pelo usuário): `clients_select`/`tasks_select` são
 * RLS COLABORATIVAS (`auth.uid() is not null`, ver
 * `supabase/operation-collaboration-rls.sql`) — qualquer gestor logado já
 * LÊ a árvore inteira da agência, de propósito (Operação exige isso). Minha
 * Rotina não muda essa leitura nem pede uma RLS nova: ela só escolhe, no
 * SERVIDOR, qual fatia da árvore já resolvida (`loadAgencyAccountsTree`,
 * agrupada por `primary_manager_id` desde sempre) pertence ao gestor
 * logado — a mesma função que a Sidebar já usa, só que em vez de achatar
 * TODOS os gestores (`flattenAgencyTree`), pega só o bucket do gestor
 * atual. Nunca "isolamento de segurança" (a leitura subjacente continua
 * colaborativa) — é um recorte de PRODUTO, calculado antes de qualquer
 * dado chegar ao cliente.
 */
export function resolveMyClients(tree: AgencyTree, teamMemberId: string): AgencyTreeClient[] {
  return tree.managers.find((manager) => manager.id === teamMemberId)?.clients ?? [];
}

/** Domingo (fim de semana ISO) a partir de uma data YYYY-MM-DD — MESMA
 * fórmula de `lib/pendencias.ts#endOfWeek`, duplicada aqui de propósito (é
 * uma função de 4 linhas sem estado; importar do módulo de Pendências só
 * pra isso criaria um acoplamento entre duas telas que não compartilham
 * mais nada) em vez de uma terceira implementação divergente. */
export function endOfWeek(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (7 - isoWeekday));
  return date.toISOString().slice(0, 10);
}

/** MESMA regra de balde que `lib/pendencias.ts#prazoBucket` — "atrasada" só
 * quando o status EFETIVO já é "atrasado" (nunca comparando datas de novo
 * aqui, pra não divergir de `effectiveTaskStatus`). */
export function demandaBucket(item: { status: TaskStatus; dueDate: string }, today: string, weekEnd: string): MinhaRotinaBucket {
  if (item.status === "atrasado") return "atrasada";
  if (item.dueDate === today) return "hoje";
  if (item.dueDate > today && item.dueDate <= weekEnd) return "semana";
  return "depois";
}

/** Rotina pendente nunca é "atrasada": `nextExecutionDate` (sempre hoje ou
 * um dia futuro da sprint corrente, ver `computeNextExecutionDate`) só pode
 * cair em "hoje" ou, no máximo, até o fim desta semana civil — uma sprint
 * típica (segunda a sexta) nunca ultrapassa `weekEnd` de qualquer forma,
 * mas o `Math.min` abaixo é uma segunda camada de defesa caso uma sprint
 * atípica (ex.: configurada manualmente) se estenda além do domingo. */
export function rotinaBucket(nextExecutionDate: string, today: string): "hoje" | "semana" {
  return nextExecutionDate === today ? "hoje" : "semana";
}

export interface MinhaRotinaCounts {
  /** Demandas + Rotinas com `bucket === "hoje"`. */
  today: number;
  /** Só Demandas com `bucket === "atrasada"` — Rotinas não têm vencimento
   * real, nunca contam aqui (decisão explícita do usuário). */
  overdue: number;
  /** Demandas + Rotinas com `bucket === "semana"` (resto da semana, sem
   * contar hoje de novo — cada indicador é mutuamente exclusivo dos
   * outros, mesma convenção de `lib/pendencias.ts#groupPendencias`). */
  week: number;
}

export function computeMinhaRotinaCounts(items: MinhaRotinaItem[]): MinhaRotinaCounts {
  let today = 0;
  let overdue = 0;
  let week = 0;
  for (const item of items) {
    if (item.bucket === "hoje") today += 1;
    else if (item.bucket === "semana") week += 1;
    else if (item.kind === "demanda" && item.bucket === "atrasada") overdue += 1;
  }
  return { today, overdue, week };
}

export type MinhaRotinaQuickFilter = "hoje" | "atrasadas" | "semana" | "todas";
export const DEFAULT_MINHA_ROTINA_QUICK_FILTER: MinhaRotinaQuickFilter = "todas";

/** Filtro combinável (quick filter de balde + busca livre por cliente/
 * título) — nunca dois sistemas de filtro concorrentes, um só predicado
 * aplicado item a item, mesmo padrão de `lib/pendencias.ts#filterPendencias`. */
export function filterMinhaRotinaItems(items: MinhaRotinaItem[], quickFilter: MinhaRotinaQuickFilter, search: string): MinhaRotinaItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    switch (quickFilter) {
      case "hoje":
        if (item.bucket !== "hoje") return false;
        break;
      case "atrasadas":
        if (item.kind !== "demanda" || item.bucket !== "atrasada") return false;
        break;
      case "semana":
        if (item.bucket !== "semana") return false;
        break;
      case "todas":
        break;
    }

    if (!normalizedSearch) return true;
    const clientName = item.clientName ?? "";
    return item.title.toLowerCase().includes(normalizedSearch) || clientName.toLowerCase().includes(normalizedSearch);
  });
}

const VALID_QUICK_FILTERS: readonly MinhaRotinaQuickFilter[] = ["hoje", "atrasadas", "semana", "todas"];

export interface MinhaRotinaFilterState {
  quickFilter: MinhaRotinaQuickFilter;
  search: string;
}

/** Lê o estado de filtro direto da query string — MESMO princípio de
 * `lib/pendencias.ts#parsePendenciasFilters` ("a URL é a única fonte de
 * verdade", nunca localStorage/contexto), versão enxuta (só os 2 campos que
 * esta tela tem: balde + busca livre). */
export function parseMinhaRotinaFilters(params: URLSearchParams): MinhaRotinaFilterState {
  const quick = params.get("quick");
  return {
    quickFilter: quick && (VALID_QUICK_FILTERS as string[]).includes(quick) ? (quick as MinhaRotinaQuickFilter) : DEFAULT_MINHA_ROTINA_QUICK_FILTER,
    search: params.get("q") ?? "",
  };
}

/** Inverso de `parseMinhaRotinaFilters` — usado pra reescrever a URL
 * (`history.replaceState`, sem navegação) a cada mudança de filtro, e pra
 * montar o `returnTo` que as ações de conclusão/registro recebem (fecha o
 * drawer/termina a submissão de volta na MESMA view filtrada, nunca
 * resetando pra "Todas"). */
export function serializeMinhaRotinaFilters(filters: MinhaRotinaFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.quickFilter !== DEFAULT_MINHA_ROTINA_QUICK_FILTER) params.set("quick", filters.quickFilter);
  if (filters.search.trim()) params.set("q", filters.search);
  return params;
}

const BUCKET_ORDER: Record<MinhaRotinaBucket, number> = { atrasada: 0, hoje: 1, semana: 2, depois: 3 };

export function sortMinhaRotinaItems(items: MinhaRotinaItem[]): MinhaRotinaItem[] {
  return [...items].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucketDiff !== 0) return bucketDiff;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.title.localeCompare(b.title, "pt-BR");
  });
}

const WEEKDAY_LONG: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
  7: "Domingo",
};

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "Hoje" / "Amanhã" / "Sexta-feira" / data completa (`formatShortDate`,
 * quando fora da janela de 7 dias ou já atrasada — mostra a data real em
 * vez de um rótulo relativo impreciso). Só pra DEMANDAS (Rotina já tem seu
 * próprio `nextExecutionLabel`, oficial, nunca recalculado aqui). */
export function formatMinhaRotinaDemandaDueLabel(dueDate: string, today: string): string {
  if (dueDate < today) return dueDate;
  if (dueDate === today) return "Hoje";
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
  const diffDays = Math.round((dueMs - todayMs) / 86_400_000);
  if (diffDays === 1) return "Amanhã";
  if (diffDays <= 7) return WEEKDAY_LONG[isoWeekday(dueDate)] ?? dueDate;
  return dueDate;
}
