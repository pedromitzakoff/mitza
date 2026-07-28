"use client";

import { useState } from "react";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_BADGE_CLASSES, isWorkspaceClient } from "@/lib/client-fields";
import {
  createRecurringTaskAction,
  deleteRecurringTaskAction,
  toggleRecurringTaskActiveAction,
  updateRecurringTaskAction,
  updateRecurringTaskGoalAction,
} from "./recurring-tasks-actions";
import { SubmitButton } from "@/app/submit-button";

export interface RecurringTaskItem {
  id: string;
  title: string;
  icon: string;
  color: string;
  isActive: boolean;
  appliesToAll: boolean;
  defaultAssigneeId: string | null;
  hasChecklist: boolean;
  usesAccountReview: boolean;
  selectedClientIds: string[];
  checklistLabels: string[];
  currentWeeklyGoal: number | null;
  hasExecutions: boolean;
}

const fieldClasses =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function ClientScopePicker({
  task,
  clients,
}: {
  task?: RecurringTaskItem;
  clients: { id: string; name: string; status: ClientContractStatus }[];
}) {
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" name="applies_to_all" defaultChecked={task?.appliesToAll ?? true} className="accent-black dark:accent-white" />
        Todos os clientes (atuais e futuros)
      </label>

      {clients.length > 0 && (
        <details className="rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
          <summary className="cursor-pointer select-none">
            Ou escolher clientes específicos
            {!task?.appliesToAll && task && task.selectedClientIds.length > 0
              ? ` (${task.selectedClientIds.length} selecionado${task.selectedClientIds.length !== 1 ? "s" : ""})`
              : ""}
          </summary>
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
            {clients.map((client) => (
              <label key={client.id} className={`flex items-center gap-1.5 ${isWorkspaceClient(client) ? "" : "text-zinc-400 dark:text-zinc-600"}`}>
                <input type="checkbox" name="client_ids" value={client.id} defaultChecked={task?.selectedClientIds.includes(client.id) ?? false} />
                {client.name}
                {!isWorkspaceClient(client) && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}>
                    {CLIENT_STATUS_LABEL[client.status]}
                  </span>
                )}
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Lista de checklist editável — repetível, sem limite fixo de itens. Cada
 * rótulo digitado vira um `item_key` estável no servidor (slug do rótulo).
 * Escondida por completo quando `usesAccountReview` é true (ver doc em
 * `recurring-tasks-actions.ts`): esse checklist é gerenciado pela
 * integração com Otimização, não editável por aqui. */
function ChecklistEditor({ initialLabels }: { initialLabels: string[] }) {
  const [labels, setLabels] = useState<string[]>(initialLabels.length > 0 ? initialLabels : [""]);

  return (
    <div className="flex flex-col gap-1">
      {labels.map((label, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            name="checklist_labels"
            defaultValue={label}
            placeholder={`Item ${index + 1}`}
            className={`${fieldClasses} flex-1`}
          />
          {labels.length > 1 && (
            <button
              type="button"
              onClick={() => setLabels((current) => current.filter((_, i) => i !== index))}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Remover item"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setLabels((current) => [...current, ""])}
        className="self-start text-xs text-brand hover:underline"
      >
        + Item do checklist
      </button>
    </div>
  );
}

function RecurringTaskFields({
  task,
  managers,
  clients,
}: {
  task?: RecurringTaskItem;
  managers: { id: string; name: string }[];
  clients: { id: string; name: string; status: ClientContractStatus }[];
}) {
  const [hasChecklist, setHasChecklist] = useState(task?.hasChecklist ?? false);
  const isAccountReviewLinked = task?.usesAccountReview ?? false;

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input name="icon" defaultValue={task?.icon ?? "🔁"} className={`${fieldClasses} w-12 text-center`} aria-label="Ícone" />
        <input name="title" required defaultValue={task?.title} placeholder="Nome da recorrência" className={`${fieldClasses} flex-1`} />
        <input
          type="color"
          name="color"
          defaultValue={task?.color ?? "#4169E1"}
          className="h-7 w-9 rounded border border-zinc-300 dark:border-zinc-700"
          aria-label="Cor"
        />
        <select name="default_assignee_id" defaultValue={task?.defaultAssigneeId ?? ""} className={fieldClasses}>
          <option value="">Sem responsável padrão</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
        {!task && (
          <input
            type="number"
            name="weekly_goal"
            min={1}
            placeholder="Meta semanal"
            className={`${fieldClasses} w-28`}
            title="Quantas execuções por semana — deixe em branco pra configurar depois"
          />
        )}
      </div>

      <ClientScopePicker task={task} clients={clients} />

      {isAccountReviewLinked ? (
        <p className="text-xs text-muted-foreground">
          Checklist gerenciado pela integração com Otimização — não editável aqui.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name="has_checklist"
              checked={hasChecklist}
              onChange={(event) => setHasChecklist(event.target.checked)}
              className="accent-black dark:accent-white"
            />
            Tem checklist ao registrar execução
          </label>
          {hasChecklist && <ChecklistEditor initialLabels={task?.checklistLabels ?? []} />}
        </div>
      )}
    </div>
  );
}

function GoalUpdateForm({ task }: { task: RecurringTaskItem }) {
  return (
    <form action={updateRecurringTaskGoalAction.bind(null, task.id)} className="flex items-center gap-1.5">
      <input
        type="number"
        name="weekly_goal"
        min={1}
        defaultValue={task.currentWeeklyGoal ?? undefined}
        placeholder="Meta"
        className={`${fieldClasses} w-16`}
        title="Vale a partir de agora — sprints já em andamento mantêm a meta antiga"
      />
      <SubmitButton
        pendingChildren="..."
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
      >
        Atualizar meta
      </SubmitButton>
    </form>
  );
}

export function RecurringTasksList({
  tasks,
  managers,
  clients,
}: {
  tasks: RecurringTaskItem[];
  managers: { id: string; name: string }[];
  clients: { id: string; name: string; status: ClientContractStatus }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 ${
            task.isActive ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200 opacity-50 dark:border-zinc-800"
          }`}
        >
          <form action={updateRecurringTaskAction.bind(null, task.id)} className="flex flex-1 flex-wrap items-start gap-2">
            <RecurringTaskFields task={task} managers={managers} clients={clients} />
            <SubmitButton
              pendingChildren="Salvando..."
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Salvar
            </SubmitButton>
          </form>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <GoalUpdateForm task={task} />

            <div className="flex gap-2">
              <form action={toggleRecurringTaskActiveAction.bind(null, task.id, !task.isActive)}>
                <SubmitButton
                  pendingChildren={task.isActive ? "Desativando..." : "Ativando..."}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
                >
                  {task.isActive ? "Desativar" : "Ativar"}
                </SubmitButton>
              </form>

              {!task.hasExecutions && (
                <form action={deleteRecurringTaskAction.bind(null, task.id)}>
                  <SubmitButton
                    pendingChildren="Excluindo..."
                    className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    Excluir
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </div>
      ))}

      <form action={createRecurringTaskAction} className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
        <RecurringTaskFields managers={managers} clients={clients} />
        <SubmitButton
          pendingChildren="Adicionando..."
          className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          + Adicionar
        </SubmitButton>
      </form>
    </div>
  );
}
