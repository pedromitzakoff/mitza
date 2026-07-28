import Link from "next/link";
import type { RecurringTaskListItem } from "@/lib/recurring-task-data";
import { ACTIVITY_COL_ACTIONS, ACTIVITY_COL_ASSIGNEE, ACTIVITY_COL_DATE, ACTIVITY_COL_STATUS, ACTIVITY_COL_TYPE } from "./activity-columns";

/**
 * Linha de UMA recorrência — usada tanto na fila "Atividades" de `/sprints`
 * quanto em "Tarefas de {mês}" (`MonthTasksPanel`), que têm grades de coluna
 * ligeiramente diferentes (a segunda não tem coluna de responsável, usa data
 * compacta e às vezes reserva uma coluna de seleção em massa) — por isso os
 * props de largura de coluna são configuráveis, com o padrão de
 * `activity-columns.ts` de `/sprints`.
 *
 * Etapa "Simplificar linha das recorrentes": a linha responde só à pergunta
 * "o que preciso fazer agora e quanto falta esta semana?" — próxima
 * execução (coluna de data, antes vazia), nome, progresso compacto ("0/2") e
 * a seta pro drawer. Contexto histórico (pendência da sprint anterior) saiu
 * daqui de propósito — competia com a informação atual e agora só existe
 * dentro do drawer (`RecurringTaskDrawer`).
 *
 * Clica pra abrir o drawer — mesmo padrão de `AccountReviewRow` (link pra um
 * `detailHref`, nunca expansão inline como `TaskRow`, já que recorrência não
 * tem campos rápidos pra editar na linha).
 */
export function RecurringTaskRow({
  item,
  detailHref,
  typeLabel,
  dateColClassName = ACTIVITY_COL_DATE,
  showAssigneeCol = true,
  selectColClassName,
}: {
  item: RecurringTaskListItem;
  detailHref: string;
  typeLabel?: string;
  /** Largura da coluna de data — `MonthTasksPanel` usa `ACTIVITY_COL_DATE_COMPACT`. */
  dateColClassName?: string;
  /** `MonthTasksPanel` não tem coluna de responsável (é sempre implícito
   * pelo gestor dono do cliente) — omitir o espaçador evita um buraco. */
  showAssigneeCol?: boolean;
  /** `MonthTasksPanel` reserva uma coluna de seleção em massa só pra admin —
   * passar a largura aqui mantém a recorrência alinhada com as tarefas
   * comuns da mesma lista, mesmo sem checkbox próprio (recorrência nunca
   * entra na seleção/exclusão em massa). */
  selectColClassName?: string;
}) {
  const { progress } = item;
  const progressLabel = progress.goal === null ? `${progress.done}` : `${progress.done}/${progress.goal}`;

  return (
    <li className="flex min-h-[28px] items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <Link href={detailHref} scroll={false} className="flex w-full items-center gap-2.5">
        {selectColClassName && <span className={selectColClassName} aria-hidden="true" />}

        <span className={ACTIVITY_COL_STATUS} aria-hidden="true">
          <span className="text-sm leading-none">{item.icon}</span>
        </span>

        <span className={`${dateColClassName} truncate`}>{item.nextExecutionLabel}</span>

        <span className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium text-foreground">{item.title}</span>
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{progressLabel}</span>
        </span>

        {showAssigneeCol && <span className={ACTIVITY_COL_ASSIGNEE} aria-hidden="true" />}

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
