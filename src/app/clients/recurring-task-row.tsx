import Link from "next/link";
import type { RecurringTaskListItem } from "@/lib/recurring-task-data";
import { formatPreviousSprintPendingLabel } from "@/lib/recurring-tasks";
import { ACTIVITY_COL_ACTIONS, ACTIVITY_COL_ASSIGNEE, ACTIVITY_COL_DATE, ACTIVITY_COL_STATUS, ACTIVITY_COL_TYPE } from "./activity-columns";

/**
 * Linha de UMA recorrência na fila única "Atividades" — MESMA grade de
 * colunas de `TaskRow`/`AccountReviewRow` (`./activity-columns.ts`), pra não
 * "flutuar" entre um tipo de linha e outro. Reformulação do sistema de
 * tarefas (28/07): recorrência nunca "conclui" (sem checkbox/status
 * acionável — a coluna de status aqui só mostra o ícone configurado da
 * recorrência) e não tem uma data-alvo (é sempre "esta sprint inteira"),
 * então a coluna de data fica vazia. O conteúdo central é o progresso da
 * semana ("2/4 execuções nesta semana"), a própria característica que
 * distingue essa linha de uma tarefa comum — princípio do usuário: "a
 * recorrência é uma característica da tarefa, não um novo conceito", por
 * isso ela convive na MESMA lista, nunca numa seção à parte.
 *
 * Clica pra abrir o drawer (`RecurringTaskDrawer`) — mesmo padrão de
 * `AccountReviewRow` (link pra um `detailHref`, nunca expansão inline como
 * `TaskRow`, já que recorrência não tem campos rápidos pra editar na linha).
 */
export function RecurringTaskRow({ item, detailHref, typeLabel }: { item: RecurringTaskListItem; detailHref: string; typeLabel?: string }) {
  const { progress } = item;
  const countLabel =
    progress.goal === null ? `${progress.done} execuções nesta semana` : `${progress.done}/${progress.goal} execuções nesta semana`;

  return (
    <li className="flex min-h-[28px] items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <Link href={detailHref} scroll={false} className="flex w-full items-center gap-2.5">
        <span className={ACTIVITY_COL_STATUS} aria-hidden="true">
          <span className="text-sm leading-none">{item.icon}</span>
        </span>

        <span className={ACTIVITY_COL_DATE} aria-hidden="true" />

        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium text-foreground">{item.title}</span>
          <span className="truncate text-xs text-muted-foreground"> · {countLabel}</span>
          {item.previousSprintPending?.isPending && (
            <span className="ml-1.5 truncate text-xs font-medium text-overview-danger">
              {formatPreviousSprintPendingLabel(item.previousSprintPending)}
            </span>
          )}
        </span>

        <span className={ACTIVITY_COL_ASSIGNEE} aria-hidden="true" />

        {typeLabel && (
          <span className={ACTIVITY_COL_TYPE}>
            <span className="inline-flex max-w-full items-center truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-zinc-800">
              {typeLabel}
            </span>
          </span>
        )}

        <span className={ACTIVITY_COL_ACTIONS}>
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            ›
          </span>
        </span>
      </Link>
    </li>
  );
}
