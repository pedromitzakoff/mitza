import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { CLIENT_CONTRACT_STATUS_REGISTRY } from "@/lib/status-registry";
import { resolveWeeklyGoalForSprint } from "@/lib/recurring-tasks";
import { todayDateString } from "@/lib/today";
import { RecurringTasksList, type RecurringTaskItem } from "../recurring-tasks-list";

export default async function RecurringTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ recurringTaskError?: string }>;
}) {
  await requireAdmin();
  const { recurringTaskError } = await searchParams;

  const supabase = await createSupabaseClient();

  const [tasks, taskClients, checklistItemRows, goalHistoryRows, executionRows, clients, managers] = await Promise.all([
    requireQuery(
      supabase
        .from("recurring_tasks")
        .select("id, title, icon, color, is_active, applies_to_all, default_assignee_id, has_checklist, uses_account_review")
        .order("title"),
      "recurring_tasks",
    ),
    requireQuery(supabase.from("recurring_task_clients").select("recurring_task_id, client_id"), "recurring_task_clients"),
    requireQuery(
      supabase.from("recurring_task_checklist_items").select("recurring_task_id, label, sort_order").order("sort_order"),
      "recurring_task_checklist_items",
    ),
    requireQuery(
      supabase.from("recurring_task_goal_history").select("recurring_task_id, weekly_goal, effective_from"),
      "recurring_task_goal_history",
    ),
    requireQuery(supabase.from("recurring_task_executions").select("recurring_task_id"), "recurring_task_executions"),
    requireQuery(supabase.from("clients").select("id, name, status").is("deleted_at", null).order("name"), "clients"),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
  ]);

  const sortedClients = [...clients].sort((a, b) => {
    const rankDiff =
      CLIENT_CONTRACT_STATUS_REGISTRY[`client_contract.${a.status}`].order - CLIENT_CONTRACT_STATUS_REGISTRY[`client_contract.${b.status}`].order;
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });

  const clientIdsByTask = new Map<string, string[]>();
  for (const row of taskClients) {
    const list = clientIdsByTask.get(row.recurring_task_id) ?? [];
    list.push(row.client_id);
    clientIdsByTask.set(row.recurring_task_id, list);
  }

  const checklistLabelsByTask = new Map<string, string[]>();
  for (const row of checklistItemRows) {
    const list = checklistLabelsByTask.get(row.recurring_task_id) ?? [];
    list.push(row.label);
    checklistLabelsByTask.set(row.recurring_task_id, list);
  }

  const goalHistoryByTask = new Map<string, { weeklyGoal: number; effectiveFrom: string }[]>();
  for (const row of goalHistoryRows) {
    const list = goalHistoryByTask.get(row.recurring_task_id) ?? [];
    list.push({ weeklyGoal: row.weekly_goal, effectiveFrom: row.effective_from });
    goalHistoryByTask.set(row.recurring_task_id, list);
  }

  const tasksWithExecutions = new Set(executionRows.map((row) => row.recurring_task_id));
  const todayStr = todayDateString();

  const taskItems: RecurringTaskItem[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    icon: task.icon,
    color: task.color,
    isActive: task.is_active,
    appliesToAll: task.applies_to_all,
    defaultAssigneeId: task.default_assignee_id,
    hasChecklist: task.has_checklist,
    usesAccountReview: task.uses_account_review,
    selectedClientIds: clientIdsByTask.get(task.id) ?? [],
    checklistLabels: checklistLabelsByTask.get(task.id) ?? [],
    currentWeeklyGoal: resolveWeeklyGoalForSprint(goalHistoryByTask.get(task.id) ?? [], todayStr),
    hasExecutions: tasksWithExecutions.has(task.id),
  }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-foreground">Recorrências</h1>

      <p className="mt-2 text-sm text-zinc-500">
        Tarefas permanentes — Checar saldo, Reportar cliente, Otimização e o que mais a agência precisar. Não geram uma tarefa nova toda
        sprint: o gestor registra execuções, e o histórico nunca zera. A meta semanal atualizada aqui vale a partir de agora — sprints já em
        andamento mantêm a meta anterior.
      </p>

      {recurringTaskError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{recurringTaskError}</p>
      )}

      <div className="mt-6">
        <RecurringTasksList tasks={taskItems} managers={managers ?? []} clients={sortedClients} />
      </div>
    </div>
  );
}
