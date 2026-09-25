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
  createTaskInlineAction,
  deleteTaskAction,
  reopenTaskAction,
  updateTaskAssigneeInlineAction,
  updateTaskClientInlineAction,
  updateTaskDueDateInlineAction,
  updateTaskPriorityInlineAction,
  updateTaskStatusInlineAction,
  type EditableNonTerminalStatus,
} from "@/app/clients/tasks-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/app/toast-provider";
import { PendenciaRow } from "./pendencia-row";
import { PendenciaDrawer } from "./pendencia-drawer";
import type { PendenciasAssigneeOption, PendenciasClientOption } from "./pendencias-data";

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
  const { showToast } = useToast();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    const clientId = String(formData.get("client_id") ?? "") || null;
    const assigneeId = String(formData.get("assignee_id") ?? "") || null;
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
      <select name="client_id" defaultValue="" className={fieldClasses} aria-label="Cliente">
        <option value="">Interna</option>
        {clientOptions.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      <select name="assignee_id" defaultValue="" className={fieldClasses} aria-label="Responsável">
        <option value="">Sem responsável</option>
        {assigneeOptions.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
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

function MultiSelectDisclosure({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="relative">
      <summary className="mitza-pressable cursor-pointer list-none rounded-md border border-overview-border px-2 py-1 text-xs text-overview-text-primary hover:bg-overview-surface-hover">
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ""}
      </summary>
      <div className="absolute z-20 mt-1 w-44 rounded-md border border-overview-border bg-overview-surface p-1.5 shadow-[var(--shadow-float)]">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-overview-surface-hover">
            <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} className="accent-brand" />
            {option.label}
          </label>
        ))}
      </div>
    </details>
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
        <select
          value={filters.internalOnly ? "interna" : (filters.clientId ?? "")}
          onChange={(event) => {
            const value = event.target.value;
            setFilters((prev) => ({ ...prev, internalOnly: value === "interna", clientId: value === "interna" ? null : value || null }));
          }}
          aria-label="Filtrar por cliente"
          className={fieldClasses}
        >
          <option value="">Todos os clientes</option>
          <option value="interna">Interna</option>
          {clientOptions.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>

        <select
          value={filters.assigneeId ?? ""}
          onChange={(event) => setFilters((prev) => ({ ...prev, assigneeId: event.target.value || null }))}
          aria-label="Filtrar por responsável"
          className={fieldClasses}
        >
          <option value="">Todos os responsáveis</option>
          {assigneeOptions.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>

        <MultiSelectDisclosure
          label="Status"
          options={EDITABLE_STATUSES.concat("atrasado").map((status) => ({ value: status, label: TASK_STATUS_LABEL[status] }))}
          selected={filters.statuses}
          onToggle={(value) =>
            setFilters((prev) => ({
              ...prev,
              statuses: prev.statuses.includes(value as TaskStatus)
                ? prev.statuses.filter((s) => s !== value)
                : [...prev.statuses, value as TaskStatus],
            }))
          }
        />

        <MultiSelectDisclosure
          label="Prioridade"
          options={TASK_PRIORITY_OPTIONS}
          selected={filters.priorities}
          onToggle={(value) =>
            setFilters((prev) => ({
              ...prev,
              priorities: prev.priorities.includes(value as TaskPriority)
                ? prev.priorities.filter((p) => p !== value)
                : [...prev.priorities, value as TaskPriority],
            }))
          }
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
