import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { computeWeeklyExecutionProgress, resolveWeeklyGoalForSprint, type WeeklyExecutionProgress } from "@/lib/recurring-tasks";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface RecurringTaskListItem {
  id: string;
  title: string;
  icon: string;
  color: string;
  progress: WeeklyExecutionProgress;
}

/**
 * Recorrências aplicáveis a cada sprint, com o progresso já resolvido (meta
 * congelada da época + execuções dentro do período) — o dado que alimenta a
 * linha na fila única de Atividades (`ActivitySection`), hoje só usada em
 * `/sprints` (a página do cliente esconde a lista de tarefas, `hideTaskList`,
 * desde "Sprint como relatório semanal" — Fase F). Batched: uma única busca
 * pra todas as sprints da tela (várias, de vários clientes), nunca uma
 * consulta por sprint — mesmo padrão de `accountReviewsBySprintId` em
 * `sprints/page.tsx`. Tabela de recorrências pequena (ativas da agência
 * inteira, hoje zero até a migração final rodar) — busca tudo e filtra
 * "aplica a este cliente?" em memória em vez de um `.or()` complexo.
 */
export async function fetchRecurringTaskListsForSprints(
  supabase: Supabase,
  sprints: { id: string; client_id: string; start_date: string; end_date: string }[],
): Promise<Map<string, RecurringTaskListItem[]>> {
  const result = new Map<string, RecurringTaskListItem[]>();
  if (sprints.length === 0) return result;

  const [activeTasks, clientScopeRows] = await Promise.all([
    requireQuery(
      supabase.from("recurring_tasks").select("id, title, icon, color, applies_to_all").eq("is_active", true),
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
  const sprintIds = sprints.map((sprint) => sprint.id);
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
        const goal = resolveWeeklyGoalForSprint(goalHistoryByTask.get(task.id) ?? [], sprint.start_date);
        const executions = executionsByTaskAndSprint.get(`${task.id}:${sprint.id}`) ?? [];
        const progress = computeWeeklyExecutionProgress(executions, sprint, goal);
        return { id: task.id, title: task.title, icon: task.icon, color: task.color, progress };
      })
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));

    result.set(sprint.id, items);
  }

  return result;
}

export interface RecurringTaskExecutionDetail {
  id: string;
  executedAt: string;
  authorName: string;
  notes: string | null;
}

export interface RecurringTaskDetail {
  id: string;
  title: string;
  icon: string;
  hasChecklist: boolean;
  weekProgress: WeeklyExecutionProgress;
  /** Execuções dentro do período da sprint em que o drawer foi aberto. */
  weekExecutions: RecurringTaskExecutionDetail[];
  /** Todo o histórico já registrado pra este cliente (capado, mais recente
   * primeiro) — nunca zera entre sprints, é o ponto central da reforma. */
  history: RecurringTaskExecutionDetail[];
}

const HISTORY_LIMIT = 50;

/**
 * Detalhe de UMA recorrência pra UM cliente, aberto sob demanda quando o
 * gestor clica na linha (drawer) — nunca buscado em lote com o resto da
 * tela, ao contrário de `fetchRecurringTaskListsForSprints` (aquele
 * alimenta só o badge da lista, este alimenta o drawer com "Execuções desta
 * semana" + "Histórico"). `sprint` é a sprint em que o drawer foi aberto —
 * define tanto a meta congelada quanto o recorte de "desta semana".
 */
export async function fetchRecurringTaskDetail(
  supabase: Supabase,
  recurringTaskId: string,
  clientId: string,
  sprint: { start_date: string; end_date: string },
): Promise<RecurringTaskDetail | null> {
  const [taskRows, goalHistoryRows, executionRows] = await Promise.all([
    requireQuery(supabase.from("recurring_tasks").select("id, title, icon, has_checklist").eq("id", recurringTaskId), "recurring_tasks:detail"),
    requireQuery(
      supabase.from("recurring_task_goal_history").select("weekly_goal, effective_from").eq("recurring_task_id", recurringTaskId),
      "recurring_task_goal_history:detail",
    ),
    requireQuery(
      supabase
        .from("recurring_task_executions")
        .select("id, executed_at, notes, team_member:team_members!recurring_task_executions_team_member_id_fkey(name)")
        .eq("recurring_task_id", recurringTaskId)
        .eq("client_id", clientId)
        .order("executed_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      "recurring_task_executions:detail",
    ),
  ]);

  const task = taskRows[0];
  if (!task) return null;

  const history: RecurringTaskExecutionDetail[] = executionRows.map((row) => ({
    id: row.id,
    executedAt: row.executed_at,
    authorName: row.team_member?.name ?? "Membro removido",
    notes: row.notes,
  }));

  const weekExecutions = history.filter((execution) => {
    const day = execution.executedAt.slice(0, 10);
    return day >= sprint.start_date && day <= sprint.end_date;
  });

  const goal = resolveWeeklyGoalForSprint(
    goalHistoryRows.map((row) => ({ weeklyGoal: row.weekly_goal, effectiveFrom: row.effective_from })),
    sprint.start_date,
  );
  const weekProgress = computeWeeklyExecutionProgress(
    weekExecutions.map((execution) => ({ executedAt: execution.executedAt })),
    sprint,
    goal,
  );

  return {
    id: task.id,
    title: task.title,
    icon: task.icon,
    hasChecklist: task.has_checklist,
    weekProgress,
    weekExecutions,
    history,
  };
}
