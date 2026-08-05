import Link from "next/link";
import { formatDateFromInstant } from "@/lib/format";
import { EmptyState } from "@/components/workspace/empty-state";
import type { ReminderRow } from "@/lib/reminders";
import { restoreReminderAction } from "./reminders-actions";
import { ReminderRestoreButton } from "./reminder-complete-button";

/** "Ver concluídas" — permite restaurar uma pendência finalizada por
 * engano (pedido explícito do usuário). Mesmo padrão de drawer (backdrop +
 * painel deslizante) já usado em `record-account-review-drawer.tsx`. */
export function RemindersCompletedDrawer({ reminders, closeHref }: { reminders: ReminderRow[]; closeHref: string }) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-overview-text-primary">Pendências concluídas</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
          >
            Fechar
          </Link>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {reminders.length > 0 ? (
            reminders.map((reminder) => (
              <div key={reminder.id} className="flex items-start justify-between gap-2 rounded-md border border-overview-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-overview-text-primary line-through decoration-overview-text-muted">{reminder.title}</p>
                  <p className="mt-0.5 text-xs text-overview-text-muted">
                    {reminder.scope === "agency" ? "Agência" : (reminder.clientName ?? "Cliente")}
                    {reminder.completedByName && ` · Concluída por ${reminder.completedByName}`}
                    {reminder.completedAt && ` em ${formatDateFromInstant(reminder.completedAt)}`}
                  </p>
                </div>
                <form action={restoreReminderAction.bind(null, reminder.id)} className="shrink-0">
                  <ReminderRestoreButton />
                </form>
              </div>
            ))
          ) : (
            <EmptyState title="Nenhuma pendência concluída ainda." />
          )}
        </div>
      </div>
    </>
  );
}
