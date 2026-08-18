"use client";

import { useRef, useTransition } from "react";
import type { CommentableType } from "@/lib/supabase/database.types";
import { createCommentAction } from "./comments-actions";
import { toggleCommentReportSelectionAction } from "@/app/reports/report-actions";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/app/submit-button";

export interface CommentItem {
  id: string;
  commentable_id: string;
  content: string;
  created_at: string;
  author: { name: string } | null;
  /** Só populado por quem já sabe se este comentário está marcado "incluir
   * no fechamento mensal" (hoje, só a tela Sprints) — undefined em qualquer
   * outro lugar que renderize CommentThread simplesmente esconde a ação,
   * em vez de arriscar mostrar um estado desatualizado. */
  includedInReport?: boolean;
}

export function CommentThread({
  comments,
  commentableType,
  commentableId,
  clientId,
  returnTo,
  canOperate = true,
}: {
  comments: CommentItem[];
  commentableType: CommentableType;
  commentableId: string;
  clientId: string;
  returnTo?: string;
  /** Princípio "Workspace = só cliente ativo" — `false` quando o cliente
   * está pausado/encerrado: esconde o composer (histórico continua
   * visível). Omitir preserva o comportamento de sempre (`true`). */
  canOperate?: boolean;
}) {
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      try {
        const result = await createCommentAction(commentableType, commentableId, clientId, formData);
        if (result?.error) {
          showToast(result.error, "error");
          return;
        }
        form.reset();
      } catch (error) {
        if (isRedirectSignal(error)) throw error;
        showToast("Não foi possível salvar seu comentário. Tente novamente.", "error");
      }
    });
  }

  return (
    <div className="mt-2 border-t border-overview-border pt-2">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {comments.map((comment) => (
            <li key={comment.id} className="text-xs text-overview-text-secondary">
              <span className="font-medium text-overview-text-primary">{comment.author?.name ?? "Alguém"}</span>{" "}
              · {formatDateTime(comment.created_at)}
              <p>{comment.content}</p>
              {commentableType === "sprint" && comment.includedInReport !== undefined && (
                <form
                  action={toggleCommentReportSelectionAction.bind(
                    null,
                    comment.id,
                    commentableId,
                    clientId,
                    comment.includedInReport,
                  )}
                >
                  <SubmitButton
                    pendingChildren="Salvando..."
                    className={comment.includedInReport ? "font-medium text-brand hover:underline" : "hover:text-brand hover:underline"}
                  >
                    {comment.includedInReport ? "✓ Incluído no relatório mensal" : "Adicionar ao relatório mensal"}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canOperate && (
        <form ref={formRef} onSubmit={handleSubmit} className="mt-1.5 flex gap-2">
          {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
          <input
            id={`comment-content-${commentableId}`}
            name="content"
            placeholder={
              commentableType === "sprint" ? "Registrar decisão, aprendizado ou observação da sprint..." : "Comentar..."
            }
            required
            disabled={isPending}
            className="flex-1 rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary outline-none focus:border-overview-border-strong disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isPending}
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Enviando..." : "Enviar"}
          </button>
        </form>
      )}
    </div>
  );
}
