"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/app/submit-button";
import { ClientCombobox, type ClientComboboxOption } from "@/app/client-combobox";
import { createReminderAction, updateReminderAction, type ReminderFormState } from "./reminders-actions";
import type { ReminderScope } from "@/lib/reminders";

// Vive aqui, não no arquivo "use server" — mesmo motivo do bug corrigido em
// register-execution-form.tsx: um arquivo "use server" só pode exportar
// funções async.
const INITIAL_STATE: ReminderFormState = { status: "idle" };

export interface ReminderTeamMemberOption {
  id: string;
  name: string;
}

/**
 * Drawer "Adicionar/Editar pendência" — mesmo padrão de overlay já usado em
 * toda a plataforma (`record-account-review-drawer.tsx`), preferido aqui
 * a um modal centralizado pra manter a experiência coerente com o resto do
 * produto. `useActionState`: erro nunca fecha o drawer nem perde o que foi
 * digitado (mesma correção já aplicada em `register-execution-form.tsx`).
 */
export function ReminderFormDrawer({
  closeHref,
  clients,
  teamMembers,
  reminderId,
  initialTitle,
  initialScope,
  initialClientId,
  initialAssigneeId,
  initialDueDate,
  initialNotes,
}: {
  closeHref: string;
  clients: ClientComboboxOption[];
  teamMembers: ReminderTeamMemberOption[];
  reminderId?: string | null;
  initialTitle?: string;
  initialScope?: ReminderScope;
  initialClientId?: string | null;
  initialAssigneeId?: string | null;
  initialDueDate?: string | null;
  initialNotes?: string | null;
}) {
  const isEdit = Boolean(reminderId);
  const boundAction = isEdit ? updateReminderAction.bind(null, reminderId!, closeHref) : createReminderAction.bind(null, closeHref);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);

  const [scope, setScope] = useState<ReminderScope>(initialScope ?? "agency");
  const [selectedClientId, setSelectedClientId] = useState(initialClientId ?? "");

  const fieldClasses =
    "rounded-md border border-overview-border bg-transparent px-3 py-2 text-sm text-overview-text-primary outline-none focus:border-overview-border-strong";

  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-overview-text-primary">{isEdit ? "Editar pendência" : "Adicionar pendência"}</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
          >
            Fechar
          </Link>
        </div>

        <form action={formAction} className="mt-4 flex flex-1 flex-col gap-3.5">
          <label className="flex flex-col gap-1 text-sm text-overview-text-primary">
            Pendência
            <input
              name="title"
              type="text"
              required
              defaultValue={initialTitle}
              placeholder="Ex.: Cobrar aprovação dos novos criativos"
              className={fieldClasses}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-overview-text-primary">Relacionado a</span>
            <input type="hidden" name="scope" value={scope} />
            <div className="inline-flex w-fit items-center gap-0.5 rounded-full border border-overview-border p-0.5">
              <button
                type="button"
                onClick={() => setScope("agency")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  scope === "agency" ? "bg-overview-brand-subtle text-brand" : "text-overview-text-secondary hover:text-overview-text-primary"
                }`}
              >
                Agência
              </button>
              <button
                type="button"
                onClick={() => setScope("client")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  scope === "client" ? "bg-overview-brand-subtle text-brand" : "text-overview-text-secondary hover:text-overview-text-primary"
                }`}
              >
                Cliente
              </button>
            </div>
            {scope === "client" && (
              <>
                <input type="hidden" name="client_id" value={selectedClientId} />
                <ClientCombobox clients={clients} selectedClientId={selectedClientId || undefined} onSelect={setSelectedClientId} label="" />
              </>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm text-overview-text-primary">
            Responsável
            <select name="assignee_id" defaultValue={initialAssigneeId ?? ""} className={fieldClasses}>
              <option value="">Sem responsável</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-overview-text-primary">
            Prazo
            <input name="due_date" type="date" defaultValue={initialDueDate ?? ""} className={fieldClasses} />
          </label>

          <label className="flex flex-col gap-1 text-sm text-overview-text-primary">
            Observação <span className="text-xs text-overview-text-muted">(opcional)</span>
            <textarea name="notes" rows={3} defaultValue={initialNotes ?? ""} className={fieldClasses} />
          </label>

          {state.status === "error" && <p className="text-xs text-overview-danger">{state.message}</p>}

          <div className="mt-auto flex items-center gap-2 pt-2">
            <SubmitButton
              pendingChildren="Salvando..."
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              {isEdit ? "Salvar alterações" : "Adicionar pendência"}
            </SubmitButton>
            <Link
              href={closeHref}
              scroll={false}
              className="rounded-md border border-overview-border px-4 py-2 text-sm font-medium text-overview-text-primary hover:bg-overview-surface-hover"
            >
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </>
  );
}
