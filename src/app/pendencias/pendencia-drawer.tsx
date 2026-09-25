"use client";

import { useEffect, useState } from "react";
import type { PendenciaItem } from "@/lib/pendencias";
import { TASK_STATUS_BADGE_CLASSES, TASK_STATUS_LABEL, TASK_TYPE_LABEL, TASK_PRIORITY_BADGE_CLASSES, TASK_PRIORITY_LABEL } from "@/app/clients/task-labels";
import { formatDueDate } from "@/app/clients/task-row";
import { InlineEditTaskForm, type InlineTaskManagerOption } from "@/app/clients/inline-task-form";
import { CommentThread, type CommentItem } from "@/app/clients/comment-thread";
import { listTaskCommentsAction } from "./pendencias-actions";
import { useToast } from "@/app/toast-provider";

/**
 * IMPORTANTE: quem renderiza este componente deve passar `key={item.id}` —
 * é isso que reseta o estado de comentários ao trocar de pendência (troca
 * de `key` remonta o componente do zero), em vez de um efeito chamando
 * `setState` sincronamente no corpo (padrão desencorajado pelo React).
 *
 * Drawer lateral da pendência (seção 6 do pedido: "nunca navegação de
 * página inteira") — reaproveita `InlineEditTaskForm` (título/tipo/
 * responsável/prazo/observações, o mesmo formulário já usado pelo drawer
 * de `/operation`) e `CommentThread` (histórico de comentários) em vez de
 * reconstruir qualquer uma das duas coisas do zero. Responsável/status/
 * prioridade/prazo já são editáveis direto na linha da lista — este
 * formulário cobre o resto (título, tipo, observações).
 *
 * Comentários só existem aqui pra pendências de CLIENTE: `createCommentAction`
 * exige `clientId` (não aceita pendência interna) — infraestrutura
 * existente, não recriada nem forçada a aceitar um caso que não suporta.
 */
export function PendenciaDrawer({
  item,
  managers,
  onClose,
}: {
  item: PendenciaItem;
  managers: InlineTaskManagerOption[];
  onClose: () => void;
}) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const { showToast } = useToast();
  const isTerminal = item.status === "feito" || item.status === "nao_realizado";

  useEffect(() => {
    let cancelled = false;
    listTaskCommentsAction(item.id).then((result) => {
      if (cancelled) return;
      if (result.error) {
        showToast(result.error, "error");
        setComments([]);
        return;
      }
      setComments(result.comments ?? []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast é estável (contexto), só o id importa pra refazer a busca.
  }, [item.id]);

  return (
    <>
      <button type="button" aria-label="Fechar" onClick={onClose} className="fixed inset-0 z-40 bg-black/30" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-overview-text-secondary">{item.client?.name ?? "Interna"}</p>
            <h2 className="mt-0.5 text-lg font-semibold text-overview-text-primary">{item.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary transition-colors hover:bg-overview-surface-hover"
          >
            Fechar
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[item.status]}`}>
            {TASK_STATUS_LABEL[item.status]}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_PRIORITY_BADGE_CLASSES[item.priority]}`}>
            {TASK_PRIORITY_LABEL[item.priority]}
          </span>
          <span className="text-xs text-overview-text-secondary">{TASK_TYPE_LABEL[item.type]}</span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-overview-text-secondary">Responsável</dt>
            <dd className="text-overview-text-primary">{item.assignee?.name ?? "Sem responsável"}</dd>
          </div>
          <div>
            <dt className="text-overview-text-secondary">Prazo</dt>
            <dd className="text-overview-text-primary">{formatDueDate(item.dueDate)}</dd>
          </div>
        </dl>

        {!isTerminal && (
          <div className="mt-4">
            <InlineEditTaskForm
              taskId={item.id}
              clientId={item.client?.id ?? null}
              managers={managers}
              defaultTitle={item.title}
              defaultType={item.type}
              defaultAssigneeId={item.assignee?.id ?? null}
              defaultDueDate={item.dueDate}
              defaultNotes={item.notes}
              open
              hideTrigger
              onOpenChange={() => {}}
            />
          </div>
        )}

        {item.notes && isTerminal && (
          <div className="mt-4">
            <p className="text-xs font-medium text-overview-text-secondary">Observações</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-overview-text-primary">{item.notes}</p>
          </div>
        )}

        <div className="mt-5 border-t border-overview-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-overview-text-secondary">Comentários</p>
          {item.client ? (
            comments === null ? (
              <p className="mt-2 text-xs text-overview-text-secondary">Carregando...</p>
            ) : (
              <CommentThread comments={comments} commentableType="task" commentableId={item.id} clientId={item.client.id} />
            )
          ) : (
            <p className="mt-2 text-xs text-overview-text-secondary">Disponível só para pendências vinculadas a um cliente.</p>
          )}
        </div>
      </div>
    </>
  );
}
