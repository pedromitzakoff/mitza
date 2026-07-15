"use client";

import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { formatDueDate } from "@/app/clients/task-row";
import { completeTaskAction, deleteTaskAction } from "@/app/clients/tasks-actions";
import { createCommentAction } from "@/app/clients/comments-actions";
import { DeleteTaskButton } from "@/app/clients/delete-task-button";
import { InlineEditTaskForm, type InlineTaskManagerOption } from "@/app/clients/inline-task-form";
import { saveScrollForReturn } from "@/lib/scroll-restore";
import type { CommentItem } from "@/app/clients/comment-thread";
import type { OperationTaskItem } from "./operation-data";

const commentDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function TaskDrawerPanel({
  task,
  clientId,
  clientName,
  sprintPeriodLabel,
  comments,
  closeHref,
  returnTo,
  isAdmin,
  managers,
}: {
  task: OperationTaskItem;
  clientId: string;
  clientName: string;
  sprintPeriodLabel: string | null;
  comments: CommentItem[];
  closeHref: string;
  returnTo: string;
  isAdmin: boolean;
  /** Sprint UX 2.0 Fase 2 — só a tela Sprints passa isto: troca "Editar
   * tarefa" (link pra `/tasks/{id}/edit`) por um formulário inline
   * (`InlineEditTaskForm`), sem navegar pra fora da tela. A página do
   * cliente não passa, então continua com o link de sempre — igual antes. */
  managers?: InlineTaskManagerOption[];
}) {
  const status = effectiveTaskStatus(task);

  return (
    <>
      <Link
        href={closeHref}
        scroll={false}
        className="fixed inset-0 z-40 bg-black/30"
        aria-label="Fechar"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {clientName}
              {sprintPeriodLabel ? ` · ${sprintPeriodLabel}` : ""}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-foreground">{task.title}</h2>
          </div>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[status]}`}>
            {TASK_STATUS_LABEL[status]}
          </span>
          <span className="text-xs text-muted-foreground">{TASK_TYPE_LABEL[task.type]}</span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Responsável</dt>
            <dd className="text-foreground">{task.assignee?.name ?? "Sem responsável"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Prazo</dt>
            <dd className="text-foreground">{formatDueDate(task.due_date)}</dd>
          </div>
        </dl>

        {task.notes && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground">Observações</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{task.notes}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {status !== "feito" && (
            <form action={completeTaskAction.bind(null, task.id, clientId)}>
              <button
                type="submit"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                Marcar como feito
              </button>
            </form>
          )}
          {managers ? (
            <InlineEditTaskForm
              taskId={task.id}
              clientId={clientId}
              managers={managers}
              returnTo={returnTo}
              toggleId={`edit-task-${task.id}`}
              fullEditHref={`/clients/${clientId}/tasks/${task.id}/edit?return_to=${encodeURIComponent(returnTo)}`}
              defaultTitle={task.title}
              defaultType={task.type}
              // Limitação conhecida: `OperationTaskItem.assignee` só carrega
              // nome/status (nunca o id — o modelo de dados compartilhado
              // com Visão Geral/Relatórios nunca precisou disso até agora),
              // então o valor pré-selecionado é resolvido por nome dentro da
              // lista de gestores ativos. Em nomes duplicados (raro numa
              // agência pequena) o pré-preenchimento pode escolher o gestor
              // errado — trocar manualmente no select ainda funciona
              // corretamente, só o valor DEFAULT que pode ficar impreciso.
              defaultAssigneeId={
                task.assignee ? (managers.find((m) => m.name === task.assignee?.name)?.id ?? null) : null
              }
              defaultDueDate={task.due_date}
            />
          ) : (
            <Link
              href={`/clients/${clientId}/tasks/${task.id}/edit?return_to=${encodeURIComponent(returnTo)}`}
              onClick={() => saveScrollForReturn(returnTo)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Editar tarefa
            </Link>
          )}
          {isAdmin && (
            <DeleteTaskButton
              action={deleteTaskAction.bind(null, task.id, clientId)}
              taskTitle={task.title}
              returnTo={returnTo}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            />
          )}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comentários</p>

          {comments.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {comments.map((comment) => (
                <li key={comment.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.author?.name ?? "Alguém"}</span>{" "}
                  · {commentDateFormatter.format(new Date(comment.created_at))}
                  <p className="text-foreground">{comment.content}</p>
                </li>
              ))}
            </ul>
          )}

          <form
            action={createCommentAction.bind(null, "task", task.id, clientId)}
            className="mt-2 flex gap-2"
          >
            <input
              name="content"
              placeholder="Comentar..."
              required
              className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Enviar
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
