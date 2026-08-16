"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { effectiveTaskStatus } from "@/lib/task-status";
import { restoreFocusForReturn } from "@/lib/focus-restore";
import { formatDateTime } from "@/lib/format";
import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { formatDueDate } from "@/app/clients/task-row";
import { completeTaskAction, deleteTaskAction } from "@/app/clients/tasks-actions";
import { createCommentAction } from "@/app/clients/comments-actions";
import { DeleteTaskButton } from "@/app/clients/delete-task-button";
import { InlineEditTaskForm, type InlineTaskManagerOption } from "@/app/clients/inline-task-form";
import { useToast } from "@/app/toast-provider";
import type { CommentItem } from "@/app/clients/comment-thread";
import type { OperationTaskItem } from "./operation-data";

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
  canOperate = true,
}: {
  task: OperationTaskItem;
  clientId: string;
  clientName: string;
  sprintPeriodLabel: string | null;
  comments: CommentItem[];
  closeHref: string;
  returnTo: string;
  isAdmin: boolean;
  /** Etapa "MITZA Workspace-First Tasks 1.0": deixou de ser opcional —
   * todo chamador agora passa a lista de gestores ativos, pra "Editar
   * tarefa" nunca mais precisar navegar pra fora do drawer. */
  managers: InlineTaskManagerOption[];
  /** Princípio "Workspace = só cliente ativo" — `false` quando o cliente
   * está pausado/encerrado: esconde "Marcar como feito", o formulário de
   * edição e o composer de comentário (histórico continua 100% visível).
   * Omitir preserva o comportamento de sempre (`true`) — a Operação nunca
   * passa esta prop porque já só mostra cliente ativo. */
  canOperate?: boolean;
}) {
  const status = effectiveTaskStatus(task);
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [isCompletePending, startCompleteTransition] = useTransition();
  const [isCommentPending, startCommentTransition] = useTransition();
  const commentFormRef = useRef<HTMLFormElement>(null);
  const { showToast } = useToast();

  function handleComplete() {
    startCompleteTransition(async () => {
      const result = await completeTaskAction(task.id, clientId);
      if (result?.error) {
        showToast(result.error, "error");
        return;
      }
      showToast(`"${task.title}" concluída.`);
    });
  }

  function handleCommentSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startCommentTransition(async () => {
      const result = await createCommentAction("task", task.id, clientId, formData);
      if (result?.error) {
        showToast(result.error, "error");
        return;
      }
      form.reset();
    });
  }

  /**
   * Interaction Physics 1.0 (piloto) — este é o único drawer com animação de
   * SAÍDA nesta rodada. A resposta visual começa na hora (`isClosing` troca
   * a classe de entrada pela de saída no mesmo clique); a navegação de
   * verdade (que desmonta o componente) só acontece quando a animação do
   * painel termina de fato (`animationend`), nunca num tempo fixo chutado em
   * JS — se a duração do token mudar em globals.css, este código não precisa
   * mudar junto. `closeHref` continua sendo a única fonte da URL de destino,
   * só adiada: nenhuma lógica de navegação nova, só o momento em que ela roda.
   */
  useEffect(() => {
    if (!isClosing) return;
    const node = panelRef.current;
    if (!node) return;
    let done = false;
    function finishClose() {
      if (done) return;
      done = true;
      restoreFocusForReturn();
      router.push(closeHref, { scroll: false });
    }
    node.addEventListener("animationend", finishClose);
    // Rede de segurança: se por algum motivo o evento não disparar, ainda
    // fecha (só bem mais devagar que qualquer animação real da plataforma).
    const safetyTimeout = setTimeout(finishClose, 500);
    return () => {
      node.removeEventListener("animationend", finishClose);
      clearTimeout(safetyTimeout);
    };
  }, [isClosing, router, closeHref]);

  function requestClose(event: React.MouseEvent<HTMLAnchorElement>) {
    // Clique modificado (nova aba, etc.) continua nativo — só o clique
    // simples de fechar é interceptado pra dar tempo da animação de saída.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setIsClosing(true);
  }

  return (
    <>
      <Link
        href={closeHref}
        scroll={false}
        onClick={requestClose}
        className={`${isClosing ? "mitza-backdrop-out" : "mitza-backdrop-in"} fixed inset-0 z-40 bg-black/30`}
        aria-label="Fechar"
      />
      <div
        ref={panelRef}
        className={`${isClosing ? "mitza-panel-out" : "mitza-panel-in"} fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-overview-text-secondary">
              {clientName}
              {sprintPeriodLabel ? ` · ${sprintPeriodLabel}` : ""}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-overview-text-primary">{task.title}</h2>
          </div>
          <Link
            href={closeHref}
            scroll={false}
            onClick={requestClose}
            autoFocus
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary transition-colors hover:bg-overview-surface-hover"
          >
            Fechar
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[status]}`}>
            {TASK_STATUS_LABEL[status]}
          </span>
          <span className="text-xs text-overview-text-secondary">{TASK_TYPE_LABEL[task.type]}</span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-overview-text-secondary">Responsável</dt>
            <dd className="text-overview-text-primary">{task.assignee?.name ?? "Sem responsável"}</dd>
          </div>
          <div>
            <dt className="text-overview-text-secondary">Prazo</dt>
            <dd className="text-overview-text-primary">{formatDueDate(task.due_date)}</dd>
          </div>
        </dl>

        {task.notes && (
          <div className="mt-4">
            <p className="text-xs font-medium text-overview-text-secondary">Observações</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-overview-text-primary">{task.notes}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {status !== "feito" && canOperate && (
            <button
              type="button"
              disabled={isCompletePending}
              onClick={handleComplete}
              className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCompletePending ? "Concluindo..." : "Marcar como feito"}
            </button>
          )}
          {/* Etapa "MITZA Workspace-First Tasks 1.0" (Parte 5): "Editar
              tarefa" nunca mais navega pra `/tasks/{id}/edit` — o drawer é
              a única superfície de edição, em qualquer tela de origem.
              Workspace = só cliente ativo: cliente pausado/encerrado não
              vê o formulário de edição — só consulta os dados acima. */}
          {canOperate && (
            <InlineEditTaskForm
              taskId={task.id}
              clientId={clientId}
              managers={managers}
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
              defaultNotes={task.notes}
            />
          )}
          {isAdmin && (
            <DeleteTaskButton
              action={(formData) => deleteTaskAction(task.id, clientId, formData)}
              taskTitle={task.title}
              returnTo={returnTo}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            />
          )}
        </div>

        <div className="mt-5 border-t border-overview-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-overview-text-secondary">Comentários</p>

          {comments.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {comments.map((comment) => (
                <li key={comment.id} className="text-xs text-overview-text-secondary">
                  <span className="font-medium text-overview-text-primary">{comment.author?.name ?? "Alguém"}</span>{" "}
                  · {formatDateTime(comment.created_at)}
                  <p className="text-overview-text-primary">{comment.content}</p>
                </li>
              ))}
            </ul>
          )}

          {canOperate && (
            <form ref={commentFormRef} onSubmit={handleCommentSubmit} className="mt-2 flex gap-2">
              <input
                name="content"
                placeholder="Comentar..."
                required
                disabled={isCommentPending}
                className="flex-1 rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary outline-none transition-colors focus:border-overview-border-strong disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isCommentPending}
                className="mitza-pressable shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCommentPending ? "Enviando..." : "Enviar"}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
