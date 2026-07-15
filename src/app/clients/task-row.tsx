"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { todayDateString } from "@/lib/today";
import { formatCompactTaskDate } from "@/lib/format";
import { saveFocusForReturn } from "@/lib/focus-restore";
import type { TaskStatus, TaskType, TeamMemberStatus } from "@/lib/supabase/database.types";
import { completeTaskAction } from "./tasks-actions";

/** `redirect()` de dentro de um Server Action lança um erro especial com
 * `digest` começando em "NEXT_REDIRECT" — precisa deixar esse erro
 * atravessar sem tratar como falha (senão o redirecionamento de
 * `completeTaskAction` pra "tarefa não encontrada" nunca aconteceria). */
function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export interface TaskListItem {
  id: string;
  title: string;
  type: TaskType;
  due_date: string;
  status: TaskStatus;
  assignee: { name: string; status: TeamMemberStatus } | null;
}

const dueDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDueDate(value: string): string {
  return dueDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

/**
 * Linha densa de tarefa — ordem fixa [conclusão] [data] [tarefa]
 * [responsável] [status temporal] [ações], seguindo a prioridade de leitura
 * do gestor (feito? quando? o quê? quem? precisa de atenção?). Cada sinal
 * aparece uma única vez — tarefa feita é só o check verde + linha com
 * opacidade reduzida (sem tachado nem badge "Feito"); tarefa atrasada é só
 * o círculo/data em vermelho discreto + badge "Atrasado" (nunca a linha
 * inteira vermelha); tarefa futura normal não tem nenhum badge. O tipo da
 * tarefa não aparece ao lado do título porque as tarefas geradas por
 * template já têm o tipo como próprio título (ex.: "Otimização") — mostrar
 * os dois seria repetir a mesma palavra duas vezes na mesma linha.
 * Observações, editar e comentários não ficam permanentemente na linha —
 * clicar no título ou no "•••" abre o drawer lateral (TaskDrawerPanel) com
 * os detalhes completos. Os links pro drawer usam `scroll={false}`: é a
 * mesma página (só o search param `task` muda), então não faz sentido
 * pular pro topo. Reaproveitada em TaskList (tarefas soltas), SprintTaskList
 * (tarefas da sprint) e SprintClientGroup (tela Sprints) — qualquer ajuste
 * visual aqui reflete nos três lugares.
 *
 * Interaction & Motion System 1.0: concluir tarefa é UI otimista
 * (`useOptimistic`) — o círculo vira check verde no clique, antes de
 * `completeTaskAction` responder; o Server Action continua sendo a única
 * fonte de verdade (nenhuma regra de conclusão muda), só a espera some da
 * experiência. Se a ação falhar (exceto o redirect esperado de "tarefa não
 * encontrada"), o `useOptimistic` volta sozinho ao estado real assim que a
 * transition termina, e uma mensagem discreta explica o que aconteceu.
 */
export function TaskRow({
  task,
  clientId,
  detailsHref,
  hideAssigneeIfName,
}: {
  task: TaskListItem;
  clientId: string;
  detailsHref: string;
  /** Some a coluna de responsável quando ele for esse nome (ex.: o gestor
   * principal do cliente, já identificado no cabeçalho — usado só pela
   * tela Sprints, pra não repetir a mesma informação em toda linha). Tarefa
   * sem responsável ou com um responsável diferente continua aparecendo. */
  hideAssigneeIfName?: string;
}) {
  const effectiveStatus = effectiveTaskStatus(task);
  const [isDone, setOptimisticDone] = useOptimistic(effectiveStatus === "feito");
  const [, startTransition] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);
  const isNotDone = effectiveStatus === "nao_realizado";
  const isOverdue = effectiveStatus === "atrasado";
  const isToday = task.due_date === todayDateString();
  const isFuture = effectiveStatus === "pendente" && !isToday && task.due_date > todayDateString();
  const dueDate = formatCompactTaskDate(task.due_date);

  const dateClasses = isOverdue
    ? "text-red-600 dark:text-red-400"
    : isToday && !isDone
      ? "text-brand"
      : "text-muted-foreground";

  const rowOpacityClass = isDone || isNotDone ? "opacity-60" : isFuture ? "opacity-70" : "";

  function handleComplete() {
    setCompleteError(null);
    startTransition(async () => {
      setOptimisticDone(true);
      try {
        await completeTaskAction(task.id, clientId);
      } catch (error) {
        if (isRedirectSignal(error)) throw error;
        setCompleteError("Não foi possível concluir. Tente novamente.");
      }
    });
  }

  return (
    <li className="border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <div className={`flex items-center gap-2.5 transition-opacity duration-150 ${rowOpacityClass}`}>
        {isDone ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] leading-none text-green-700 dark:bg-green-950 dark:text-green-300">
            ✓
          </span>
        ) : isNotDone ? (
          <span
            aria-label="Não realizado"
            title="Não realizado"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] leading-none text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          >
            ×
          </span>
        ) : (
          <button
            type="button"
            onClick={handleComplete}
            aria-label="Marcar como feito"
            title="Marcar como feito"
            className={`block h-4 w-4 shrink-0 rounded-full border-2 transition-colors hover:border-brand hover:bg-brand/10 ${
              isOverdue
                ? "border-red-400 dark:border-red-700"
                : isToday
                  ? "border-brand"
                  : "border-zinc-300 dark:border-zinc-600"
            }`}
          />
        )}

        <span className={`w-20 shrink-0 text-xs tabular-nums ${dateClasses}`}>{dueDate}</span>

        <Link
          href={detailsHref}
          scroll={false}
          onClick={(event) => saveFocusForReturn(event.currentTarget)}
          className="min-w-0 flex-1 truncate"
        >
          <span className="text-sm font-medium text-foreground">{task.title}</span>
        </Link>

        {(!hideAssigneeIfName || task.assignee?.name !== hideAssigneeIfName) && (
          <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground md:block">
            {task.assignee?.name ?? "Sem responsável"}
            {task.assignee?.status === "inativo" && " (inativo)"}
          </span>
        )}

        <span className="hidden w-16 shrink-0 sm:block">
          {!isDone && isOverdue && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              Atrasado
            </span>
          )}
          {!isDone && !isOverdue && isToday && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">Hoje</span>
          )}
          {isNotDone && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Não realizado
            </span>
          )}
        </span>

        <Link
          href={detailsHref}
          scroll={false}
          onClick={(event) => saveFocusForReturn(event.currentTarget)}
          aria-label="Abrir detalhes da tarefa"
          title="Abrir detalhes"
          className="shrink-0 rounded px-1 text-sm text-muted-foreground transition-colors hover:text-brand"
        >
          •••
        </Link>
      </div>
      {completeError && <p className="mt-0.5 pl-[26px] text-[11px] text-red-600 dark:text-red-400">{completeError}</p>}
    </li>
  );
}
