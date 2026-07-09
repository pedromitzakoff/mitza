import { TASK_TYPE_LABEL } from "./task-labels";
import { WEEKDAY_LABEL } from "./weekday-labels";
import {
  createTemplateAction,
  deleteTemplateAction,
  toggleTemplateActiveAction,
  updateTemplateAction,
} from "./task-templates-actions";

export interface TemplateItem {
  id: string;
  title: string;
  type: keyof typeof TASK_TYPE_LABEL;
  weekday: keyof typeof WEEKDAY_LABEL;
  is_active: boolean;
  default_assignee_id: string | null;
}

const fieldClasses =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

function TemplateFields({
  template,
  managers,
}: {
  template?: TemplateItem;
  managers: { id: string; name: string }[];
}) {
  return (
    <>
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
    </>
  );
}

export function TaskTemplatesList({
  templates,
  managers,
  clientId,
}: {
  templates: TemplateItem[];
  managers: { id: string; name: string }[];
  clientId: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {templates.map((template) => (
        <div
          key={template.id}
          className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
            template.is_active
              ? "border-zinc-200 dark:border-zinc-800"
              : "border-zinc-200 opacity-50 dark:border-zinc-800"
          }`}
        >
          <form
            action={updateTemplateAction.bind(null, template.id, clientId)}
            className="flex flex-1 flex-wrap items-center gap-2"
          >
            <TemplateFields template={template} managers={managers} />
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Salvar
            </button>
          </form>

          <form action={toggleTemplateActiveAction.bind(null, template.id, clientId, !template.is_active)}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              {template.is_active ? "Desativar" : "Ativar"}
            </button>
          </form>

          <form action={deleteTemplateAction.bind(null, template.id, clientId)}>
            <button
              type="submit"
              className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
            >
              Excluir
            </button>
          </form>
        </div>
      ))}

      <form
        action={createTemplateAction.bind(null, clientId)}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-2 dark:border-zinc-700"
      >
        <TemplateFields managers={managers} />
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
