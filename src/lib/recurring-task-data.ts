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
