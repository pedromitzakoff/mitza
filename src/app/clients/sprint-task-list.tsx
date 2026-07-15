import Link from "next/link";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { orderTasks } from "./task-list";
import { TaskRow, type TaskListItem } from "./task-row";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";

/**
 * Etapa "Sprint Workspace Polish 1.0" (Parte 3): mesmo cabeçalho
 * (`SectionHeader`) e mesmo estado vazio em linha (`EmptyStateRow`) que
 * `AccountReviewsSection` — as duas colunas de "Execução da sprint" agora
 * compartilham a mesma linguagem visual, só o conteúdo interno muda.
 */
export function SprintTaskList({
  tasks,
  clientId,
  sprintId,
  buildTaskHref,
  managers,
  returnTo,
  isAdmin,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente (a
   * própria página do cliente vs. o painel Sprints, preservando filtros/mês/
   * modo) — por isso quem chama decide a URL. Omitir preserva o link direto
   * pra página do cliente, de sempre. */
  buildTaskHref?: (taskId: string) => string;
  /** Sprint UX 2.0 Fase 2 — quando informado (só a tela Sprints passa),
   * "+ Tarefa" vira um formulário inline (sem navegar pra `/tasks/new`). A
   * página do cliente não passa isto, então continua com o link de sempre. */
  managers?: InlineTaskManagerOption[];
  returnTo?: string;
  /** Etapa "Sprint Workspace Polish 1.0" — habilita "Excluir tarefa" no menu
   * "•••" de cada linha (ver `TaskRow`). */
  isAdmin?: boolean;
}) {
  const ordered = orderTasks(tasks);
  const tasksDone = tasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = tasks.length > 0 ? (tasksDone / tasks.length) * 100 : 0;
  const canCreateInline = managers !== undefined && returnTo !== undefined;

  return (
    <div>
      <SectionHeader
        action={
          <span className="flex shrink-0 flex-wrap items-center gap-2.5">
            {/* Etapa "Sprint Workspace Polish 1.1" (Parte 5): "X de Y
                concluídas" virou "X/Y concluídas" — mesma leitura, menos
                espaço, mesmo padrão de contagem já usado no resumo fechado
                (`AccountCardSummary`, "X/Y tarefas"). */}
            {tasks.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {tasksDone}/{tasks.length} concluída{tasks.length !== 1 ? "s" : ""}
              </span>
            )}
            {canCreateInline ? (
              <InlineCreateTaskForm
                clientId={clientId}
                sprintId={sprintId}
                managers={managers}
                returnTo={returnTo}
                toggleId={`new-task-${sprintId}`}
                defaultDueDate={todayDateString()}
              />
            ) : (
              <Link
                href={`/clients/${clientId}/tasks/new?sprintId=${sprintId}`}
                className="mitza-pressable rounded text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                + Tarefa
              </Link>
            )}
          </span>
        }
      >
        Tarefas
      </SectionHeader>

      {tasks.length > 0 && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
          />
        </div>
      )}

      {ordered.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              clientId={clientId}
              detailsHref={buildTaskHref ? buildTaskHref(task.id) : `/clients/${clientId}?task=${task.id}`}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      ) : (
        <EmptyStateRow className="mt-1.5">Nenhuma tarefa vinculada a esta sprint.</EmptyStateRow>
      )}
    </div>
  );
}
