"use client";

import Link from "next/link";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { SectionHeader, SECONDARY_ACTION_BUTTON_CLASSES } from "@/components/ui/section-header";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { buildActivityFeed } from "./activity";
import { TaskRow, type TaskListItem } from "./task-row";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";
import { AccountReviewRow, type AccountReviewSummaryItem } from "./account-reviews-section";

/**
 * "ATIVIDADES" (MITZA Unified Activities 1.0) — substitui a antiga divisão
 * "Tarefas" | "Revisões de conta" (duas colunas lado a lado, cada uma com
 * cabeçalho e estado vazio próprios) por uma única fila de trabalho: um
 * cabeçalho, uma lista, um estado vazio. Internamente as duas entidades
 * continuam 100% separadas (schemas, ações, permissões, optimistic UI e
 * histórico intactos) — só a apresentação virou uma lista só, ordenada por
 * `buildActivityFeed` (`./activity.ts`) e renderizada linha a linha pelos
 * componentes oficiais de cada domínio (`TaskRow`/`AccountReviewRow`), cada
 * um com um rótulo discreto de tipo pra desambiguar dentro da fila comum.
 *
 * Absorve a lógica que antes vivia em `SprintTaskList` (optimistic UI de
 * tarefas via `useOptimisticTasks`, criação inline, contador/barra de
 * progresso) — esse componente deixou de ter uso próprio e foi removido.
 */
export function ActivitySection({
  tasks,
  clientId,
  sprintId,
  taskHrefPrefix,
  managers,
  isAdmin,
  reviews,
  newReviewHref,
  buildReviewDetailHref,
}: {
  tasks: TaskListItem[];
  clientId: string;
  sprintId: string;
  /** Cada tela abre o drawer de tarefa a partir de uma URL diferente — ver
   * doc equivalente em `SprintCardBody`. */
  taskHrefPrefix?: string;
  managers: InlineTaskManagerOption[];
  /** Habilita "Excluir tarefa" no menu "•••" de cada linha de tarefa. */
  isAdmin?: boolean;
  /** Revisões de conta desta sprint — opcional: quem ainda não busca
   * `account_reviews` simplesmente não passa (a fila mostra só tarefas,
   * sem CTA de "Registrar revisão"). */
  reviews?: AccountReviewSummaryItem[];
  newReviewHref?: string;
  buildReviewDetailHref?: (reviewId: string) => string;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const tasksDone = optimisticTasks.filter((task) => effectiveTaskStatus(task) === "feito").length;
  const progressPct = optimisticTasks.length > 0 ? (tasksDone / optimisticTasks.length) * 100 : 0;
  const reviewList = reviews ?? [];
  const activities = buildActivityFeed(optimisticTasks, reviewList);
  const canRegisterReview = Boolean(newReviewHref && buildReviewDetailHref);

  return (
    <div>
      <SectionHeader
        action={
          <span className="flex shrink-0 flex-wrap items-center gap-2.5">
            {/* Etapa Parte 8: só a métrica de tarefas (concluídas/total) — a
                mesma de sempre, nunca fundida com a contagem de revisões
                (métricas semanticamente diferentes). O total de atividades
                já é visível na própria lista, sem precisar de um segundo
                número no cabeçalho. */}
            {optimisticTasks.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {tasksDone}/{optimisticTasks.length} concluída{optimisticTasks.length !== 1 ? "s" : ""}
              </span>
            )}
            <InlineCreateTaskForm
              clientId={clientId}
              sprintId={sprintId}
              managers={managers}
              defaultDueDate={todayDateString()}
              triggerLabel="+ Nova tarefa"
              onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
            />
            {canRegisterReview && (
              <Link href={newReviewHref!} scroll={false} className={SECONDARY_ACTION_BUTTON_CLASSES}>
                + Registrar revisão
              </Link>
            )}
          </span>
        }
      >
        Atividades
      </SectionHeader>

      {optimisticTasks.length > 0 && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150"
            style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
          />
        </div>
      )}

      {activities.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {activities.map((item) =>
            item.kind === "task" ? (
              <TaskRow
                key={`task-${item.task.id}`}
                task={item.task}
                clientId={clientId}
                detailsHref={
                  taskHrefPrefix ? `${taskHrefPrefix}${item.task.id}` : `/clients/${clientId}?task=${item.task.id}`
                }
                isAdmin={isAdmin}
                typeLabel="Tarefa"
                onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: item.task.id })}
                onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: item.task.id })}
              />
            ) : (
              <AccountReviewRow
                key={`review-${item.review.id}`}
                review={item.review}
                detailHref={buildReviewDetailHref!(item.review.id)}
                typeLabel="Revisão de conta"
              />
            ),
          )}
        </ul>
      ) : (
        <EmptyStateRow className="mt-1.5">Nenhuma atividade nesta sprint.</EmptyStateRow>
      )}
    </div>
  );
}
