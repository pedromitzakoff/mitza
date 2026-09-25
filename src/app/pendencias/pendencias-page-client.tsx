"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  filterPendencias,
  groupPendencias,
  parsePendenciasFilters,
  parsePendenciasGroupBy,
  serializePendenciasFilters,
  type PendenciaGroupBy,
  type PendenciaItem,
  type PendenciaQuickFilter,
  type PendenciasFilterState,
} from "@/lib/pendencias";
import { todayDateString } from "@/lib/today";
import type { TaskPriority, TaskStatus } from "@/lib/supabase/database.types";
import { TASK_PRIORITY_OPTIONS, TASK_STATUS_LABEL } from "@/app/clients/task-labels";
import {
  bulkDeleteTasksAction,
  createTaskInlineAction,
  deleteTaskAction,
  duplicateTasksAction,
  reopenTaskAction,
  updateTaskAssigneeInlineAction,
  updateTaskClientInlineAction,
  updateTaskDueDateInlineAction,
  updateTaskPriorityInlineAction,
  updateTaskStatusInlineAction,
  type EditableNonTerminalStatus,
} from "@/app/clients/tasks-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchableMultiSelect, SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/app/toast-provider";
import { PendenciaRow } from "./pendencia-row";
import { PendenciaDrawer } from "./pendencia-drawer";
import type { PendenciasAssigneeOption, PendenciasClientOption } from "./pendencias-data";

const INTERNAL_OPTION_ID = "__interna__";

/**
 * Etapa "Pendências — Demandas": os quick filters passaram a recortar por
 * STATUS, nunca mais por prazo — "Atrasadas"/"Hoje"/"Esta semana" continuam
 * plenamente acessíveis (filtro de status inclui "atrasado"; "Agrupar por
 * Prazo" já tem esses buckets), só deixaram de ser atalho de primeira
 * linha, pra manter a lista de atalhos simples e orientada à pergunta
 * "o que ainda precisa da minha atenção", não "quando vence".
 */
const QUICK_FILTERS: { value: PendenciaQuickFilter; label: string }[] = [
  { value: "abertas", label: "Abertas" },
  { value: "minhas", label: "Minhas" },
  { value: "aguardando", label: "Aguardando" },
  { value: "concluidas", label: "Concluídas" },
];

const GROUP_BY_OPTIONS: { value: PendenciaGroupBy; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "cliente", label: "Cliente" },
  { value: "responsavel", label: "Responsável" },
  { value: "prazo", label: "Prazo" },
  { value: "nenhum", label: "Sem agrupamento" },
];

const EDITABLE_STATUSES: TaskStatus[] = ["pendente", "em_andamento", "aguardando", "bloqueado", "feito", "nao_realizado"];

const fieldClasses =
  "rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary outline-none focus:border-brand";

function QuickCreateForm({
  clientOptions,
  assigneeOptions,
  onCreated,
}: {
  clientOptions: PendenciasClientOption[];
  assigneeOptions: PendenciasAssigneeOption[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cliente/Responsável usam SearchableSelect (não é um <select> nativo,
  // então não aparece em FormData) — estado controlado, mesmo padrão dos
  // filtros do topo da página.
  const [clientId, setClientId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const { showToast } = useToast();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    const dueDate = String(formData.get("due_date") ?? "") || todayDateString();
    const priority = (String(formData.get("priority") ?? "normal") || "normal") as TaskPriority;

    setPending(true);
    setError(null);
    const result = await createTaskInlineAction(clientId, {
      title,
      type: "outro",
      assigneeId,
      dueDate,
      dueTime: null,
      recurrence: "nenhuma",
      notes: null,
      sprintId: null,
      priority,
    });
    setPending(false);
    if (result?.error) {
      showToast(result.error, "error");
      setError(result.error);
      return;
    }
    showToast(result?.message ?? "Demanda criada.");
    (event.target as HTMLFormElement).reset();
    setClientId(null);
    setAssigneeId(null);
    setOpen(false);
    onCreated();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mitza-pressable rounded-md border border-overview-border bg-overview-surface px-3 py-1.5 text-xs font-medium text-overview-text-primary hover:border-brand hover:text-brand"
      >
        + Nova demanda
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-1.5 rounded-md border border-overview-border bg-overview-surface p-2">
      <input name="title" required autoFocus placeholder="Título da demanda" className={`${fieldClasses} min-w-[200px] flex-1`} />
      <div className="w-40">
        <SearchableSelect
          options={clientOptions.map((c) => ({ id: c.id, label: c.name }))}
          selectedId={clientId}
          onSelect={setClientId}
          placeholder="Interna"
          searchPlaceholder="Buscar cliente..."
          ariaLabel="Cliente"
        />
      </div>
      <div className="w-40">
        <SearchableSelect
          options={assigneeOptions.map((m) => ({ id: m.id, label: m.name, sublabel: m.status === "inativo" ? "(inativo)" : undefined }))}
          selectedId={assigneeId}
          onSelect={setAssigneeId}
          placeholder="Sem responsável"
          searchPlaceholder="Buscar responsável..."
          ariaLabel="Responsável"
        />
      </div>
      <input type="date" name="due_date" defaultValue={todayDateString()} className={fieldClasses} aria-label="Prazo" />
      <select name="priority" defaultValue="normal" className={fieldClasses} aria-label="Prioridade">
        {TASK_PRIORITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs text-overview-text-secondary hover:underline"
      >
        Cancelar
      </button>
      {error && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

/**
 * Orquestrador client-side da Etapa "Pendências" — filtro/agrupamento
 * rodam inteiramente no navegador (`lib/pendencias.ts`, puro) sobre os
 * dados já carregados pelo Server Component (`page.tsx`); trocar filtro
 * nunca recarrega a página. A URL é reescrita via `history.replaceState`
 * (nunca `router.push`) a cada mudança — preserva o filtro num link
 * compartilhável sem disparar uma nova busca ao servidor.
 *
 * Edição inline é otimista: cada mutação atualiza `items` na hora e reverte
 * sozinha se a Server Action falhar (nunca mostra um valor não salvo como
 * salvo). `revalidatePath("/pendencias")`, chamado por toda action de
 * `tasks-actions.ts`, faz o Server Component pai buscar dados frescos em
 * segundo plano — quando chegam (prop `items` muda), substituem o estado
 * otimista sem piscar (já estavam corretos).
 */
export function PendenciasPageClient({
  items: initialItems,
  clientOptions,
  assigneeOptions,
  currentTeamMemberId,
  isAdmin,
}: {
  items: PendenciaItem[];
  clientOptions: PendenciasClientOption[];
  assigneeOptions: PendenciasAssigneeOption[];
  currentTeamMemberId: string;
  isAdmin: boolean;
}) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<PendenciasFilterState>(() => parsePendenciasFilters(searchParams));
  const [groupBy, setGroupBy] = useState<PendenciaGroupBy>(() => parsePendenciasGroupBy(searchParams));
  const [items, setItems] = useState(initialItems);
  const [syncedInitialItems, setSyncedInitialItems] = useState(initialItems);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const { showToast } = useToast();

  // Padrão oficial do React pra "ajustar estado quando uma prop muda"
  // (ajuste DURANTE a renderização, nunca dentro de um efeito) — dados
  // frescos do servidor (revalidados por qualquer Server Action de edição)
  // substituem o estado otimista local sem o "flash" de um efeito extra.
  if (initialItems !== syncedInitialItems) {
    setSyncedInitialItems(initialItems);
    setItems(initialItems);
  }

  useEffect(() => {
    const params = serializePendenciasFilters(filters, groupBy);
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [filters, groupBy]);

  const today = todayDateString();
  const filtered = useMemo(
    () => filterPendencias(items, filters, { today, currentTeamMemberId }),
    [items, filters, today, currentTeamMemberId],
  );
  const groups = useMemo(() => groupPendencias(filtered, groupBy, today), [filtered, groupBy, today]);
  const drawerItem = drawerTaskId ? (items.find((item) => item.id === drawerTaskId) ?? null) : null;

  // Seção 5 do pedido: "visíveis" = o recorte atual (`filtered`, já com
  // todos os filtros aplicados) — nunca a lista completa. Sem paginação
  // hoje, então "visível" e "filtrado" são o mesmo conjunto; se uma
  // paginação existir no futuro, é só este array que precisa mudar.
  const visibleIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelect(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function patchItem(taskId: string, patch: Partial<PendenciaItem>) {
    setItems((prev) => prev.map((item) => (item.id === taskId ? { ...item, ...patch } : item)));
  }

  function findItem(taskId: string): PendenciaItem | undefined {
    return items.find((item) => item.id === taskId);
  }

  async function handleUpdateStatus(taskId: string, status: string) {
    const previous = findItem(taskId);
    if (!previous) return;
    patchItem(taskId, { status: status as TaskStatus, rawStatus: status as TaskStatus });
    const result = await updateTaskStatusInlineAction(taskId, previous.client?.id ?? null, status as EditableNonTerminalStatus | "feito");
    if (result?.error) {
      patchItem(taskId, { status: previous.status, rawStatus: previous.rawStatus });
      showToast(result.error, "error");
    }
  }

  async function handleUpdatePriority(taskId: string, priority: string) {
    const previous = findItem(taskId);
    if (!previous) return;
    patchItem(taskId, { priority: priority as TaskPriority });
    const result = await updateTaskPriorityInlineAction(taskId, previous.client?.id ?? null, priority as TaskPriority);
    if (result?.error) {
      patchItem(taskId, { priority: previous.priority });
      showToast(result.error, "error");
    }
  }

  async function handleUpdateAssignee(taskId: string, assigneeId: string | null) {
    const previous = findItem(taskId);
    if (!previous) return;
    const nextAssignee = assigneeId ? (assigneeOptions.find((m) => m.id === assigneeId) ?? null) : null;
    patchItem(taskId, { assignee: nextAssignee });
    const result = await updateTaskAssigneeInlineAction(taskId, previous.client?.id ?? null, assigneeId);
    if (result?.error) {
      patchItem(taskId, { assignee: previous.assignee });
      showToast(result.error, "error");
    }
  }

  async function handleUpdateDueDate(taskId: string, dueDate: string) {
    const previous = findItem(taskId);
    if (!previous) return;
    patchItem(taskId, { dueDate });
    const result = await updateTaskDueDateInlineAction(taskId, previous.client?.id ?? null, dueDate);
    if (result?.error) {
      patchItem(taskId, { dueDate: previous.dueDate });
      showToast(result.error, "error");
    }
  }

  async function handleUpdateClient(taskId: string, clientId: string | null) {
    const previous = findItem(taskId);
    if (!previous) return;
    const nextClient = clientId ? (clientOptions.find((c) => c.id === clientId) ?? null) : null;
    patchItem(taskId, { client: nextClient });
    const result = await updateTaskClientInlineAction(taskId, previous.client?.id ?? null, clientId);
    if (result?.error) {
      patchItem(taskId, { client: previous.client });
      showToast(result.error, "error");
    }
  }

  async function handleReopen(taskId: string) {
    const previous = findItem(taskId);
    if (!previous) return;
    const result = await reopenTaskAction(taskId, previous.client?.id ?? null);
    if (result?.error) {
      showToast(result.error, "error");
      return;
    }
    patchItem(taskId, { status: "pendente", rawStatus: "pendente" });
    showToast(result?.message ?? "Pendência reaberta.");
  }

  async function handleDelete(taskId: string) {
    const previous = findItem(taskId);
    if (!previous) return;
    const result = await deleteTaskAction(taskId, previous.client?.id ?? null);
    if (result?.error) {
      showToast(result.error, "error");
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== taskId));
    if (drawerTaskId === taskId) setDrawerTaskId(null);
    showToast("Pendência excluída.");
  }

  async function handleBulkDuplicate() {
    setBulkPending(true);
    const result = await duplicateTasksAction(Array.from(selectedIds));
    setBulkPending(false);
    if (result?.error) {
      showToast(result.error, "error");
      return;
    }
    showToast(result?.message ?? "Demandas duplicadas.");
    setSelectedIds(new Set());
    // As cópias são itens NOVOS — chegam via revalidatePath (prop `items`
    // muda, sincronizado no ajuste de render acima), nunca inseridas
    // otimisticamente aqui (não temos os dados completos delas ainda,
    // ex.: nome do cliente/responsável resolvidos por join).
  }

  async function handleBulkDelete() {
    setBulkPending(true);
    const idsToDelete = Array.from(selectedIds);
    const result = await bulkDeleteTasksAction(idsToDelete);
    setBulkPending(false);
    setConfirmingBulkDelete(false);
    if (result?.error) {
      showToast(result.error, "error");
      return;
    }
    showToast(result?.message ?? "Demandas excluídas.");
    setItems((prev) => prev.filter((item) => !idsToDelete.includes(item.id)));
    if (drawerTaskId && idsToDelete.includes(drawerTaskId)) setDrawerTaskId(null);
    setSelectedIds(new Set());
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Pendências</h1>
        <p className="text-sm text-muted-foreground">Demandas criadas manualmente — por cliente ou internas — nunca rotina automática da Operação.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {QUICK_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, quickFilter: option.value }))}
            className={`mitza-pressable rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filters.quickFilter === option.value
                ? "border-brand bg-brand/10 text-brand"
                : "border-overview-border text-overview-text-primary hover:bg-overview-surface-hover"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="w-44">
          <SearchableSelect
            options={[{ id: INTERNAL_OPTION_ID, label: "Interna" }, ...clientOptions.map((c) => ({ id: c.id, label: c.name }))]}
            selectedId={filters.internalOnly ? INTERNAL_OPTION_ID : filters.clientId}
            onSelect={(id) =>
              setFilters((prev) => ({ ...prev, internalOnly: id === INTERNAL_OPTION_ID, clientId: id === INTERNAL_OPTION_ID ? null : id }))
            }
            placeholder="Todos os clientes"
            allLabel="Todos os clientes"
            searchPlaceholder="Buscar cliente..."
            ariaLabel="Filtrar por cliente"
          />
        </div>

        <div className="w-44">
          <SearchableSelect
            options={assigneeOptions.map((m) => ({ id: m.id, label: m.name, sublabel: m.status === "inativo" ? "(inativo)" : undefined }))}
            selectedId={filters.assigneeId}
            onSelect={(id) => setFilters((prev) => ({ ...prev, assigneeId: id }))}
            placeholder="Todos os responsáveis"
            allLabel="Todos os responsáveis"
            searchPlaceholder="Buscar responsável..."
            ariaLabel="Filtrar por responsável"
          />
        </div>

        <SearchableMultiSelect
          options={EDITABLE_STATUSES.concat("atrasado").map((status) => ({ id: status, label: TASK_STATUS_LABEL[status] }))}
          selectedIds={filters.statuses}
          onToggle={(id) =>
            setFilters((prev) => ({
              ...prev,
              statuses: prev.statuses.includes(id as TaskStatus) ? prev.statuses.filter((s) => s !== id) : [...prev.statuses, id as TaskStatus],
            }))
          }
          onClear={() => setFilters((prev) => ({ ...prev, statuses: [] }))}
          triggerLabel="Status"
          searchPlaceholder="Buscar status..."
        />

        <SearchableMultiSelect
          options={TASK_PRIORITY_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
          selectedIds={filters.priorities}
          onToggle={(id) =>
            setFilters((prev) => ({
              ...prev,
              priorities: prev.priorities.includes(id as TaskPriority) ? prev.priorities.filter((p) => p !== id) : [...prev.priorities, id as TaskPriority],
            }))
          }
          onClear={() => setFilters((prev) => ({ ...prev, priorities: [] }))}
          triggerLabel="Prioridade"
          searchPlaceholder="Buscar prioridade..."
        />

        <label className="flex items-center gap-1.5 text-xs text-overview-text-secondary">
          <input
            type="checkbox"
            checked={filters.includeCompleted}
            onChange={(event) => setFilters((prev) => ({ ...prev, includeCompleted: event.target.checked }))}
            className="accent-brand"
          />
          Mostrar concluídas
        </label>

        <span className="ml-auto flex items-center gap-1.5">
          <label className="text-xs text-overview-text-secondary" htmlFor="pendencias-group-by">
            Agrupar por
          </label>
          <select
            id="pendencias-group-by"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as PendenciaGroupBy)}
            className={fieldClasses}
          >
            {GROUP_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="mt-4">
        <QuickCreateForm clientOptions={clientOptions} assigneeOptions={assigneeOptions} onCreated={() => {}} />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {groups.length === 0 && <EmptyState size="sm">Nenhuma demanda encontrada com esses filtros.</EmptyState>}

        {groups.length > 0 && (
          <label className="flex w-fit items-center gap-1.5 text-xs text-overview-text-secondary">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label="Selecionar todas as demandas visíveis"
              className="h-3.5 w-3.5 cursor-pointer accent-brand"
            />
            Selecionar todas ({visibleIds.length})
          </label>
        )}

        {groups.map((group) => (
          <div key={group.key} className="rounded-lg border border-overview-border">
            <div className="flex items-center gap-2 border-b border-overview-border bg-overview-surface-subtle px-2 py-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-overview-text-secondary">{group.label}</p>
              <span className="text-[11px] text-overview-text-muted">{group.items.length}</span>
            </div>
            <ul>
              {group.items.map((item) => (
                <PendenciaRow
                  key={item.id}
                  item={item}
                  clientOptions={clientOptions}
                  assigneeOptions={assigneeOptions}
                  isAdmin={isAdmin}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onOpenDrawer={setDrawerTaskId}
                  onUpdateStatus={handleUpdateStatus}
                  onUpdatePriority={handleUpdatePriority}
                  onUpdateAssignee={handleUpdateAssignee}
                  onUpdateDueDate={handleUpdateDueDate}
                  onUpdateClient={handleUpdateClient}
                  onReopen={handleReopen}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-overview-border bg-overview-surface px-4 py-2 shadow-[var(--shadow-float)]">
            <span className="text-xs font-medium text-overview-text-primary">
              {selectedIds.size} selecionada{selectedIds.size === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              disabled={bulkPending}
              onClick={handleBulkDuplicate}
              className="mitza-pressable rounded-md border border-overview-border px-2.5 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Duplicar
            </button>
            {isAdmin &&
              (confirmingBulkDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-overview-text-secondary">Excluir {selectedIds.size} demanda{selectedIds.size === 1 ? "" : "s"}? Isso é permanente.</span>
                  <button
                    type="button"
                    disabled={bulkPending}
                    onClick={handleBulkDelete}
                    className="font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
                  >
                    {bulkPending ? "Excluindo..." : "Sim"}
                  </button>
                  <button type="button" onClick={() => setConfirmingBulkDelete(false)} className="text-overview-text-secondary hover:underline">
                    Não
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={bulkPending}
                  onClick={() => setConfirmingBulkDelete(true)}
                  className="mitza-pressable rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                >
                  Excluir
                </button>
              ))}
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setConfirmingBulkDelete(false);
              }}
              className="text-xs text-overview-text-secondary hover:underline"
            >
              Limpar seleção
            </button>
          </div>
        </div>
      )}

      {drawerItem && (
        <PendenciaDrawer
          key={drawerItem.id}
          item={drawerItem}
          managers={assigneeOptions.filter((m) => m.status === "ativo")}
          onClose={() => setDrawerTaskId(null)}
        />
      )}
    </div>
  );
}
