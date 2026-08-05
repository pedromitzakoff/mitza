import { formatDayMonthLong } from "@/lib/format";
import { getReminderBucket, type ReminderRow as ReminderRowData } from "@/lib/reminders";
import { completeReminderAction } from "./reminders-actions";
import { ReminderCompleteButton } from "./reminder-complete-button";
import { ReminderRowMenu } from "./reminder-row-menu";

/** Uma linha do módulo de Pendências — compacta, horizontal, sem descrição
 * longa (a observação só aparece ao editar). Indicador de atrasada é só
 * cor (mesmo princípio de `task-row.tsx`: "badge saiu, sobra só círculo e
 * data em vermelho discreto"), nunca um texto/badge "Atrasada". */
export function ReminderRow({ reminder, todayStr, editHref }: { reminder: ReminderRowData; todayStr: string; editHref: string }) {
  const bucket = getReminderBucket(reminder.dueDate, todayStr);
  const dueLabel = bucket === "today" ? "Vence hoje" : bucket === "none" ? "Sem prazo" : formatDayMonthLong(reminder.dueDate!);
  const dueClass =
    bucket === "overdue" ? "text-overview-danger" : bucket === "today" ? "font-medium text-brand" : "text-overview-text-muted";
  const originLabel = reminder.scope === "agency" ? "Agência" : (reminder.clientName ?? "Cliente");

  return (
    <div className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-overview-surface-hover">
      <form action={completeReminderAction.bind(null, reminder.id)} className="mt-0.5">
        <ReminderCompleteButton tone={bucket === "overdue" ? "overdue" : bucket === "today" ? "today" : "normal"} />
      </form>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-overview-text-primary">{reminder.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-overview-text-secondary">
          <span>{originLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{reminder.assigneeName ?? "Sem responsável"}</span>
          <span aria-hidden="true">·</span>
          <span className={dueClass}>{dueLabel}</span>
        </p>
      </div>
      <ReminderRowMenu reminderId={reminder.id} reminderTitle={reminder.title} editHref={editHref} />
    </div>
  );
}
