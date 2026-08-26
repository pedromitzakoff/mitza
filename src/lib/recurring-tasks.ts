import type { OptimizationType } from "@/lib/supabase/database.types";

/** Cor padrão sugerida ao cadastrar uma recorrência nova (`<input
 * type="color">` sem seleção prévia) — livre escolha do admin depois, nunca
 * imposta. Etapa "Identidade Visual KOFF": era o azul antigo da marca
 * (#4169E1, hardcoded em 2 lugares — form e Server Action); centralizado
 * aqui e atualizado pro grafite novo (mesmo valor de `--brand`), único
 * lugar que precisa mudar se a cor de marca mudar de novo. */
export const DEFAULT_RECURRING_TASK_COLOR = "#1C1C1C";

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
 * Registro rápido de Otimização (refatoração posterior, decisão do usuário:
 * "o gestor não pensa em categorias, pensa nas decisões que tomou"). Nada de
 * checklist de categorias genéricas com ação sempre "Outro" — cada chip já É
 * a decisão (tipo + ação real), pensado pra registrar em menos de 10
 * segundos. `type`/`action` PRECISAM bater com `OptimizationType`/
 * `OPTIMIZATION_ACTIONS_BY_TYPE` (`@/lib/account-reviews`) — é assim que o
 * backend grava em `account_optimizations` (mesma tabela e função da
 * Análise da Conta manual, `record_account_review`; aqui só uma seleção
 * curada de combinações, pensada pra ser rápida, não o formulário completo).
 * Fixo no código de propósito (não é dado configurável em /settings) — é
 * método operacional da agência, mesmo espírito da cadência das recorrências
 * (ver `supabase/recurring-task-cadence.sql`).
 */
export interface OptimizationQuickAction {
  type: OptimizationType;
  action: string;
  icon: string;
  label: string;
}

export interface OptimizationQuickGroup {
  type: OptimizationType;
  groupLabel: string;
  actions: OptimizationQuickAction[];
}

export const OPTIMIZATION_QUICK_GROUPS: OptimizationQuickGroup[] = [
  {
    type: "CAMPAIGN",
    groupLabel: "Campanhas",
    actions: [
      { type: "CAMPAIGN", action: "ACTIVATED", icon: "▶", label: "Ativei" },
      { type: "CAMPAIGN", action: "PAUSED", icon: "⏸", label: "Pausei" },
    ],
  },
  {
    type: "AUDIENCE",
    groupLabel: "Públicos",
    actions: [
      { type: "AUDIENCE", action: "ACTIVATED", icon: "▶", label: "Ativei" },
      { type: "AUDIENCE", action: "PAUSED", icon: "⏸", label: "Pausei" },
    ],
  },
  {
    type: "CREATIVE",
    groupLabel: "Criativos",
    actions: [
      { type: "CREATIVE", action: "ADDED", icon: "➕", label: "Publiquei" },
      { type: "CREATIVE", action: "PAUSED", icon: "⏸", label: "Pausei" },
    ],
  },
  {
    type: "BUDGET",
    groupLabel: "Orçamento",
    actions: [
      { type: "BUDGET", action: "INCREASED", icon: "⬆", label: "Aumentei" },
      { type: "BUDGET", action: "DECREASED", icon: "⬇", label: "Reduzi" },
      { type: "BUDGET", action: "REDISTRIBUTED", icon: "⇄", label: "Redistribuí" },
    ],
  },
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

const WEEKDAY_SHORT: Record<number, string> = { 1: "Segunda", 2: "Terça", 3: "Quarta", 4: "Quinta", 5: "Sexta", 6: "Sábado", 7: "Domingo" };
const WEEKDAY_LONG: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
  7: "Domingo",
};

/**
 * Cadência operacional de uma recorrência (revisão da arquitetura, ver
 * `supabase/recurring-task-cadence.sql`): cada PROCESSO da agência tem um
 * ritmo padrão próprio — o sistema já nasce sabendo, não é algo que o
 * gestor configura. `automatic` distribui a meta pelos 5 dias úteis (o
 * comportamento original); `fixed_days` restringe o cálculo aos dias
 * marcados (ex.: Checar saldo sempre segunda/quinta). Nunca exposto no
 * formulário de `/settings/recurring-tasks` — é método operacional,
 * provisionado via SQL junto com a recorrência (mesmo espírito de
 * `uses_account_review`), pensado pra no futuro admitir um override por
 * cliente sem mudar o modelo de novo.
 */
export type RecurringTaskCadence = { mode: "automatic" } | { mode: "fixed_days"; weekdays: number[] };

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
 * Calcula a próxima execução esperada. Em cadência `automatic`, distribui a
 * meta semanal pelos 5 dias úteis da sprint (segunda a sexta): a n-ésima
 * execução "ideal" cai no dia útil `floor(n * 5 / meta)` — meta 1 → sexta;
 * meta 2 → terça e sexta; meta 3 → segunda, quarta e sexta. Em cadência
 * `fixed_days`, a n-ésima execução cai no n-ésimo dia marcado, ciclando se a
 * meta for maior que a quantidade de dias marcados (ex.: 3 dias marcados,
 * meta 5 → o 4º slot volta pro 1º dia marcado, esperando uma segunda
 * execução nele).
 *
 * Em qualquer cadência, a próxima é sempre a fatia seguinte à última já
 * feita (`done`); se essa fatia já ficou pra trás (hoje é depois dela) e
 * ainda falta execução, empurra pra HOJE — nunca aponta uma data que já
 * passou.
 *
 * Deliberadamente recalculada do zero a cada chamada (meta + `done` +
 * cadência), nunca armazenada — é isso que garante que a recorrência
 * continua sendo UMA tarefa só (decisão do usuário), nunca vira várias
 * tarefas com prazo fixo.
 */
export function computeNextExecutionDate(
  sprint: { start_date: string },
  weeklyGoal: number | null,
  done: number,
  today: string,
  cadence: RecurringTaskCadence = { mode: "automatic" },
): NextExecution {
  if (weeklyGoal === null) return { date: null, metGoal: false };
  if (done >= weeklyGoal) return { date: null, metGoal: true };

  const slotIndex = done + 1;
  let slotWeekday: number;
  if (cadence.mode === "fixed_days" && cadence.weekdays.length > 0) {
    const sortedWeekdays = [...cadence.weekdays].sort((a, b) => a - b);
    slotWeekday = sortedWeekdays[(slotIndex - 1) % sortedWeekdays.length];
  } else {
    slotWeekday = Math.min(5, Math.max(1, Math.floor((slotIndex * 5) / weeklyGoal)));
  }
  const slotDate = addDays(sprint.start_date, slotWeekday - 1);

  return { date: slotDate < today ? today : slotDate, metGoal: false };
}

/** "Hoje" / "Quarta" / "Meta batida" / "—" — rótulo compacto pra coluna
 * "Próxima execução" da listagem principal. */
export function formatNextExecutionLabel(nextExecution: NextExecution, today: string): string {
  if (nextExecution.metGoal) return "Meta batida";
  if (nextExecution.date === null) return "—";
  if (nextExecution.date === today) return "Hoje";
  return WEEKDAY_SHORT[isoWeekday(nextExecution.date)] ?? "—";
}

/** "Hoje" / "Quarta-feira" / "Meta batida" / "—" — versão por extenso pro
 * resumo do drawer. */
export function formatNextExecutionLabelLong(nextExecution: NextExecution, today: string): string {
  if (nextExecution.metGoal) return "Meta batida";
  if (nextExecution.date === null) return "—";
  if (nextExecution.date === today) return "Hoje";
  return WEEKDAY_LONG[isoWeekday(nextExecution.date)] ?? "—";
}
