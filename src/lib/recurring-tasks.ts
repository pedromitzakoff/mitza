import type { OptimizationType } from "@/lib/supabase/database.types";

/**
 * Reformulação do sistema de tarefas (28/07): tarefa recorrente é um registro
 * PERMANENTE — nunca "conclui" (nasce e morre), "registra uma execução"
 * (histórico, `recurring_task_executions`). Substitui o modelo antigo de
 * `sprint_task_templates` (uma tarefa nova gerada toda sprint — ver
 * `supabase/global-sprint-task-templates.sql`, agora desativado pros 3
 * tipos oficiais em `supabase/recurring-tasks.sql`).
 *
 * Nenhum tipo de recorrência é hardcoded aqui: `recurring_tasks` é dado
 * (nome/ícone/cor/checklist), não enum de código — uma recorrência nova
 * (ex.: "Conferir Pixel") nasce só de um cadastro em /settings. A única
 * exceção é `uses_account_review` (reaproveita `account_reviews`/
 * `account_optimizations` por baixo, hoje só pra "Otimização") — isso é uma
 * integração de backend real, não uma preferência de UI, então não é algo
 * configurável livremente pelo admin.
 *
 * Três decisões do usuário fixam o comportamento abaixo (não são heurísticas
 * escolhidas por mim, são requisitos explícitos):
 *   - Meta semanal é única por sprint (nunca um intervalo min/max) —
 *     execução acima da meta só aparece como "5/4", sem penalização.
 *   - A meta é congelada por sprint: mudar a meta hoje nunca reabre o
 *     cálculo de uma sprint que já começou antes da mudança (por isso
 *     `resolveWeeklyGoalForSprint` resolve contra um histórico append-only,
 *     nunca contra "a meta atual").
 *   - A migração do modelo antigo não carrega pendências — o histórico de
 *     execuções começa vazio pra cada `recurring_tasks` novo.
 */

/**
 * Checklist padrão de Otimização (pedido explícito do usuário: só
 * checkboxes + observação, nada da complexidade de motivo/resultado/ação de
 * `account_reviews`/`account_optimizations`) — usado só pra semear os itens
 * da recorrência "Otimização" (a única com `uses_account_review = true`).
 * Cada `item_key` aqui PRECISA bater com um `OptimizationType` válido — é
 * assim que o backend sabe gravar em `account_optimizations`. Mapeia pros
 * tipos já existentes sempre que há equivalente direto — só "Remarketing"
 * não tinha um, por isso o tipo novo (`supabase/recurring-tasks.sql`). Toda
 * execução gravada por este checklist usa `optimization_action = 'OTHER'`
 * (o checklist não pergunta "qual ação", só "o que foi tocado").
 */
export const OPTIMIZATION_CHECKLIST_ITEMS: { type: OptimizationType; label: string }[] = [
  { type: "AUDIENCE", label: "Público" },
  { type: "CREATIVE", label: "Criativo" },
  { type: "CAMPAIGN", label: "Campanha" },
  { type: "BUDGET", label: "Orçamento" },
  { type: "PLACEMENT", label: "Posicionamento" },
  { type: "TRACKING", label: "Conversão" },
  { type: "REMARKETING", label: "Remarketing" },
];

export interface RecurringTaskGoalHistoryEntry {
  weeklyGoal: number;
  effectiveFrom: string;
}

/**
 * Meta vigente pra uma sprint = a entrada do histórico com o maior
 * `effectiveFrom` que ainda seja `<= sprint.start_date` — nunca a meta
 * "atual" do `recurring_tasks`. Isso é o que garante a meta congelada: uma
 * sprint que já começou antes de uma mudança de meta continua sendo julgada
 * pela meta que valia quando ela começou, para sempre.
 */
export function resolveWeeklyGoalForSprint(history: RecurringTaskGoalHistoryEntry[], sprintStartDate: string): number | null {
  const applicable = history
    .filter((entry) => entry.effectiveFrom.slice(0, 10) <= sprintStartDate)
    .sort((a, b) => (a.effectiveFrom > b.effectiveFrom ? -1 : 1));
  if (applicable.length > 0) return applicable[0].weeklyGoal;
  // Nenhuma entrada valia ainda no início da sprint (ex.: recurring_task foi
  // criado DEPOIS da sprint começar) — usa a primeira meta que veio a
  // existir, nunca `null` silencioso (evita "meta desconhecida" numa sprint
  // que claramente já tem uma tarefa recorrente ativa).
  const sorted = [...history].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  return sorted[0]?.weeklyGoal ?? null;
}

export interface WeeklyExecutionProgress {
  done: number;
  goal: number | null;
}

/** Conta quantas execuções caem dentro do período `[start_date, end_date]`
 * da sprint — `executedAt` é sempre um timestamp, comparado pelo dia civil
 * (`slice(0, 10)`) igual ao resto do projeto (`todayDateString`-style). */
export function computeWeeklyExecutionProgress(
  executions: { executedAt: string }[],
  sprint: { start_date: string; end_date: string },
  weeklyGoal: number | null,
): WeeklyExecutionProgress {
  const done = executions.filter((execution) => {
    const day = execution.executedAt.slice(0, 10);
    return day >= sprint.start_date && day <= sprint.end_date;
  }).length;
  return { done, goal: weeklyGoal };
}

export interface PreviousSprintPending {
  isPending: boolean;
  done: number;
  goal: number;
  missing: number;
}

/** Sem meta configurada (`goal === null`) nunca é "pendência" — só faz
 * sentido cobrar uma meta que de fato existia naquela sprint. */
export function computePreviousSprintPending(previousProgress: WeeklyExecutionProgress): PreviousSprintPending | null {
  if (previousProgress.goal === null) return null;
  const missing = Math.max(0, previousProgress.goal - previousProgress.done);
  return { isPending: missing > 0, done: previousProgress.done, goal: previousProgress.goal, missing };
}

/** "🔁 Otimização — 2/4 execuções nesta semana" — sem meta configurada, só
 * mostra a contagem bruta ("🔁 Otimização — 2 execuções nesta semana"). */
export function formatRecurringTaskBadge(title: string, progress: WeeklyExecutionProgress): string {
  const count = progress.goal === null ? `${progress.done} execuções nesta semana` : `${progress.done}/${progress.goal} execuções nesta semana`;
  return `🔁 ${title} — ${count}`;
}

/** "2 execuções não realizadas" / "1 execução não realizada" — usado só
 * dentro do drawer (bloco "Semana anterior"), nunca na listagem principal
 * (decisão do usuário, "Simplificar linha das recorrentes": pendência da
 * semana anterior deixou de competir com a próxima execução na linha).
 * Chamar só quando `pending.isPending` for true — sem missing, não há o que
 * mostrar. */
export function formatPreviousWeekMissingLine(pending: PreviousSprintPending): string {
  return `${pending.missing} execuç${pending.missing === 1 ? "ão não realizada" : "ões não realizadas"}`;
}

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(dateStr: string, days: number): string {
  const date = parseDateUTC(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 1 (segunda) a 7 (domingo) — ISO weekday a partir de uma data YYYY-MM-DD. */
function isoWeekday(dateStr: string): number {
  const day = parseDateUTC(dateStr).getUTCDay(); // 0=domingo..6=sábado
  return day === 0 ? 7 : day;
}

const BUSINESS_WEEKDAY_SHORT: Record<number, string> = { 1: "Segunda", 2: "Terça", 3: "Quarta", 4: "Quinta", 5: "Sexta" };
const BUSINESS_WEEKDAY_LONG: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
};

export interface NextExecution {
  /** Data (YYYY-MM-DD) da próxima execução esperada — `null` quando a meta
   * da semana já foi cumprida (`metGoal`) ou a recorrência ainda não tem
   * meta semanal configurada (nada a calcular). */
  date: string | null;
  /** A meta desta semana já foi cumprida (`done >= goal`) — nesse caso
   * `date` é sempre `null`, não há "próxima" a mostrar. */
  metGoal: boolean;
}

/**
 * Calcula a próxima execução esperada distribuindo a meta semanal pelos 5
 * dias úteis da sprint (segunda a sexta): a n-ésima execução "ideal" cai no
 * dia útil `floor(n * 5 / meta)` — meta 1 → sexta; meta 2 → terça e sexta;
 * meta 3 → segunda, quarta e sexta. A próxima é sempre a fatia seguinte à
 * última já feita (`done`); se essa fatia já ficou pra trás (hoje é depois
 * dela) e ainda falta execução, empurra pra HOJE — nunca aponta uma data que
 * já passou.
 *
 * Deliberadamente recalculada do zero a cada chamada (meta + `done`), nunca
 * armazenada — é isso que garante que a recorrência continua sendo UMA
 * tarefa só (decisão do usuário), nunca vira várias tarefas com prazo fixo.
 */
export function computeNextExecutionDate(
  sprint: { start_date: string },
  weeklyGoal: number | null,
  done: number,
  today: string,
): NextExecution {
  if (weeklyGoal === null) return { date: null, metGoal: false };
  if (done >= weeklyGoal) return { date: null, metGoal: true };

  const slotIndex = done + 1;
  const slotWeekday = Math.min(5, Math.max(1, Math.floor((slotIndex * 5) / weeklyGoal)));
  const slotDate = addDays(sprint.start_date, slotWeekday - 1);

  return { date: slotDate < today ? today : slotDate, metGoal: false };
}

/** "Hoje" / "Quarta" / "Meta batida" / "—" — rótulo compacto pra coluna
 * "Próxima execução" da listagem principal. */
export function formatNextExecutionLabel(nextExecution: NextExecution, today: string): string {
  if (nextExecution.metGoal) return "Meta batida";
  if (nextExecution.date === null) return "—";
  if (nextExecution.date === today) return "Hoje";
  return BUSINESS_WEEKDAY_SHORT[isoWeekday(nextExecution.date)] ?? "—";
}

/** "Hoje" / "Quarta-feira" / "Meta batida" / "—" — versão por extenso pro
 * resumo do drawer. */
export function formatNextExecutionLabelLong(nextExecution: NextExecution, today: string): string {
  if (nextExecution.metGoal) return "Meta batida";
  if (nextExecution.date === null) return "—";
  if (nextExecution.date === today) return "Hoje";
  return BUSINESS_WEEKDAY_LONG[isoWeekday(nextExecution.date)] ?? "—";
}
