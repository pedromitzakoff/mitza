import { TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { WEEKDAY_LABEL } from "@/app/clients/weekday-labels";
import {
  createGlobalTemplateAction,
  deleteGlobalTemplateAction,
  toggleGlobalTemplateActiveAction,
  updateGlobalTemplateAction,
} from "./sprint-task-templates-actions";

export interface GlobalTemplateItem {
  id: string;
  title: string;
  type: keyof typeof TASK_TYPE_LABEL;
  weekday: keyof typeof WEEKDAY_LABEL;
  is_active: boolean;
  applies_to_all: boolean;
  default_assignee_id: string | null;
  selectedClientIds: string[];
  hasGeneratedTasks: boolean;
}

const fieldClasses =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function TemplateFields({
  template,
  managers,
  clients,
}: {
  template?: GlobalTemplateItem;
  managers: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="title"
          required
          defaultValue={template?.title}
          placeholder="Título"
          className={`${fieldClasses} flex-1`}
        />
        <select name="type" defaultValue={template?.type ?? "otimizacao"} className={fieldClasses}>
          {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="weekday" defaultValue={template?.weekday ?? 1} className={fieldClasses}>
          {Object.entries(WEEKDAY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="default_assignee_id"
          defaultValue={template?.default_assignee_id ?? ""}
          className={fieldClasses}
        >
          <option value="">Sem responsável padrão</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      </div>

      <ClientScopePicker template={template} clients={clients} />
    </div>
  );
}

function ClientScopePicker({
  template,
  clients,
}: {
  template?: GlobalTemplateItem;
  clients: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          name="applies_to_all"
          defaultChecked={template?.applies_to_all ?? true}
          className="accent-black dark:accent-white"
        />
        Todos os clientes (atuais e futuros)
      </label>

      {clients.length > 0 && (
        <details className="rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
          <summary className="cursor-pointer select-none">
            Ou escolher clientes específicos
            {!template?.applies_to_all && template && template.selectedClientIds.length > 0
              ? ` (${template.selectedClientIds.length} selecionado${template.selectedClientIds.length !== 1 ? "s" : ""})`
              : ""}
          </summary>
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
            {clients.map((client) => (
              <label key={client.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="client_ids"
                  value={client.id}
                  defaultChecked={template?.selectedClientIds.includes(client.id) ?? false}
                />
                {client.name}
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function SprintTaskTemplatesList({
  templates,
  managers,
  clients,
}: {
  templates: GlobalTemplateItem[];
  managers: { id: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {templates.map((template) => (
        <div
          key={template.id}
          className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 ${
            template.is_active
              ? "border-zinc-200 dark:border-zinc-800"
              : "border-zinc-200 opacity-50 dark:border-zinc-800"
          }`}
        >
          <form
            action={updateGlobalTemplateAction.bind(null, template.id)}
            className="flex flex-1 flex-wrap items-start gap-2"
          >
            <TemplateFields template={template} managers={managers} clients={clients} />
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Salvar
            </button>
          </form>

          <div className="flex shrink-0 flex-col gap-2">
            <form
              action={toggleGlobalTemplateActiveAction.bind(
                null,
                template.id,
                !template.is_active,
              )}
            >
              <button
                type="submit"
                className="w-full rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                {template.is_active ? "Desativar" : "Ativar"}
              </button>
            </form>

            {!template.hasGeneratedTasks && (
              <form action={deleteGlobalTemplateAction.bind(null, template.id)}>
                <button
                  type="submit"
                  className="w-full rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                >
                  Excluir
                </button>
              </form>
            )}
          </div>
        </div>
      ))}

      <form
        action={createGlobalTemplateAction}
        className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
      >
        <TemplateFields managers={managers} clients={clients} />
        <button
          type="submit"
          className="rounded-md bg-black px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          + Adicionar
        </button>
      </form>
    </div>
  );
}
