"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { effectiveTaskStatus } from "@/lib/task-status";
import { useOptimisticTasks } from "@/lib/optimistic-tasks";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { TaskRow, type TaskListItem } from "./task-row";
import { RecurringTaskRow } from "./recurring-task-row";
import type { RecurringTaskListItem } from "@/lib/recurring-task-data";
import { orderTasks } from "./task-order";
import { InlineCreateTaskForm, type InlineTaskManagerOption } from "./inline-task-form";
import { deleteTaskAction } from "./tasks-actions";
import {
  ACTIVITY_COL_ACTIONS,
  ACTIVITY_COL_DATE_COMPACT,
  ACTIVITY_COL_SELECT,
  ACTIVITY_COL_STATUS,
} from "./activity-columns";

type TaskFilter = "todas" | "pendentes" | "atrasadas" | "concluidas";

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendentes", label: "Pendentes" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "concluidas", label: "Concluídas" },
];

const CANCEL_CLASSES =
  "mitza-pressable rounded-md border border-overview-border px-3 py-1.5 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60";
// Mesmo tratamento visual de "Excluir cliente" (delete-client-button.tsx) —
// a plataforma nunca usou um botão vermelho preenchido, sempre contorno +
// texto vermelho. Reaproveitado aqui em vez de inventar uma variante nova.
const DESTRUCTIVE_CLASSES =
  "mitza-pressable rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950";

function matchesFilter(task: TaskListItem, filter: TaskFilter): boolean {
  if (filter === "todas") return true;
  const status = effectiveTaskStatus(task);
  if (filter === "pendentes") return status === "pendente";
  if (filter === "atrasadas") return status === "atrasado";
  return status === "feito";
}

function buildCompactSummary(counts: { todas: number; pendentes: number; atrasadas: number }): string {
  const parts = [`${counts.todas} ${counts.todas === 1 ? "tarefa" : "tarefas"}`];
  if (counts.pendentes > 0) parts.push(`${counts.pendentes} pendente${counts.pendentes === 1 ? "" : "s"}`);
  if (counts.atrasadas > 0) parts.push(`${counts.atrasadas} atrasada${counts.atrasadas === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Confirmação de exclusão em massa — mesmo padrão visual de
 * `AgencyTransferDialog` (backdrop + `mitza-modal-in`, `role="dialog"`).
 * Exclusão de tarefa é PERMANENTE (`deleteTaskAction` faz `.delete()` de
 * verdade — não existe soft delete/arquivamento pra tarefa, diferente de
 * cliente), por isso o texto é explícito sobre isso, em vez de um genérico
 * "mover para exclusão" que sugeriria uma lixeira reversível inexistente.
 */
function BulkDeleteConfirmDialog({
  count,
  pending,
  onCancel,
  onConfirm,
}: {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Cancelar exclusão"
        onClick={onCancel}
        disabled={pending}
        className="mitza-backdrop-in fixed inset-0 z-50 bg-black/30"
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-16 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          className="mitza-modal-in w-full max-w-sm rounded-lg border border-overview-border bg-overview-surface p-4 shadow-lg"
        >
          <h2 id="bulk-delete-title" className="text-sm font-semibold text-overview-text-primary">
            Excluir tarefas selecionadas?
          </h2>
          <p className="mt-1.5 text-sm text-overview-text-secondary">
            Esta ação exclui permanentemente {count} {count === 1 ? "tarefa" : "tarefas"}. Não pode ser desfeita.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={pending} className={CANCEL_CLASSES}>
              Cancelar
            </button>
            <button type="button" onClick={onConfirm} disabled={pending} className={DESTRUCTIVE_CLASSES}>
              {pending ? "Excluindo..." : "Excluir tarefas"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * "Tarefas de {mês}" (Etapa "Tarefas e Sprints separadas") — novo módulo
 * principal da página do cliente: substitui a antiga "Foco agora"
 * (`SprintFocusBar`, removida sem substituto) e "Outras tarefas" (tarefas
 * soltas, absorvidas aqui). Reúne numa lista só TODAS as tarefas do mês —
 * das sprints do período + soltas — em vez de cada sprint gerenciar sua
 * própria fila (`Cliente → Sprint → Tarefas` virou `Cliente → Tarefas →
 * Sprint [referência]`). A relação com a sprint continua existindo nos
 * dados (`sprint_id`), só não aparece mais nesta tabela (Etapa "Simplificar
 * tabela de Tarefas do mês" — ver `hideAssignee`/`compactDate` em
 * `TaskRow`).
 *
 * Reaproveita 100% da infraestrutura de `TaskList` (`useOptimisticTasks`,
 * `InlineCreateTaskForm`, `TaskRow`) — nenhuma tarefa, ação ou regra nova,
 * só uma superfície de leitura/filtro maior. Tarefas criadas aqui nascem
 * soltas (`sprintId: null`), mesmo contrato de sempre — vincular a uma
 * sprint específica na criação fica para uma etapa futura, quando a
 * relação Tarefas/Sprints for revisada conceitualmente (ver nota do
 * pedido: esta é a primeira reorganização visual).
 *
 * Etapa "Simplificar tabela de Tarefas do mês": colunas fixas
 * [seleção][status][prazo][tarefa][ações] em toda linha, sem responsável
 * nem sprint (ruído nesta visão — o responsável já é implícito pelo gestor
 * dono do cliente) e sem subtítulo sob o título (a tarefa é o único
 * conteúdo com peso visual da linha). `orderTasks` continua ordenando por
 * `due_date`, nunca por status.
 *
 * Etapa "Seleção em massa e recolhimento": quem chama passa `key={monthLabel}`
 * (ver `[id]/page.tsx`) — trocar de mês remonta o componente do zero, o que
 * já limpa seleção/filtro/recolhimento sozinho, sem precisar de um efeito
 * dedicado só pra isso.
 *
 * Recolher/expandir NÃO usa `<details>` nativo (padrão das Sprints): o
 * cabeçalho aberto tem controles interativos (filtros, checkbox, botões)
 * que ficariam dentro do `<summary>` clicável, disparando o toggle da
 * accordion por engano a cada clique num filtro. Em vez disso, um `<button
 * aria-expanded>` só no cluster ícone+título+contador — mesmo token visual
 * do chevron (`mitza-chevron`), comportamento de accordion equivalente, sem
 * o conflito de clique.
 */
export function MonthTasksPanel({
  monthLabel,
  tasks,
  clientId,
  managers,
  isAdmin,
  canOperate = true,
  recurringTasks,
  recurringTaskHrefPrefix,
}: {
  monthLabel: string;
  tasks: TaskListItem[];
  clientId: string;
  managers: InlineTaskManagerOption[];
  /** Seleção em massa e exclusão só aparecem pra admin — mesma permissão de
   * sempre da exclusão individual (`deleteTaskAction`/"•••" já exigem
   * admin); não faz sentido mostrar checkboxes a quem nunca vê "Excluir". */
  isAdmin?: boolean;
  canOperate?: boolean;
  /** Reformulação do sistema de tarefas (28/07) — recorrências da sprint
   * ATUAL do cliente (só quando o mês exibido é o corrente; um mês passado/
   * futuro não tem uma única sprint óbvia pra reportar progresso, então
   * quem chama simplesmente não passa nada). Sempre visíveis no topo,
   * fora dos filtros Todas/Pendentes/Atrasadas/Concluídas (não fazem
   * sentido pra uma recorrência — ela nunca "atrasa" nem "conclui") e fora
   * da seleção em massa. */
  recurringTasks?: RecurringTaskListItem[];
  recurringTaskHrefPrefix?: string;
}) {
  const [optimisticTasks, dispatchOptimisticTask] = useOptimisticTasks(tasks);
  const [filter, setFilter] = useState<TaskFilter>("todas");
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const { showToast } = useToast();
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const counts = {
    todas: optimisticTasks.length,
    pendentes: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "pendente").length,
    atrasadas: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "atrasado").length,
    concluidas: optimisticTasks.filter((t) => effectiveTaskStatus(t) === "feito").length,
  };

  const ordered = orderTasks(optimisticTasks);
  const filtered = ordered.filter((task) => matchesFilter(task, filter));
  const recurringTasksList = recurringTasks ?? [];

  // Regra "sem seleção invisível": a contagem/indicadores e a exclusão em
  // massa NUNCA leem `selected` puro — sempre a interseção com `filtered`
  // (o que está de fato visível agora). Isso cobre sozinho o caso de uma
  // tarefa selecionada sumir por exclusão individual (pelo "•••"): ela some
  // de `optimisticTasks`/`filtered` e a interseção já reflete isso, sem
  // precisar de um efeito derivando estado (`setState` dentro de `useEffect`
  // só pra sincronizar dado que já pode ser calculado durante o render).
  // A troca de FILTRO — a única mudança de visibilidade puramente local,
  // sem nenhum evento de servidor — poda `selected` de verdade dentro do
  // próprio `onClick` do filtro (abaixo), não aqui.
  const visibleSelectedIds = filtered.filter((t) => selected.has(t.id)).map((t) => t.id);
  const selectedCount = visibleSelectedIds.length;
  const allVisibleSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const someVisibleSelected = filtered.some((t) => selected.has(t.id));

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const t of filtered) next.delete(t.id);
        return next;
      }
      const next = new Set(prev);
      for (const t of filtered) next.add(t.id);
      return next;
    });
  }

  function toggleSelectOne(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function handleBulkDelete() {
    const ids = visibleSelectedIds;
    startDeleteTransition(async () => {
      const results = await Promise.all(
        ids.map(async (taskId) => {
          try {
            // Reaproveita exatamente `deleteTaskAction` — a mesma Server
            // Action que o menu "•••" já usa pra exclusão individual (mesma
            // permissão de admin, mesma exclusão permanente, mesmo evento
            // de auditoria TASK_DELETED). Nenhuma lógica de exclusão nova.
            const result = await deleteTaskAction(taskId, clientId);
            return { taskId, error: result?.error };
          } catch (err) {
            if (isRedirectSignal(err)) throw err;
            return { taskId, error: "Não foi possível excluir." };
          }
        }),
      );

      const failed = results.filter((r) => r.error);
      const succeeded = results.filter((r) => !r.error);

      for (const { taskId } of succeeded) {
        dispatchOptimisticTask({ type: "delete", taskId });
      }

      if (failed.length > 0) {
        showToast(
          succeeded.length > 0
            ? `${succeeded.length} exclu${succeeded.length === 1 ? "ída" : "ídas"}, ${failed.length} falhou/falharam.`
            : "Não foi possível excluir as tarefas selecionadas.",
          "error",
        );
      } else {
        showToast(`${succeeded.length} tarefa${succeeded.length === 1 ? "" : "s"} excluída${succeeded.length === 1 ? "" : "s"}.`);
      }

      setSelected(new Set());
      setConfirmOpen(false);
    });
  }

  const showSelectionUi = Boolean(isAdmin);

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setExpanded((current) => {
              const next = !current;
              // "prefiro limpar para evitar ações invisíveis" — recolher
              // sempre limpa a seleção, nunca a mantém escondida.
              if (!next) setSelected(new Set());
              return next;
            });
          }}
          aria-expanded={expanded}
          className="mitza-pressable flex min-w-0 items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span
            className={`mitza-chevron shrink-0 text-xs text-overview-text-secondary ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          >
            ▸
          </span>
          <h2 className="truncate text-base font-medium text-overview-text-primary">Tarefas de {monthLabel}</h2>
          <span className="shrink-0 text-xs font-normal text-overview-text-secondary">
            {expanded && selectedCount > 0
              ? `${selectedCount} selecionada${selectedCount === 1 ? "" : "s"}`
              : expanded
                ? `${counts.todas} ${counts.todas === 1 ? "tarefa" : "tarefas"}`
                : buildCompactSummary(counts)}
          </span>
        </button>

        {expanded &&
          (selectedCount > 0 ? (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="font-medium text-overview-text-secondary hover:underline"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Excluir
              </button>
            </div>
          ) : (
            canOperate && (
              <InlineCreateTaskForm
                clientId={clientId}
                sprintId={null}
                managers={managers}
                onCreated={(task) => dispatchOptimisticTask({ type: "create", task })}
              />
            )
          ))}
      </div>

      {expanded && (
        <>
          {selectedCount === 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`mitza-pressable rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    filter === key
                      ? "border-brand bg-brand text-white"
                      : "border-overview-border text-overview-text-secondary hover:border-brand hover:text-brand"
                  }`}
                >
                  {label}
                  <span className="ml-1 tabular-nums opacity-80">{counts[key]}</span>
                </button>
              ))}
            </div>
          )}

          {filtered.length > 0 || recurringTasksList.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-lg border border-overview-border">
              <div className="flex items-center gap-2.5 border-b border-overview-border bg-overview-surface-subtle px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">
                {showSelectionUi && (
                  <span className={ACTIVITY_COL_SELECT}>
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label={
                        allVisibleSelected ? "Desmarcar todas as tarefas visíveis" : "Selecionar todas as tarefas visíveis"
                      }
                      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand"
                    />
                  </span>
                )}
                <span className={`${ACTIVITY_COL_STATUS} truncate`} aria-hidden="true" />
                <span className={ACTIVITY_COL_DATE_COMPACT}>Próxima execução</span>
                <span className="min-w-0 flex-1">Tarefa</span>
                <span className={ACTIVITY_COL_ACTIONS} aria-hidden="true" />
              </div>
              <ul className="[&>li:last-child]:border-0">
                {recurringTasksList.map((item) => (
                  <RecurringTaskRow
                    key={`recurring-${item.id}`}
                    item={item}
                    detailHref={
                      recurringTaskHrefPrefix ? `${recurringTaskHrefPrefix}${item.id}` : `/clients/${clientId}?recurringTask=${item.id}`
                    }
                    dateColClassName={ACTIVITY_COL_DATE_COMPACT}
                    showAssigneeCol={false}
                    selectColClassName={showSelectionUi ? ACTIVITY_COL_SELECT : undefined}
                  />
                ))}
                {filtered.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    clientId={clientId}
                    detailsHref={`/clients/${clientId}?task=${task.id}`}
                    isAdmin={isAdmin}
                    canOperate={canOperate}
                    hideAssignee
                    compactDate
                    selected={showSelectionUi ? selected.has(task.id) : undefined}
                    onToggleSelect={showSelectionUi ? () => toggleSelectOne(task.id) : undefined}
                    onOptimisticComplete={() => dispatchOptimisticTask({ type: "complete", taskId: task.id })}
                    onOptimisticDelete={() => dispatchOptimisticTask({ type: "delete", taskId: task.id })}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState className="mt-2">
              {filter === "todas" ? "Nenhuma tarefa neste mês." : "Nenhuma tarefa neste filtro."}
            </EmptyState>
          )}
        </>
      )}

      {confirmOpen && (
        <BulkDeleteConfirmDialog
          count={selectedCount}
          pending={isDeleting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  );
}
