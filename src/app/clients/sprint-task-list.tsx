"use client";

import Link from "next/link";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { SectionHeader, SECONDARY_ACTION_BUTTON_CLASSES } from "@/components/ui/section-header";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { orderTasks } from "./task-list";
import { TaskRow, type TaskListItem } from "./task-row";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";

/**
 * Etapa "Sprint Workspace Polish 1.0" (Parte 3): mesmo cabeçalho
 * (`SectionHeader`) e mesmo estado vazio em linha (`EmptyStateRow`) que
 * `AccountReviewsSection` — as duas colunas de "Execução da sprint" agora
 * compartilham a mesma linguagem visual, só o conteúdo interno muda.
 *
 * Etapa "Instant Action & Context Memory 1.0" (Partes 2/3/5): virou Client
 * Component pra segurar UM `useOptimistic` (`useOptimisticTasks`)
 * compartilhado por toda a coluna — concluir/excluir passam a atualizar o
 * contador "X/Y concluídas" e a barra de progresso na hora, e não só o
 * check da própria linha (que já era otimista desde a Polish 1.0, mas
 * sozinho — o contador ficava esperando o servidor). Cada `TaskRow`
 * continua com seu próprio `useTransition`/`isPending` (Parte 4: só aquela
 * linha fica protegida contra clique duplo, nunca a lista inteira).
 */
export function SprintTaskList({
  tasks,
  clientId,
  sprintId,
  taskHrefPrefix,
  managers,
  returnTo,
  isAdmin,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente (a
   * própria página do cliente vs. o painel Sprints, preservando filtros/mês/
   * modo) — por isso quem chama decide o prefixo (`${prefix}${taskId}`).
   * Omitir preserva o link direto pra página do cliente, de sempre.
   * Etapa "Instant Action & Context Memory 1.0": era uma função
   * (`buildTaskHref`) — virou string porque este componente agora é Client
   * Component, e uma função não pode atravessar a fronteira servidor→cliente
   * como prop (ver comentário em `SprintCardBody`). */
  taskHrefPrefix?: string;
  /** Sprint UX 2.0 Fase 2 — quando informado (só a tela Sprints passa),
   * "+ Tarefa" vira um formulário inline (sem navegar pra `/tasks/new`). A
   * página do cliente não passa isto, então continua com o link de sempre. */
  managers?: InlineTaskManagerOption[];
  returnTo?: string;
  /** Etapa "Sprint Workspace Polish 1.0" — habilita "Excluir tarefa" no menu
   * "•••" de cada linha (ver `TaskRow`). */
  isAdmin?: boolean;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const ordered = orderTasks(optimisticTasks);
  const tasksDone = optimisticTasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = optimisticTasks.length > 0 ? (tasksDone / optimisticTasks.length) * 100 : 0;
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
            {optimisticTasks.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {tasksDone}/{optimisticTasks.length} concluída{optimisticTasks.length !== 1 ? "s" : ""}
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
              <Link href={`/clients/${clientId}/tasks/new?sprintId=${sprintId}`} className={SECONDARY_ACTION_BUTTON_CLASSES}>
                + Tarefa
              </Link>
            )}
          </span>
        }
      >
        Tarefas
      </SectionHeader>

      {optimisticTasks.length > 0 && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150"
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
              detailsHref={taskHrefPrefix ? `${taskHrefPrefix}${task.id}` : `/clients/${clientId}?task=${task.id}`}
              isAdmin={isAdmin}
              onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: task.id })}
              onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: task.id })}
            />
          ))}
        </ul>
      ) : (
        <EmptyStateRow className="mt-1.5">Nenhuma tarefa vinculada a esta sprint.</EmptyStateRow>
      )}
    </div>
  );
}
