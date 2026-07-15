import { TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { createTaskAction, updateTaskAction } from "@/app/clients/tasks-actions";
import type { TaskType } from "@/lib/supabase/database.types";

export interface InlineTaskManagerOption {
  id: string;
  name: string;
}

const fieldClasses =
  "rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-brand";

/**
 * Criar/editar tarefa sem sair da tela Sprints (Sprint UX 2.0 Fase 2,
 * requisito "Edição contextual") — mesmo padrão checkbox+peer já usado em
 * "Atualizar performance" (`sprint-card.tsx`): nunca client component, nunca
 * modal ou página separada. Reaproveita as mesmas Server Actions da página
 * do cliente (`createTaskAction`/`updateTaskAction`) — só a apresentação é
 * nova, nenhuma regra de negócio muda.
 *
 * Escopo deliberadamente menor que a página dedicada de edição: só os campos
 * que já chegam até o drawer de tarefa hoje (título, tipo, responsável,
 * prazo) — `due_time`/`recorrência` continuam exclusivos da página completa
 * (link "Mais opções"), porque o modelo de dados usado pelas telas Sprints/
 * Visão Geral (`OperationTaskItem`) não carrega esses dois campos; estendê-lo
 * ficaria fora do escopo desta etapa (nenhuma mudança de banco/RPC aqui).
 */
function TaskFormFields({
  defaultTitle,
  defaultType,
  defaultAssigneeId,
  defaultDueDate,
  managers,
}: {
  defaultTitle?: string;
  defaultType?: TaskType;
  defaultAssigneeId?: string | null;
  defaultDueDate?: string;
  managers: InlineTaskManagerOption[];
}) {
  return (
    <>
      <input
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
        <input
          type="date"
          name="due_date"
          required
          defaultValue={defaultDueDate}
          className={fieldClasses}
        />
      </div>
    </>
  );
}

export function InlineCreateTaskForm({
  clientId,
  sprintId,
  managers,
  returnTo,
  toggleId,
  defaultDueDate,
}: {
  clientId: string;
  sprintId: string;
  managers: InlineTaskManagerOption[];
  returnTo: string;
  toggleId: string;
  defaultDueDate?: string;
}) {
  return (
    <>
      <input type="checkbox" id={toggleId} className="peer hidden" />
      <label
        htmlFor={toggleId}
        className="cursor-pointer text-xs text-muted-foreground hover:underline peer-checked:hidden"
      >
        + Tarefa
      </label>

      <form
        action={createTaskAction.bind(null, clientId)}
        className="mt-1.5 hidden w-full flex-col gap-1.5 peer-checked:flex"
      >
        <input type="hidden" name="sprint_id" value={sprintId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <TaskFormFields managers={managers} defaultDueDate={defaultDueDate} />
        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Salvar
          </button>
          <label htmlFor={toggleId} className="cursor-pointer text-[11px] text-muted-foreground hover:underline">
            Cancelar
          </label>
        </div>
      </form>
    </>
  );
}

export function InlineEditTaskForm({
  taskId,
  clientId,
  managers,
  returnTo,
  toggleId,
  fullEditHref,
  defaultTitle,
  defaultType,
  defaultAssigneeId,
  defaultDueDate,
}: {
  taskId: string;
  clientId: string;
  managers: InlineTaskManagerOption[];
  returnTo: string;
  toggleId: string;
  /** Link "Mais opções" — só pra horário/recorrência, campos que este
   * formulário compacto não cobre (ver doc do componente). */
  fullEditHref: string;
  defaultTitle: string;
  defaultType: TaskType;
  defaultAssigneeId: string | null;
  defaultDueDate: string;
}) {
  return (
    <>
      <input type="checkbox" id={toggleId} className="peer hidden" />
      <label
        htmlFor={toggleId}
        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 peer-checked:hidden dark:hover:bg-zinc-900"
      >
        Editar tarefa
      </label>

      <form
        action={updateTaskAction.bind(null, taskId, clientId)}
        className="mt-2 hidden w-full flex-col gap-1.5 peer-checked:flex"
      >
        <input type="hidden" name="return_to" value={returnTo} />
        <TaskFormFields
          defaultTitle={defaultTitle}
          defaultType={defaultType}
          defaultAssigneeId={defaultAssigneeId}
          defaultDueDate={defaultDueDate}
          managers={managers}
        />
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            Salvar
          </button>
          <label htmlFor={toggleId} className="cursor-pointer text-muted-foreground hover:underline">
            Cancelar
          </label>
          <a href={fullEditHref} className="text-muted-foreground hover:underline">
            Mais opções (horário/recorrência)
          </a>
        </div>
      </form>
    </>
  );
}
