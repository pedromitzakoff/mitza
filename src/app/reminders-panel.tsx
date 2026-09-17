import Link from "next/link";
import { EmptyState } from "@/components/workspace/empty-state";
import { Button } from "@/components/workspace/button";
import { REMINDER_FILTER_LABEL, type ReminderCounts, type ReminderFilter, type ReminderRow as ReminderRowData } from "@/lib/reminders";
import { ReminderRow } from "./reminder-row";

const FILTERS: ReminderFilter[] = ["todas", "agencia", "clientes", "minhas"];

/** Etapa "Reformulação da Home": nunca mostrar a carteira inteira de
 * pendências na Home — as mais relevantes (a ordenação de `sortReminders`
 * já é atrasadas → vencem hoje → prazo futuro → sem prazo, nenhum critério
 * novo) primeiro, "Ver todas" expande sem perder filtro/posição. */
const REMINDERS_HOME_VISIBLE_LIMIT = 5;

const LINK_ACTION_CLASSES = "text-[13px] text-overview-text-muted underline decoration-overview-border hover:text-overview-text-secondary";

/**
 * Módulo "Pendências" — Visão Geral da Agência. Etapa "Reformulação da
 * Home": deixa de ser um card com borda própria (`rounded-lg border
 * bg-overview-surface`) — passa a compartilhar a mesma linguagem de seção
 * (`border-t` fino) de "Atenção"/"Aconteceu recentemente" acima, pra reduzir
 * a sensação de "vários cards dentro de cards" pedida nesta etapa. Vazio
 * (`counts.openCount === 0`) fica numa linha só, sem os filtros (não há o
 * que filtrar) — "Adicionar pendência"/"Ver concluídas" continuam
 * acessíveis, nenhuma funcionalidade removida.
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
  expanded,
  expandHref,
  collapseHref,
}: {
  reminders: ReminderRowData[];
  todayStr: string;
  counts: ReminderCounts;
  filter: ReminderFilter;
  buildFilterHref: (filter: ReminderFilter) => string;
  addHref: string;
  completedHref: string;
  buildEditHref: (reminderId: string) => string;
  /** `pendenciaExpandir=1` na URL — mostra a lista inteira em vez do corte
   * de `REMINDERS_HOME_VISIBLE_LIMIT`. */
  expanded: boolean;
  expandHref: string;
  collapseHref: string;
}) {
  const visibleReminders = expanded ? reminders : reminders.slice(0, REMINDERS_HOME_VISIBLE_LIMIT);
  const hiddenCount = reminders.length - visibleReminders.length;

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Pendências</h2>
        <div className="flex items-center gap-2">
          <Button href={completedHref} variant="ghost" size="sm">
            Ver concluídas
          </Button>
          <Button href={addHref} variant="primary" size="sm">
            + Adicionar pendência
          </Button>
        </div>
      </div>

      {counts.openCount === 0 ? (
        <p className="mt-2 text-[13px] text-overview-text-secondary">Nenhuma pendência em aberto.</p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-overview-text-secondary">
            {counts.openCount} em aberto
            {counts.overdueCount > 0 && ` · ${counts.overdueCount} atrasada${counts.overdueCount !== 1 ? "s" : ""}`}
            {counts.dueTodayCount > 0 && ` · ${counts.dueTodayCount} vence${counts.dueTodayCount !== 1 ? "m" : ""} hoje`}
          </p>

          <div className="mt-2.5 inline-flex items-center gap-0.5 rounded-full border border-overview-border p-0.5">
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
                {visibleReminders.map((reminder) => (
                  <ReminderRow key={reminder.id} reminder={reminder} todayStr={todayStr} editHref={buildEditHref(reminder.id)} />
                ))}
              </div>
            ) : (
              // Filtro de chip (Agência/Clientes/Minhas) sem nenhum resultado
              // — diferente de `counts.openCount === 0` (nenhuma pendência em
              // lugar nenhum): aqui existem pendências, só não deste recorte.
              <EmptyState title="Nenhuma pendência neste filtro." />
            )}
          </div>

          {hiddenCount > 0 && (
            <Link href={expandHref} scroll={false} className={`mt-2 inline-block ${LINK_ACTION_CLASSES}`}>
              Ver todas as {reminders.length} pendências
            </Link>
          )}
          {expanded && reminders.length > REMINDERS_HOME_VISIBLE_LIMIT && (
            <Link href={collapseHref} scroll={false} className={`mt-2 inline-block ${LINK_ACTION_CLASSES}`}>
              Ver menos
            </Link>
          )}
        </>
      )}
    </section>
  );
}
