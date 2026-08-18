"use client";

import { useState } from "react";
import { TASK_TYPE_LABEL } from "@/app/clients/task-labels";
import { WEEKDAY_LABEL } from "@/app/clients/weekday-labels";
import type { TaskType, ClientContractStatus } from "@/lib/supabase/database.types";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_BADGE_CLASSES, isWorkspaceClient } from "@/lib/client-fields";
import {
  createGlobalTemplateAction,
  deleteGlobalTemplateAction,
  toggleGlobalTemplateActiveAction,
  updateGlobalTemplateAction,
} from "./sprint-task-templates-actions";
import { SubmitButton } from "@/app/submit-button";
import { SETTINGS_SECONDARY_BUTTON_CLASSES, SETTINGS_DESTRUCTIVE_BUTTON_CLASSES } from "./settings-shell";

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
  "rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-zinc-500";

/**
 * Como são tarefas padronizadas, o tipo já define o nome exibido
 * (TASK_TYPE_DEFAULT_TITLE, em task-labels.ts) — o campo de título só
 * aparece pra "Outro", que não tem um nome óbvio derivável do tipo. Título
 * final é montado no server (sprint-task-templates-actions.ts).
 */
function TemplateFields({
  template,
  managers,
  clients,
}: {
  template?: GlobalTemplateItem;
  managers: { id: string; name: string }[];
  clients: { id: string; name: string; status: ClientContractStatus }[];
}) {
  const [type, setType] = useState<TaskType>(template?.type ?? "verificacao_saldo");

  // Etapa 57: "Otimização" não é mais oferecida pra criar template NOVO — o
  // conceito virou Análise da Conta (account_reviews), com cadência própria.
  // Um template já existente desse tipo (histórico, hoje desativado) ainda
  // aparece corretamente se algum dia for aberto pra edição.
  const typeOptions = Object.entries(TASK_TYPE_LABEL).filter(
    ([value]) => value !== "otimizacao" || template?.type === "otimizacao",
  );

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as TaskType)}
          className={fieldClasses}
        >
          {typeOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {type === "outro" && (
          <input
            name="title"
            required
            defaultValue={template?.title}
            placeholder="Título"
            className={`${fieldClasses} flex-1`}
          />
        )}
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
  clients: { id: string; name: string; status: ClientContractStatus }[];
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
        <details className="rounded-md border border-dashed border-border p-2">
          <summary className="cursor-pointer select-none">
            Ou escolher clientes específicos
            {!template?.applies_to_all && template && template.selectedClientIds.length > 0
              ? ` (${template.selectedClientIds.length} selecionado${template.selectedClientIds.length !== 1 ? "s" : ""})`
              : ""}
          </summary>
          <div className="mt-2 grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto">
            {clients.map((client) => (
              <label
                key={client.id}
                className={`flex items-center gap-1.5 ${isWorkspaceClient(client) ? "" : "text-muted-foreground"}`}
              >
                <input
                  type="checkbox"
                  name="client_ids"
                  value={client.id}
                  defaultChecked={template?.selectedClientIds.includes(client.id) ?? false}
                />
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

export function SprintTaskTemplatesList({
  templates,
  managers,
  clients,
}: {
  templates: GlobalTemplateItem[];
  managers: { id: string; name: string }[];
  clients: { id: string; name: string; status: ClientContractStatus }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {templates.map((template) => (
        <div
          key={template.id}
          className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 ${
            template.is_active ? "border-border" : "border-border opacity-50"
          }`}
        >
          <form
            action={updateGlobalTemplateAction.bind(null, template.id)}
            className="flex flex-1 flex-wrap items-start gap-2"
          >
            <TemplateFields template={template} managers={managers} clients={clients} />
            <SubmitButton
              pendingChildren="Salvando..."
              className={`px-2 py-1 text-xs ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}
            >
              Salvar
            </SubmitButton>
          </form>

          <div className="flex shrink-0 flex-col gap-2">
            <form
              action={toggleGlobalTemplateActiveAction.bind(
                null,
                template.id,
                !template.is_active,
              )}
            >
              <SubmitButton
                pendingChildren={template.is_active ? "Desativando..." : "Ativando..."}
                className={`w-full px-2 py-1 text-xs ${SETTINGS_SECONDARY_BUTTON_CLASSES}`}
              >
                {template.is_active ? "Desativar" : "Ativar"}
              </SubmitButton>
            </form>

            {!template.hasGeneratedTasks && (
              <form action={deleteGlobalTemplateAction.bind(null, template.id)}>
                <SubmitButton
                  pendingChildren="Excluindo..."
                  className={`w-full px-2 py-1 text-xs ${SETTINGS_DESTRUCTIVE_BUTTON_CLASSES}`}
                >
                  Excluir
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      ))}

      <form
        action={createGlobalTemplateAction}
        className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-border p-3"
      >
        <TemplateFields managers={managers} clients={clients} />
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
