import Link from "next/link";
import { EmptyState } from "@/components/workspace/empty-state";
import { Button } from "@/components/workspace/button";
import { REMINDER_FILTER_LABEL, type ReminderCounts, type ReminderFilter, type ReminderRow as ReminderRowData } from "@/lib/reminders";
import { ReminderRow } from "./reminder-row";

const FILTERS: ReminderFilter[] = ["todas", "agencia", "clientes", "minhas"];

/**
 * Módulo "Pendências" — Visão Geral da Agência. Full-width, posicionado
 * logo abaixo do painel financeiro/operacional (que abre com os Big
 * Numbers) e antes de Prioridades. Deliberadamente mais leve que a área de
 * tarefas: sem sprint/performance/otimização/status manual/prioridade —
 * só o que foi pedido (título, origem, responsável, prazo).
 */
export function RemindersPanel({
  reminders,
  todayStr,
  counts,
  filter,
  buildFilterHref,
  addHref,
  completedHref,
  buildEditHref,
}: {
  reminders: ReminderRowData[];
  todayStr: string;
  counts: ReminderCounts;
  filter: ReminderFilter;
  buildFilterHref: (filter: ReminderFilter) => string;
  addHref: string;
  completedHref: string;
  buildEditHref: (reminderId: string) => string;
}) {
  return (
    <section className="rounded-lg border border-overview-border bg-overview-surface px-5 py-3.5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-overview-text-primary">Pendências</h2>
          <p className="mt-0.5 text-xs text-overview-text-secondary">Assuntos da agência e dos clientes que ainda precisam ser resolvidos.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button href={completedHref} variant="ghost" size="sm">
            Ver concluídas
          </Button>
          <Button href={addHref} variant="primary" size="sm">
            + Adicionar pendência
          </Button>
        </div>
      </div>

      {counts.openCount > 0 && (
        <p className="mt-2 text-xs text-overview-text-muted">
          {counts.openCount} em aberto
          {counts.overdueCount > 0 && ` · ${counts.overdueCount} atrasada${counts.overdueCount !== 1 ? "s" : ""}`}
          {counts.dueTodayCount > 0 && ` · ${counts.dueTodayCount} vence${counts.dueTodayCount !== 1 ? "m" : ""} hoje`}
        </p>
      )}

      <div className="mt-3 inline-flex items-center gap-0.5 rounded-full border border-overview-border p-0.5">
        {FILTERS.map((option) => (
          <Link
            key={option}
            href={buildFilterHref(option)}
            scroll={false}
            aria-pressed={option === filter}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              option === filter ? "bg-overview-brand-subtle text-brand" : "text-overview-text-secondary hover:text-overview-text-primary"
            }`}
          >
            {REMINDER_FILTER_LABEL[option]}
          </Link>
        ))}
      </div>

      <div className="mt-3">
        {reminders.length > 0 ? (
          <div className="flex flex-col divide-y divide-overview-border">
            {reminders.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} todayStr={todayStr} editHref={buildEditHref(reminder.id)} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhuma pendência em aberto"
            description="Tudo resolvido por enquanto. Novas pendências podem ser adicionadas aqui."
            action={
              <Button href={addHref} variant="primary" size="sm">
                Adicionar pendência
              </Button>
            }
          />
        )}
      </div>
    </section>
  );
}
