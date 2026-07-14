"use client";

import Link from "next/link";
import { createTaskAction, updateTaskAction } from "./tasks-actions";
import { TASK_TYPE_DEFAULT_TITLE } from "./task-labels";
import type { TaskType } from "@/lib/supabase/database.types";

type OccurrenceType = Extract<TaskType, "reuniao" | "entrega_criativo">;

const OCCURRENCE_LABEL: Record<OccurrenceType, string> = {
  reuniao: "reunião",
  entrega_criativo: "entrega de criativo",
};

/**
 * Drawer pequeno pra agendar/editar/reagendar reunião ou entrega de criativo
 * sem sair da página do cliente (Etapas 4/5 do pedido) — mesmo padrão já
 * usado por `RecordAccountReviewDrawer`/`AccountReviewDetailDrawer`: um
 * "use client" leve, aberto/fechado via searchParam da própria
 * `/clients/[id]`, submetendo por uma Server Action nativa já existente
 * (`createTaskAction`/`updateTaskAction` — nenhuma action nova criada só
 * pra isso). O título da tarefa nunca é pedido ao usuário aqui: usa sempre
 * o padrão do tipo (`TASK_TYPE_DEFAULT_TITLE`), igual ao que os templates de
 * sprint já fazem, pra manter o fluxo compacto (só data + horário opcional +
 * observação opcional).
 */
export function ScheduleOccurrenceDrawer({
  occurrenceType,
  clientId,
  returnTo,
  closeHref,
  editingTask,
}: {
  occurrenceType: OccurrenceType;
  clientId: string;
  returnTo: string;
  closeHref: string;
  editingTask?: {
    id: string;
    dueDate: string;
    dueTime: string | null;
    notes: string | null;
  } | null;
}) {
  const isEdit = Boolean(editingTask);
  const label = OCCURRENCE_LABEL[occurrenceType];
  const title = isEdit ? `Reagendar ${label}` : `Agendar ${label}`;
  const action = isEdit
    ? updateTaskAction.bind(null, editingTask!.id, clientId)
    : createTaskAction.bind(null, clientId);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 px-4 py-16 sm:items-center">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <Link href={closeHref} scroll={false} className="text-sm text-muted-foreground hover:text-foreground">
            Fechar
          </Link>
        </div>

        <form action={action} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="return_to" value={returnTo} />
          {!isEdit && <input type="hidden" name="type" value={occurrenceType} />}
          {!isEdit && <input type="hidden" name="title" value={TASK_TYPE_DEFAULT_TITLE[occurrenceType]} />}
          {isEdit && <input type="hidden" name="title" value={TASK_TYPE_DEFAULT_TITLE[occurrenceType]} />}
          {isEdit && <input type="hidden" name="type" value={occurrenceType} />}
          {isEdit && <input type="hidden" name="assignee_id" value="" />}
          {!isEdit && <input type="hidden" name="assignee_id" value="" />}
          <input type="hidden" name="recurrence" value="nenhuma" />

          <label className="flex flex-col gap-1 text-sm text-foreground">
            Data
            <input
              name="due_date"
              type="date"
              required
              defaultValue={editingTask?.dueDate}
              className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-zinc-500"
            />
          </label>

          {occurrenceType === "reuniao" && (
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Horário <span className="text-xs text-muted-foreground">(opcional)</span>
              <input
                name="due_time"
                type="time"
                defaultValue={editingTask?.dueTime ?? ""}
                className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-zinc-500"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm text-foreground">
            Observação <span className="text-xs text-muted-foreground">(opcional)</span>
            <textarea
              name="notes"
              rows={2}
              defaultValue={editingTask?.notes ?? ""}
              className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-zinc-500"
            />
          </label>

          <div className="mt-1 flex items-center justify-end gap-2">
            <Link
              href={closeHref}
              scroll={false}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
            >
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
