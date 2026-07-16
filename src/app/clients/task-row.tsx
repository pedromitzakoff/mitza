"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { effectiveTaskStatus } from "@/lib/task-status";
import { Tooltip } from "@/components/ui/tooltip";
import { todayDateString } from "@/lib/today";
import { formatCompactTaskDate } from "@/lib/format";
import { saveFocusForReturn } from "@/lib/focus-restore";
import { useFloatingMenuPosition, FloatingPortalPanel } from "@/lib/floating-menu";
import { useRowExitAnimation } from "@/lib/row-exit-animation";
import { isRedirectSignal } from "@/lib/next-redirect";
import { useToast } from "@/app/toast-provider";
import type { TaskStatus, TaskType, TeamMemberStatus } from "@/lib/supabase/database.types";
import { completeTaskAction, deleteTaskAction } from "./tasks-actions";

const DELETE_CONFIRM_TIMEOUT_MS = 5000;

/**
 * Menu "•••" da tarefa (Etapa "Sprint Workspace Polish 1.0") — antes era um
 * link direto pro drawer; agora é um popover com "Ver detalhes" (mesmo link
 * de sempre) e, só pra admin, "Excluir tarefa". Exclusão rápida sem abrir o
 * drawer: reutiliza a mesma `deleteTaskAction` de sempre (chamada sem
 * `formData`, então ela nunca redireciona — só revalida os dados no lugar,
 * preservando scroll/Sprint aberta/cliente expandido/filtros). Confirmação
 * inline (nunca `window.confirm`): clicar em "Excluir tarefa" troca o item
 * por "Confirmar exclusão? Sim/Não", que desaparece sozinho depois de alguns
 * segundos ou ao clicar fora — igual ao padrão já usado pra reverter a fonte
 * manual do investimento em `sprint-card.tsx`.
 *
 * Etapa "Sprint Workspace Polish 2.0" (Parte 2): o popover renderiza via
 * Portal (`createPortal` pro `document.body`, posição calculada por
 * `useFloatingMenuPosition`) em vez de `position: absolute` dentro do
 * próprio botão. Motivo: dentro da sprint-piloto do protótipo de accordion
 * (`accordionRowsPrototype`, ver `sprint-card.tsx`/globals.css), o
 * `overflow: hidden` do wrapper da animação clipava o menu — ele aparecia
 * atrás do conteúdo, com sombra cortada, e o botão de fechar (que cobre a
 * tela pra detectar clique fora) ficava clipado junto, fazendo o menu
 * "perder clique". Portal escapa desse clipping (e de qualquer outro
 * ancestral com overflow/stacking context) sem depender de onde o menu é
 * usado — mesmo comportamento em todas as listas.
 *
 * Etapa "Instant Action & Context Memory 1.0" (Parte 3): quando quem chama
 * passa `onOptimisticDelete`, a tarefa some da lista ANTES do servidor
 * confirmar (ver `SprintTaskList`) — nesse caso, se a exclusão falhar, este
 * componente já foi desmontado pelo React (a linha sumiu), então o erro
 * inline de sempre (`error`/`setError`) nunca chegaria a ser visto. Por
 * isso o erro vira um toast (`tone: "error"`) nesse caminho — o único canal
 * de feedback que sobrevive à própria linha desaparecer. Sem a prop (telas
 * que ainda não passam otimismo pra cá), nada muda: mensagem inline de
 * sempre, linha nunca some sozinha.
 */
function TaskRowMenu({
  taskId,
  taskTitle,
  clientId,
  detailsHref,
  isAdmin,
  onOptimisticDelete,
  onDeleteStart,
  onDeleteError,
  waitForExit,
}: {
  taskId: string;
  taskTitle: string;
  clientId: string;
  detailsHref: string;
  isAdmin: boolean;
  onOptimisticDelete?: () => void;
  /** Etapa "MITZA Interaction Engine v1" (Parte 6) — dispara a animação de
   * saída da linha (`mitza-row-exit-active`, em `TaskRow`) no instante em
   * que o usuário confirma a exclusão, antes de qualquer chamada ao
   * servidor ou remoção de fato do item. */
  onDeleteStart?: () => void;
  /** Desfaz a animação de saída se a exclusão falhar — a linha "descolapsa"
   * de volta, já que ela nunca chegou a sair da lista de verdade. */
  onDeleteError?: () => void;
  /** Etapa "MITZA Interaction Engine v1.5" — `waitForExit` de
   * `useRowExitAnimation` (`TaskRow`), repassado aqui pra `handleDelete`
   * esperar a transição CSS terminar antes de despachar a remoção real. */
  waitForExit: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const position = useFloatingMenuPosition(triggerRef, open, "right");

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), DELETE_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  function closeMenu() {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }

  function handleDelete() {
    setError(null);
    onDeleteStart?.();
    startTransition(async () => {
      // Espera a animação de saída terminar antes de remover de fato —
      // nunca some instantaneamente.
      await waitForExit();
      onOptimisticDelete?.();
      const result = await deleteTaskAction(taskId, clientId);
      if (result?.error) {
        onDeleteError?.();
        if (onOptimisticDelete) {
          showToast(result.error, "error");
        } else {
          setError(result.error);
        }
        setConfirming(false);
        return;
      }
      showToast(`"${taskTitle}" excluída.`);
      closeMenu();
    });
  }

  return (
    <span className="relative z-10 inline-block shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mais ações da tarefa"
        className="mitza-pressable rounded px-1 text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        •••
      </button>

      <FloatingPortalPanel
        open={open}
        position={position}
        onClose={closeMenu}
        role="menu"
        closeLabel="Fechar menu"
        className="w-44 -translate-x-full rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-float)]"
      >
        <Link
          href={detailsHref}
          scroll={false}
          role="menuitem"
          onClick={(event) => {
            saveFocusForReturn(event.currentTarget);
            closeMenu();
          }}
          className="mitza-pressable block rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
        >
          Ver detalhes
        </Link>

        {isAdmin &&
          (confirming ? (
            <div className="mt-0.5 flex items-center gap-1.5 px-2 py-1">
              <span className="text-[11px] text-muted-foreground">Confirmar exclusão?</span>
              <button
                type="button"
                disabled={isPending}
                onClick={handleDelete}
                className="mitza-pressable rounded px-1 text-[11px] font-medium text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
              >
                {isPending ? "Excluindo..." : "Sim"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="mitza-pressable rounded px-1 text-[11px] text-muted-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Não
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="mitza-pressable block w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand dark:text-red-400 dark:hover:bg-red-950"
            >
              Excluir tarefa
            </button>
          ))}

        {error && <p className="px-2 py-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      </FloatingPortalPanel>
    </span>
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
 * opacidade reduzida (sem tachado nem badge "Feito"); tarefa futura normal
 * não tem nenhum badge. O tipo da tarefa não aparece ao lado do título
 * porque as tarefas geradas por template já têm o tipo como próprio título
 * (ex.: "Otimização") — mostrar os dois seria repetir a mesma palavra duas
 * vezes na mesma linha.
 *
 * Etapa "Sprint Workspace Polish 2.0" (Parte 1): tarefa atrasada tinha três
 * sinais pra mesma informação (círculo vermelho + data vermelha + badge
 * "Atrasado") — o badge saiu, sobra só círculo e data em vermelho discreto.
 *
 * Etapa "Sprint Workspace Polish 2.0" (Parte 6): clicar em qualquer lugar
 * da linha abre a tarefa (antes só o título era clicável) — via um `<Link>`
 * "esticado" (`absolute inset-0`, primeiro filho do `<li>`, que virou
 * `relative`) cobrindo a linha inteira. Checkbox de concluir e o menu "•••"
 * continuam com comportamento próprio: ambos ganham `relative z-10` pra
 * ficar acima do link esticado na ordem de pintura e continuar capturando
 * o próprio clique.
 *
 * Observações, editar e comentários não ficam permanentemente na linha —
 * clicar na linha ou no "•••" abre o drawer lateral (TaskDrawerPanel) com
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
 *
 * Etapa "Instant Action & Context Memory 1.0" (Partes 2-5): quando quem
 * chama passa `onOptimisticComplete`/`onOptimisticDelete` (hoje só
 * `SprintTaskList`), esta linha para de segurar seu próprio
 * `useOptimistic` de conclusão — em vez disso, despacha pro `useOptimistic`
 * COMPARTILHADO da lista inteira (`useOptimisticTasks`), pra que o contador
 * "X/Y concluídas" e a barra de progresso mudem junto com o check, na
 * mesma hora (antes só o check era otimista; o contador esperava o
 * servidor). Sem essas props (`TaskList`/`MonthlyConsolidatedGroup`, que
 * ainda não compartilham um estado de lista), o comportamento de sempre
 * continua: `useOptimistic` local, só o check muda na hora. Em ambos os
 * casos o `useTransition` continua LOCAL a esta linha (Parte 4: nunca um
 * `isPending` global travando a lista inteira, só a linha em processamento
 * fica protegida contra clique duplo). */
export function TaskRow({
  task,
  clientId,
  detailsHref,
  hideAssigneeIfName,
  isAdmin,
  onOptimisticComplete,
  onOptimisticDelete,
}: {
  task: TaskListItem;
  clientId: string;
  detailsHref: string;
  /** Some a coluna de responsável quando ele for esse nome (ex.: o gestor
   * principal do cliente, já identificado no cabeçalho — usado só pela
   * tela Sprints, pra não repetir a mesma informação em toda linha). Tarefa
   * sem responsável ou com um responsável diferente continua aparecendo. */
  hideAssigneeIfName?: string;
  /** Habilita "Excluir tarefa" no menu "•••" (Etapa "Sprint Workspace Polish
   * 1.0") — mesma regra de permissão de sempre (`requireAdmin()` na própria
   * action). Omitir mantém o "•••" como só "Ver detalhes", igual ao
   * comportamento anterior — usado pelas telas que ainda não passam esta
   * prop. */
  isAdmin?: boolean;
  /** Etapa "Instant Action & Context Memory 1.0" — despacha a conclusão
   * pro `useOptimistic` compartilhado da lista (ver doc acima). Opcional:
   * omitir preserva o `useOptimistic` local de antes. */
  onOptimisticComplete?: () => void;
  /** Idem, pra exclusão — repassado ao `TaskRowMenu`. */
  onOptimisticDelete?: () => void;
}) {
  const effectiveStatus = effectiveTaskStatus(task);
  const [localOptimisticDone, setLocalOptimisticDone] = useOptimistic(effectiveStatus === "feito");
  const isDone = onOptimisticComplete ? effectiveStatus === "feito" : localOptimisticDone;
  const [, startTransition] = useTransition();
  const [completeError, setCompleteError] = useState<string | null>(null);
  // Etapa "MITZA Interaction Engine v1" (Parte 6) — a linha encolhe/esmaece
  // (`mitza-row-exit-active`) assim que a exclusão é confirmada, antes de
  // sumir de fato da lista (`TaskRowMenu` chama `onDeleteStart`/espera
  // `waitForExit` antes de despachar a remoção de verdade).
  const { isLeaving, startExit, cancelExit, waitForExit } = useRowExitAnimation();
  const { showToast } = useToast();
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
      if (onOptimisticComplete) {
        onOptimisticComplete();
      } else {
        setLocalOptimisticDone(true);
      }
      try {
        await completeTaskAction(task.id, clientId);
        showToast(`"${task.title}" concluída.`);
      } catch (error) {
        if (isRedirectSignal(error)) throw error;
        setCompleteError("Não foi possível concluir. Tente novamente.");
      }
    });
  }

  return (
    <li
      className={`relative flex min-h-[28px] items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 mitza-row-exit ${isLeaving ? "mitza-row-exit-active" : ""}`}
    >
      <Link
        href={detailsHref}
        scroll={false}
        onClick={(event) => saveFocusForReturn(event.currentTarget)}
        aria-label={task.title}
        className="absolute inset-0 z-0"
      />
      <div className={`flex items-center gap-2.5 transition-opacity duration-150 ${rowOpacityClass}`}>
        {isDone ? (
          <span className="mitza-check-in flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] leading-none text-green-700 dark:bg-green-950 dark:text-green-300">
            ✓
          </span>
        ) : isNotDone ? (
          <Tooltip label="Não realizado">
            <span
              aria-label="Não realizado"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] leading-none text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            >
              ×
            </span>
          </Tooltip>
        ) : (
          <Tooltip label="Marcar como feito">
            <button
              type="button"
              onClick={handleComplete}
              aria-label="Marcar como feito"
              className={`relative z-10 block h-4 w-4 shrink-0 rounded-full border-2 transition-colors hover:border-brand hover:bg-brand/10 ${
                isOverdue
                  ? "border-red-400 dark:border-red-700"
                  : isToday
                    ? "border-brand"
                    : "border-zinc-300 dark:border-zinc-600"
              }`}
            />
          </Tooltip>
        )}

        <span className={`w-20 shrink-0 text-xs tabular-nums ${dateClasses}`}>{dueDate}</span>

        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{task.title}</span>

        {(!hideAssigneeIfName || task.assignee?.name !== hideAssigneeIfName) && (
          <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground md:block">
            {task.assignee?.name ?? "Sem responsável"}
            {task.assignee?.status === "inativo" && " (inativo)"}
          </span>
        )}

        <span className="hidden w-16 shrink-0 sm:block">
          {!isDone && !isOverdue && isToday && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">Hoje</span>
          )}
          {isNotDone && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Não realizado
            </span>
          )}
        </span>

        <TaskRowMenu
          taskId={task.id}
          taskTitle={task.title}
          clientId={clientId}
          detailsHref={detailsHref}
          isAdmin={isAdmin ?? false}
          onOptimisticDelete={onOptimisticDelete}
          onDeleteStart={startExit}
          onDeleteError={cancelExit}
          waitForExit={waitForExit}
        />
      </div>
      {completeError && <p className="mt-0.5 pl-[26px] text-[11px] text-red-600 dark:text-red-400">{completeError}</p>}
    </li>
  );
}
