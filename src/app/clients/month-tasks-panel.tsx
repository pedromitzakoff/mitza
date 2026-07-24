"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveTaskStatus } from "@/lib/task-status";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { TaskRow, type TaskListItem } from "./task-row";
import { orderTasks } from "./task-order";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";
import { ACTIVITY_COL_ACTIONS, ACTIVITY_COL_ASSIGNEE, ACTIVITY_COL_DATE, ACTIVITY_COL_SPRINT, ACTIVITY_COL_STATUS } from "./activity-columns";

type TaskFilter = "todas" | "pendentes" | "atrasadas" | "concluidas";

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendentes", label: "Pendentes" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "concluidas", label: "Concluídas" },
];

/**
 * "Tarefas de {mês}" (Etapa "Tarefas e Sprints separadas") — novo módulo
 * principal da página do cliente: substitui a antiga "Foco agora"
 * (`SprintFocusBar`, removida sem substituto) e "Outras tarefas" (tarefas
 * soltas, absorvidas aqui). Reúne numa lista só TODAS as tarefas do mês —
 * das sprints do período + soltas — em vez de cada sprint gerenciar sua
 * própria fila (`Cliente → Sprint → Tarefas` virou `Cliente → Tarefas →
 * Sprint [referência]`). A sprint de cada tarefa é só uma coluna de
 * contexto (`sprintLabel` em `TaskRow`), nunca agrupamento — mesma lista,
 * mesma ordem cronológica (`orderTasks`) pra qualquer filtro.
 *
 * Reaproveita 100% da infraestrutura de `TaskList` (`useOptimisticTasks`,
 * `InlineCreateTaskForm`, `TaskRow`) — nenhuma tarefa, ação ou regra nova,
 * só uma superfície de leitura/filtro maior. Tarefas criadas aqui nascem
 * soltas (`sprintId: null`), mesmo contrato de sempre — vincular a uma
 * sprint específica na criação fica para uma etapa futura, quando a
 * relação Tarefas/Sprints for revisada conceitualmente (ver nota do
 * pedido: esta é a primeira reorganização visual).
 */
export function MonthTasksPanel({
  monthLabel,
  tasks,
  taskSprintLabels,
  clientId,
  managers,
  canOperate = true,
}: {
  monthLabel: string;
  tasks: TaskListItem[];
  /** `taskId -> período da sprint` ("20-26 jul") — ausente = tarefa solta. */
  taskSprintLabels: Record<string, string>;
  clientId: string;
  managers: InlineTaskManagerOption[];
  canOperate?: boolean;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const [filter, setFilter] = useState<TaskFilter>("todas");

  const counts = {
    todas: optimisticTasks.length,
    pendentes: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "pendente").length,
    atrasadas: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "atrasado").length,
    concluidas: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "feito").length,
  };

  const ordered = orderTasks(optimisticTasks);
  const filtered = ordered.filter((task) => {
    if (filter === "todas") return true;
    const status = effectiveTaskStatus(task);
    if (filter === "pendentes") return status === "pendente";
    if (filter === "atrasadas") return status === "atrasado";
    return status === "feito";
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-1.5 text-base font-medium text-foreground">
          Tarefas de {monthLabel}
          <span className="text-xs font-normal text-muted-foreground">
            {counts.todas} {counts.todas === 1 ? "tarefa" : "tarefas"}
          </span>
        </h2>
        {canOperate && (
          <InlineCreateTaskForm
            clientId={clientId}
            sprintId={null}
            managers={managers}
            onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`mitza-pressable rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === key
                ? "border-brand bg-brand text-white"
                : "border-border text-muted-foreground hover:border-brand hover:text-brand"
            }`}
          >
            {label}
            <span className="ml-1 tabular-nums opacity-80">{counts[key]}</span>
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2.5 border-b border-border bg-zinc-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/40">
            <span className={`${ACTIVITY_COL_STATUS} truncate`} aria-hidden="true" />
            <span className={ACTIVITY_COL_DATE}>Prazo</span>
            <span className="min-w-0 flex-1">Tarefa</span>
            <span className={ACTIVITY_COL_ASSIGNEE}>Responsável</span>
            <span className={ACTIVITY_COL_SPRINT}>Sprint</span>
            <span className={ACTIVITY_COL_ACTIONS} aria-hidden="true" />
          </div>
          <ul className="[&>li:last-child]:border-0">
            {filtered.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                clientId={clientId}
                detailsHref={`/clients/${clientId}?task=${task.id}`}
                canOperate={canOperate}
                sprintLabel={taskSprintLabels[task.id] ?? null}
                description={task.notes}
                onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: task.id })}
                onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: task.id })}
              />
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState className="mt-2">
          {filter === "todas" ? "Nenhuma tarefa neste mês." : "Nenhuma tarefa neste filtro."}
        </EmptyState>
      )}
    </div>
  );
}
