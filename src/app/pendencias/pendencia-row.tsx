"use client";

import { useState } from "react";
import { AlignLeft } from "lucide-react";
import type { PendenciaItem } from "@/lib/pendencias";
import {
  TASK_EDITABLE_STATUS_OPTIONS,
  TASK_PRIORITY_BADGE_CLASSES,
  TASK_PRIORITY_DOT_CLASS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_BADGE_CLASSES,
} from "@/app/clients/task-labels";
import { formatDueDate } from "@/app/clients/task-row";
import { Tooltip } from "@/components/ui/tooltip";
import { todayDateString } from "@/lib/today";
import type { PendenciasAssigneeOption, PendenciasClientOption } from "./pendencias-data";

const selectClasses =
  "rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-overview-text-primary outline-none transition-colors hover:border-overview-border focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Linha densa da lista de Pendências — colunas fixas [Demanda | Cliente |
 * Responsável | Status | Prioridade | Prazo] (seção 2 do pedido), cada uma
 * das últimas quatro editável direto na linha (seção 6). Abrir o drawer é
 * clicar no título — nunca a linha inteira (diferente de `TaskRow`,
 * clicar em qualquer <select> aqui não pode acionar navegação).
 *
 * Cada campo tem seu próprio `pendingField` local: só ELE fica desabilitado
 * durante o salvamento (nunca a linha inteira), e o valor volta pro
 * anterior automaticamente se a Server Action falhar (nunca mostra como
 * salvo um valor que não foi).
 */
export function PendenciaRow({
  item,
  clientOptions,
  assigneeOptions,
  isAdmin,
  selected,
  onToggleSelect,
  onOpenDrawer,
  onUpdateStatus,
  onUpdatePriority,
  onUpdateAssignee,
  onUpdateDueDate,
  onUpdateClient,
  onReopen,
  onDelete,
}: {
  item: PendenciaItem;
  clientOptions: PendenciasClientOption[];
  assigneeOptions: PendenciasAssigneeOption[];
  isAdmin: boolean;
  selected: boolean;
  onToggleSelect: (taskId: string) => void;
  onOpenDrawer: (taskId: string) => void;
  onUpdateStatus: (taskId: string, status: string) => Promise<void>;
  onUpdatePriority: (taskId: string, priority: string) => Promise<void>;
  onUpdateAssignee: (taskId: string, assigneeId: string | null) => Promise<void>;
  onUpdateDueDate: (taskId: string, dueDate: string) => Promise<void>;
  onUpdateClient: (taskId: string, clientId: string | null) => Promise<void>;
  onReopen: (taskId: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}) {
  const [pendingField, setPendingField] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isTerminal = item.status === "feito" || item.status === "nao_realizado";
  const isOverdue = item.status === "atrasado";

  async function run(field: string, action: () => Promise<void>) {
    setPendingField(field);
    try {
      await action();
    } finally {
      setPendingField(null);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-overview-border/60 px-2 py-1.5 last:border-0 hover:bg-overview-surface-hover">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(item.id)}
        aria-label={`Selecionar "${item.title}"`}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand"
      />

      <button
        type="button"
        onClick={() => onOpenDrawer(item.id)}
        className="flex min-w-[180px] flex-1 items-center gap-1.5 truncate text-left text-sm font-medium text-overview-text-primary hover:underline"
        title={item.title}
      >
        <span className="truncate">{item.title}</span>
        {item.notes && (
          <Tooltip label="Tem descrição">
            <AlignLeft className="h-3 w-3 shrink-0 text-overview-text-muted" aria-hidden="true" />
          </Tooltip>
        )}
      </button>

      <select
        value={item.client?.id ?? ""}
        disabled={pendingField === "client"}
        onChange={(event) => run("client", () => onUpdateClient(item.id, event.target.value || null))}
        aria-label="Cliente"
        className={`${selectClasses} w-[140px] shrink-0`}
      >
        <option value="">Interna</option>
        {clientOptions.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>

      <select
        value={item.assignee?.id ?? ""}
        disabled={pendingField === "assignee"}
        onChange={(event) => run("assignee", () => onUpdateAssignee(item.id, event.target.value || null))}
        aria-label="Responsável"
        className={`${selectClasses} w-[130px] shrink-0`}
      >
        <option value="">Sem responsável</option>
        {assigneeOptions.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
            {member.status === "inativo" ? " (inativo)" : ""}
          </option>
        ))}
      </select>

      {isTerminal ? (
        <span className={`w-[110px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${TASK_STATUS_BADGE_CLASSES[item.status]}`}>
          {item.status === "feito" ? "Concluído" : "Não realizado"}
        </span>
      ) : (
        <select
          value={item.rawStatus}
          disabled={pendingField === "status"}
          onChange={(event) => run("status", () => onUpdateStatus(item.id, event.target.value))}
          aria-label="Status"
          className={`${selectClasses} w-[110px] shrink-0 ${isOverdue ? "text-red-600 dark:text-red-400" : ""} ${TASK_STATUS_BADGE_CLASSES[item.status]}`}
        >
          {TASK_EDITABLE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      <span className={`flex w-[90px] shrink-0 items-center gap-1 rounded-md px-1 ${TASK_PRIORITY_BADGE_CLASSES[item.priority]}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_PRIORITY_DOT_CLASS[item.priority]}`} aria-hidden="true" />
        <select
          value={item.priority}
          disabled={pendingField === "priority"}
          onChange={(event) => run("priority", () => onUpdatePriority(item.id, event.target.value))}
          aria-label="Prioridade"
          className={`${selectClasses} w-full border-transparent bg-transparent px-0.5`}
        >
          {TASK_PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>

      <input
        type="date"
        value={item.dueDate}
        disabled={pendingField === "dueDate"}
        onChange={(event) => event.target.value && run("dueDate", () => onUpdateDueDate(item.id, event.target.value))}
        aria-label="Prazo"
        title={formatDueDate(item.dueDate)}
        className={`${selectClasses} w-[124px] shrink-0 ${isOverdue ? "text-red-600 dark:text-red-400" : item.dueDate === todayDateString() ? "text-brand" : ""}`}
      />

      <span className="flex shrink-0 items-center gap-1.5">
        {isTerminal && (
          <button
            type="button"
            disabled={pendingField === "reopen"}
            onClick={() => run("reopen", () => onReopen(item.id))}
            className="mitza-pressable rounded px-1.5 py-0.5 text-[11px] font-medium text-overview-text-secondary hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reabrir
          </button>
        )}
        {isAdmin &&
          (confirmingDelete ? (
            <span className="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                disabled={pendingField === "delete"}
                onClick={() => run("delete", () => onDelete(item.id))}
                className="font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
              >
                Excluir?
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-overview-text-secondary hover:underline">
                Não
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label="Excluir pendência"
              className="mitza-pressable rounded px-1 text-sm text-overview-text-secondary hover:text-red-600 dark:hover:text-red-400"
            >
              •••
            </button>
          ))}
      </span>
    </li>
  );
}
