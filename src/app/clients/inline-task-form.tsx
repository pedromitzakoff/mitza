"use client";

import { useRef, useState, useTransition } from "react";
import { TASK_RECURRENCE_LABEL, TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { createTaskInlineAction, updateTaskInlineAction, type TaskUpdateFields } from "@/app/clients/tasks-actions";
import { SECONDARY_ACTION_BUTTON_CLASSES } from "@/components/ui/section-header";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import type { TaskListItem } from "@/app/clients/task-row";
import type { TaskRecurrence, TaskType } from "@/lib/supabase/database.types";

export interface InlineTaskManagerOption {
  id: string;
  name: string;
}

const fieldClasses =
  "rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-brand";

/**
 * Criar/editar tarefa sem sair do workspace atual (Etapa "MITZA
 * Workspace-First Tasks 1.0" — antes, "Sprint UX 2.0 Fase 2"). Reaproveita
 * as mesmas Server Actions de sempre (`createTaskAction`/`updateTaskAction`),
 * agora chamadas diretamente (não mais via `<form action>` nativo) com o
 * contrato `{error?; message?}` — nunca navega, nunca recarrega a página.
 *
 * `showDueTime`/`showRecurrence` (Etapa "MITZA Workspace-First Tasks 1.0",
 * achado da investigação): nem todo lugar que edita uma tarefa carrega o
 * horário/recorrência atuais (o modelo `OperationTaskItem`, usado por
 * /operation e /sprints, não busca essas duas colunas). Mostrar um campo
 * sem saber o valor real levaria a resetá-lo em silêncio ao salvar — por
 * isso o campo só aparece quando quem chama de fato conhece o valor atual
 * (ver `updateTaskAction`/`TaskUpdateFields`, que preserva o que não for
 * enviado). Criação nunca tem esse problema (não há valor prévio a perder),
 * por isso sempre mostra os dois.
 */
function TaskFormFields({
  defaultTitle,
  defaultType,
  defaultAssigneeId,
  defaultDueDate,
  defaultDueTime,
  defaultRecurrence,
  defaultNotes,
  showDueTime,
  showRecurrence,
  managers,
  titleInputRef,
}: {
  defaultTitle?: string;
  defaultType?: TaskType;
  defaultAssigneeId?: string | null;
  defaultDueDate?: string;
  defaultDueTime?: string | null;
  defaultRecurrence?: TaskRecurrence;
  defaultNotes?: string | null;
  showDueTime: boolean;
  showRecurrence: boolean;
  managers: InlineTaskManagerOption[];
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <input
        ref={titleInputRef}
        name="title"
        required
        defaultValue={defaultTitle}
        placeholder="Título da tarefa"
        autoFocus
        className={`${fieldClasses} w-full`}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <select name="type" defaultValue={defaultType ?? "outro"} className={fieldClasses}>
          {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="assignee_id" defaultValue={defaultAssigneeId ?? ""} className={fieldClasses}>
          <option value="">Sem responsável</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
        <input type="date" name="due_date" required defaultValue={defaultDueDate} className={fieldClasses} />
        {showDueTime && (
          <input
            type="time"
            name="due_time"
            defaultValue={defaultDueTime ?? ""}
            aria-label="Horário (opcional)"
            title="Horário (opcional)"
            className={fieldClasses}
          />
        )}
      </div>
      {showRecurrence && (
        <select name="recurrence" defaultValue={defaultRecurrence ?? "nenhuma"} className={fieldClasses}>
          {Object.entries(TASK_RECURRENCE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      <textarea
        name="notes"
        rows={2}
        defaultValue={defaultNotes ?? ""}
        placeholder="Observações (opcional)"
        className={`${fieldClasses} w-full`}
      />
    </>
  );
}

export function InlineCreateTaskForm({
  clientId,
  sprintId,
  managers,
  defaultDueDate,
  onCreated,
  triggerLabel,
}: {
  clientId: string;
  /** `null` cria uma tarefa solta (seção "Outras tarefas"), sem vínculo com
   * nenhuma sprint — mesmo campo opcional que `createTaskAction` já aceita. */
  sprintId: string | null;
  managers: InlineTaskManagerOption[];
  defaultDueDate?: string;
  /** Despacha a inserção otimista na lista compartilhada (`useOptimisticTasks`)
   * ANTES do servidor confirmar — ver `useOptimisticTasks` (Etapa
   * "Workspace-First Tasks 1.0"). */
  onCreated: (task: TaskListItem) => void;
  /** MITZA Unified Activities 1.0 — texto do botão fechado, default "+
   * Tarefa" (preserva todo chamador existente). A fila unificada
   * "Atividades" passa "+ Nova tarefa" pra ficar lado a lado com "+
   * Registrar revisão" no mesmo cabeçalho, sem repetir a palavra "Tarefa"
   * já usada no rótulo de tipo de cada linha. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const fields = {
      title: String(formData.get("title") ?? "").trim(),
      type: String(formData.get("type") ?? "outro") as TaskType,
      assigneeId: String(formData.get("assignee_id") ?? "") || null,
      dueDate: String(formData.get("due_date") ?? ""),
      dueTime: String(formData.get("due_time") ?? "").trim() || null,
      recurrence: String(formData.get("recurrence") ?? "nenhuma") as TaskRecurrence,
      notes: String(formData.get("notes") ?? "").trim() || null,
      sprintId,
    };
    setError(null);
    startTransition(async () => {
      // Optimistic UI (Parte 4, item 5): a tarefa aparece na lista antes da
      // confirmação do servidor — id temporário, substituído sozinho quando
      // `revalidatePath` trouxer a lista real (ver doc de `useOptimisticTasks`).
      const assigneeName = fields.assigneeId ? (managers.find((m) => m.id === fields.assigneeId)?.name ?? null) : null;
      onCreated({
        id: `temp-${crypto.randomUUID()}`,
        title: fields.title,
        type: fields.type,
        due_date: fields.dueDate,
        status: "pendente",
        assignee: assigneeName ? { name: assigneeName, status: "ativo" } : null,
      });

      try {
        const result = await createTaskInlineAction(clientId, fields);
        if (result?.error) {
          showToast(result.error, "error");
          setError(result.error);
          return;
        }
        showToast(result?.message ?? "Tarefa criada.");
        form.reset();
        setOpen(false);
      } catch (err) {
        if (isRedirectSignal(err)) throw err;
        showToast("Não foi possível criar a tarefa. Tente novamente.", "error");
      }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={SECONDARY_ACTION_BUTTON_CLASSES}>
        {triggerLabel ?? "+ Tarefa"}
      </button>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-1.5 flex w-full flex-col gap-1.5">
      <TaskFormFields
        managers={managers}
        defaultDueDate={defaultDueDate}
        showDueTime
        showRecurrence
        titleInputRef={titleInputRef}
      />
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={isPending}
          className="mitza-pressable rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-[11px] text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function InlineEditTaskForm({
  taskId,
  clientId,
  managers,
  defaultTitle,
  defaultType,
  defaultAssigneeId,
  defaultDueDate,
  defaultDueTime,
  defaultNotes,
}: {
  taskId: string;
  clientId: string;
  managers: InlineTaskManagerOption[];
  defaultTitle: string;
  defaultType: TaskType;
  defaultAssigneeId: string | null;
  defaultDueDate: string;
  /** `undefined` quando quem chama não busca `due_time` (ex.: drawer aberto
   * a partir de /operation ou /sprints) — o campo some do formulário e o
   * valor real é preservado no servidor, nunca resetado (ver doc acima). */
  defaultDueTime?: string | null;
  defaultNotes?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const tracksDueTime = defaultDueTime !== undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const fields: TaskUpdateFields = {
      title: String(formData.get("title") ?? "").trim(),
      type: String(formData.get("type") ?? "outro") as TaskType,
      assigneeId: String(formData.get("assignee_id") ?? "") || null,
      dueDate: String(formData.get("due_date") ?? ""),
      notes: String(formData.get("notes") ?? "").trim() || null,
      // Recorrência nunca é editada por este formulário (nenhum lugar hoje
      // carrega o valor atual pra mostrar com segurança) — omitido de
      // propósito, `updateTaskAction` preserva o valor existente.
      dueTime: tracksDueTime ? String(formData.get("due_time") ?? "").trim() || null : undefined,
    };
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateTaskInlineAction(taskId, clientId, fields);
        if (result?.error) {
          showToast(result.error, "error");
          setError(result.error);
          return;
        }
        showToast(result?.message ?? "Tarefa atualizada.");
        setOpen(false);
      } catch (err) {
        if (isRedirectSignal(err)) throw err;
        showToast("Não foi possível salvar a tarefa. Tente novamente.", "error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mitza-pressable rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        Editar tarefa
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex w-full flex-col gap-1.5">
      <TaskFormFields
        defaultTitle={defaultTitle}
        defaultType={defaultType}
        defaultAssigneeId={defaultAssigneeId}
        defaultDueDate={defaultDueDate}
        defaultDueTime={defaultDueTime}
        defaultNotes={defaultNotes}
        showDueTime={tracksDueTime}
        showRecurrence={false}
        managers={managers}
        titleInputRef={titleInputRef}
      />
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="submit"
          disabled={isPending}
          className="mitza-pressable rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Salvando..." : "Salvar"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
