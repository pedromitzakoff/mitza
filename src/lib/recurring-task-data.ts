import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import {
  computeNextExecutionDate,
  computePreviousSprintPending,
  computeWeeklyExecutionProgress,
  formatNextExecutionLabel,
  formatNextExecutionLabelLong,
  resolveWeeklyGoalForSprint,
  type PreviousSprintPending,
  type RecurringTaskCadence,
  type WeeklyExecutionProgress,
} from "@/lib/recurring-tasks";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Lê `cadence_mode`/`fixed_weekdays` (colunas cruas do banco) e monta o
 * `RecurringTaskCadence` que a lógica pura espera. */
function toCadence(row: { cadence_mode: string; fixed_weekdays: number[] }): RecurringTaskCadence {
  return row.cadence_mode === "fixed_days" && row.fixed_weekdays.length > 0
    ? { mode: "fixed_days", weekdays: row.fixed_weekdays }
    : { mode: "automatic" };
}

export interface RecurringTaskListItem {
  id: string;
  title: string;
  icon: string;
  color: string;
  progress: WeeklyExecutionProgress;
  /** "Hoje" / "Quarta" / "Meta batida" / "—" — já formatado aqui (onde
   * `today` está disponível), pra a linha não precisar de mais uma prop só
   * pra isso. */
  nextExecutionLabel: string;
}

/**
 * Recorrências aplicáveis a cada sprint, com o progresso e a próxima
 * execução já resolvidos (meta congelada da época + execuções dentro do
 * período) — o dado que alimenta a linha na fila única de Atividades
 * (`ActivitySection`), hoje só usada em `/sprints` (a página do cliente
 * esconde a lista de tarefas, `hideTaskList`, desde "Sprint como relatório
 * semanal" — Fase F). Batched: uma única busca pra todas as sprints da tela
 * (várias, de vários clientes), nunca uma consulta por sprint — mesmo
 * padrão de `accountReviewsBySprintId` em `sprints/page.tsx`. Tabela de
 * recorrências pequena (ativas da agência inteira) — busca tudo e filtra
 * "aplica a este cliente?" em memória em vez de um `.or()` complexo.
 *
 * Etapa "Simplificar linha das recorrentes": a pendência da sprint anterior
 * saiu daqui de propósito (era o motivo de buscar a sprint-fronteira de
 * cada cliente) — esse dado agora só existe dentro do drawer
 * (`fetchRecurringTaskDetail`, que busca a sprint anterior sob demanda, de
 * UM cliente por vez), nunca na listagem principal.
 */
export async function fetchRecurringTaskListsForSprints(
  supabase: Supabase,
  sprints: { id: string; client_id: string; start_date: string; end_date: string }[],
  today: string,
): Promise<Map<string, RecurringTaskListItem[]>> {
  const result = new Map<string, RecurringTaskListItem[]>();
  if (sprints.length === 0) return result;

  const [activeTasks, clientScopeRows] = await Promise.all([
    requireQuery(
      supabase.from("recurring_tasks").select("id, title, icon, color, applies_to_all, cadence_mode, fixed_weekdays").eq("is_active", true),
      "recurring_tasks",
    ),
    requireQuery(supabase.from("recurring_task_clients").select("recurring_task_id, client_id"), "recurring_task_clients"),
  ]);

  if (activeTasks.length === 0) return result;

  const scopedClientIdsByTask = new Map<string, Set<string>>();
  for (const row of clientScopeRows) {
    const set = scopedClientIdsByTask.get(row.recurring_task_id) ?? new Set<string>();
    set.add(row.client_id);
    scopedClientIdsByTask.set(row.recurring_task_id, set);
  }

  const taskIds = activeTasks.map((task) => task.id);
  const sprintIds = sprints.map((s) => s.id);
  const [goalHistoryRows, executionRows] = await Promise.all([
    requireQuery(
      supabase.from("recurring_task_goal_history").select("recurring_task_id, weekly_goal, effective_from").in("recurring_task_id", taskIds),
      "recurring_task_goal_history",
    ),
    requireQuery(
      supabase.from("recurring_task_executions").select("recurring_task_id, sprint_id, executed_at").in("sprint_id", sprintIds),
      "recurring_task_executions",
    ),
  ]);

  const goalHistoryByTask = new Map<string, { weeklyGoal: number; effectiveFrom: string }[]>();
  for (const row of goalHistoryRows) {
    const list = goalHistoryByTask.get(row.recurring_task_id) ?? [];
    list.push({ weeklyGoal: row.weekly_goal, effectiveFrom: row.effective_from });
    goalHistoryByTask.set(row.recurring_task_id, list);
  }

  const executionsByTaskAndSprint = new Map<string, { executedAt: string }[]>();
  for (const row of executionRows) {
    const key = `${row.recurring_task_id}:${row.sprint_id}`;
    const list = executionsByTaskAndSprint.get(key) ?? [];
    list.push({ executedAt: row.executed_at });
    executionsByTaskAndSprint.set(key, list);
  }

  for (const sprint of sprints) {
    const applicable = activeTasks.filter((task) => task.applies_to_all || scopedClientIdsByTask.get(task.id)?.has(sprint.client_id));
    if (applicable.length === 0) continue;

    const items = applicable
      .map((task): RecurringTaskListItem => {
        const history = goalHistoryByTask.get(task.id) ?? [];
        const goal = resolveWeeklyGoalForSprint(history, sprint.start_date);
        const executions = executionsByTaskAndSprint.get(`${task.id}:${sprint.id}`) ?? [];
        const progress = computeWeeklyExecutionProgress(executions, sprint, goal);
        const nextExecution = computeNextExecutionDate(sprint, goal, progress.done, today, toCadence(task));
        const nextExecutionLabel = formatNextExecutionLabel(nextExecution, today);

        return { id: task.id, title: task.title, icon: task.icon, color: task.color, progress, nextExecutionLabel };
      })
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

    result.set(sprint.id, items);
  }

  return result;
}

export interface OptimizationSelection {
  type: string;
  action: string;
  quantity: number;
}

/** Valida a forma bruta de `optimization_selections` (jsonb, `unknown` no
 * tipo do banco) — nunca confia cegamente no shape vindo do Postgres. */
function parseOptimizationSelections(raw: unknown): OptimizationSelection[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed = raw.filter(
    (item): item is OptimizationSelection =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).type === "string" &&
      typeof (item as Record<string, unknown>).action === "string" &&
      typeof (item as Record<string, unknown>).quantity === "number",
  );
  return parsed.length > 0 ? parsed : null;
}

export interface RecurringTaskExecutionDetail {
  id: string;
  executedAt: string;
  authorName: string;
  notes: string | null;
  checklistSelectedKeys: string[] | null;
  /** Seleções do registro rápido de Otimização (tipo + ação + quantidade) —
   * `null` pra qualquer execução que não seja de uma recorrência com
   * `uses_account_review=true`. */
  optimizationSelections: OptimizationSelection[] | null;
}

export interface RecurringTaskChecklistItem {
  key: string;
  label: string;
}

export interface RecurringTaskDetail {
  id: string;
  title: string;
  icon: string;
  hasChecklist: boolean;
  /** Integração de backend com account_reviews/account_optimizations (hoje
   * só Otimização) — quando true, o drawer troca o checklist genérico pelo
   * registro rápido por chips (`OPTIMIZATION_QUICK_GROUPS`), nunca os dois
   * ao mesmo tempo. */
  usesAccountReview: boolean;
  /** Integração de backend com client_reports (hoje só "Reportar cliente")
   * — quando true, o drawer troca o formulário de registro pelo CTA "Gerar
   * report", que abre o módulo de Reports com cliente e período já
   * resolvidos; salvar o report registra a execução automaticamente. Nunca
   * true ao mesmo tempo que `usesAccountReview` (constraint no banco). */
  usesReport: boolean;
  /** Itens do checklist desta recorrência, na ordem configurada — vazio
   * quando `hasChecklist` é false. Ignorado quando `usesAccountReview` é
   * true (ver acima). Dado, não código: a UI não sabe (nem precisa saber)
   * qual recorrência futura vai usar isso. */
  checklistItems: RecurringTaskChecklistItem[];
  weekProgress: WeeklyExecutionProgress;
  /** "Hoje" / "Quarta-feira" / "Meta batida" / "—" — por extenso, pro
   * resumo operacional do drawer. */
  nextExecutionLabel: string;
  /** Execuções dentro do período da sprint em que o drawer foi aberto. */
  weekExecutions: RecurringTaskExecutionDetail[];
  /** Todo o histórico já registrado pra este cliente (capado, mais recente
   * primeiro) — nunca zera entre sprints, é o ponto central da reforma. */
  history: RecurringTaskExecutionDetail[];
  /** Progresso da sprint ANTERIOR do mesmo cliente — `null` quando não há
   * sprint anterior ou a recorrência não tinha meta configurada ainda
   * naquela época (nunca é pendência sem meta). Etapa "Simplificar linha das
   * recorrentes": esse contexto histórico saiu da listagem principal e
   * agora só existe aqui, dentro do drawer. */
  previousWeek: { progress: WeeklyExecutionProgress; pending: PreviousSprintPending | null } | null;
}

const HISTORY_LIMIT = 50;

/**
 * Detalhe de UMA recorrência pra UM cliente, aberto sob demanda quando o
 * gestor clica na linha (drawer) — nunca buscado em lote com o resto da
 * tela, ao contrário de `fetchRecurringTaskListsForSprints` (aquele
 * alimenta só a linha da lista, este alimenta o drawer com "Execuções desta
 * semana" + resumo operacional + "Histórico"). `sprint` é a sprint em que o
 * drawer foi aberto — define tanto a meta congelada quanto o recorte de
 * "desta semana". `today` só entra no cálculo de `nextExecution` (a sprint
 * anterior nunca precisa de "hoje").
 */
export async function fetchRecurringTaskDetail(
  supabase: Supabase,
  recurringTaskId: string,
  clientId: string,
  sprint: { start_date: string; end_date: string },
  today: string,
): Promise<RecurringTaskDetail | null> {
  const [taskRows, goalHistoryRows, executionRows, checklistItemRows, previousSprintRows] = await Promise.all([
    requireQuery(
      supabase
        .from("recurring_tasks")
        .select("id, title, icon, has_checklist, uses_account_review, uses_report, cadence_mode, fixed_weekdays")
        .eq("id", recurringTaskId),
      "recurring_tasks:detail",
    ),
    requireQuery(
      supabase.from("recurring_task_goal_history").select("weekly_goal, effective_from").eq("recurring_task_id", recurringTaskId),
      "recurring_task_goal_history:detail",
    ),
    requireQuery(
      supabase
        .from("recurring_task_executions")
        .select(
          "id, executed_at, notes, checklist_selected_keys, optimization_selections, team_member:team_members!recurring_task_executions_team_member_id_fkey(name)",
        )
        .eq("recurring_task_id", recurringTaskId)
        .eq("client_id", clientId)
        .order("executed_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      "recurring_task_executions:detail",
    ),
    requireQuery(
      supabase
        .from("recurring_task_checklist_items")
        .select("item_key, label")
        .eq("recurring_task_id", recurringTaskId)
        .order("sort_order"),
      "recurring_task_checklist_items:detail",
    ),
    requireQuery(
      supabase
        .from("sprints")
        .select("id, start_date, end_date")
        .eq("client_id", clientId)
        .lt("start_date", sprint.start_date)
        .order("end_date", { ascending: false })
        .limit(1),
      "sprints:detail:previous",
    ),
  ]);

  const task = taskRows[0];
  if (!task) return null;

  const history: RecurringTaskExecutionDetail[] = executionRows.map((row) => ({
    id: row.id,
    executedAt: row.executed_at,
    authorName: row.team_member?.name ?? "Membro removido",
    notes: row.notes,
    checklistSelectedKeys: row.checklist_selected_keys,
    optimizationSelections: parseOptimizationSelections(row.optimization_selections),
  }));

  const weekExecutions = history.filter((execution) => {
    const day = execution.executedAt.slice(0, 10);
    return day >= sprint.start_date && day <= sprint.end_date;
  });

  const goalHistory = goalHistoryRows.map((row) => ({ weeklyGoal: row.weekly_goal, effectiveFrom: row.effective_from }));
  const goal = resolveWeeklyGoalForSprint(goalHistory, sprint.start_date);
  const weekProgress = computeWeeklyExecutionProgress(
    weekExecutions.map((execution) => ({ executedAt: execution.executedAt })),
    sprint,
    goal,
  );
  const nextExecutionLabel = formatNextExecutionLabelLong(
    computeNextExecutionDate(sprint, goal, weekProgress.done, today, toCadence(task)),
    today,
  );

  const previousSprint = previousSprintRows[0] ?? null;
  let previousWeek: RecurringTaskDetail["previousWeek"] = null;
  if (previousSprint) {
    const previousGoal = resolveWeeklyGoalForSprint(goalHistory, previousSprint.start_date);
    const previousExecutions = history.filter((execution) => {
      const day = execution.executedAt.slice(0, 10);
      return day >= previousSprint.start_date && day <= previousSprint.end_date;
    });
    const previousProgress = computeWeeklyExecutionProgress(
      previousExecutions.map((execution) => ({ executedAt: execution.executedAt })),
      previousSprint,
      previousGoal,
    );
    previousWeek = { progress: previousProgress, pending: computePreviousSprintPending(previousProgress) };
  }

  return {
    id: task.id,
    title: task.title,
    icon: task.icon,
    hasChecklist: task.has_checklist,
    usesAccountReview: task.uses_account_review,
    usesReport: task.uses_report,
    checklistItems: checklistItemRows.map((row) => ({ key: row.item_key, label: row.label })),
    weekProgress,
    nextExecutionLabel,
    weekExecutions,
    history,
    previousWeek,
  };
}
