import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { formatDateTime } from "@/lib/format";
import { ACTIVITY_PERIOD_LABEL, type ActivityPeriodKey, type TeamMemberActivitySummary, type TeamMemberTimelineRow } from "@/lib/team-member-activity";
import { OPERATIONAL_EVENT_TYPE_LABEL, formatDelay } from "@/lib/operational-events";

const PERIODS: ActivityPeriodKey[] = ["7d", "30d", "month"];

/**
 * "Atividade operacional" (seção 26/27 do pedido) — indicadores
 * DESCRITIVOS a partir de operational_events, nunca chamados de
 * "produtividade", sem score/ranking/bônus. Timeline compacta abaixo, sem
 * metadata bruto — só rótulo/cliente/prazo já resolvidos.
 */
export function OperationalActivityPanel({
  memberId,
  period,
  summary,
  timelineRows,
  timelinePage,
  timelineHasMore,
}: {
  memberId: string;
  period: ActivityPeriodKey;
  summary: TeamMemberActivitySummary;
  timelineRows: TeamMemberTimelineRow[];
  timelinePage: number;
  timelineHasMore: boolean;
}) {
  function periodHref(p: ActivityPeriodKey) {
    return `/team?edit=${memberId}&period=${p}`;
  }
  function pageHref(p: number) {
    return `/team?edit=${memberId}&period=${period}&timelinePage=${p}`;
  }

  return (
    <section className="mt-5 border-t border-border pt-4">
      <SectionHeader
        action={
          <div className="flex gap-1 rounded-md border border-border p-0.5 text-xs">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={periodHref(p)}
                scroll={false}
                className={`rounded px-2 py-0.5 font-medium ${
                  p === period ? "bg-brand text-white" : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                {ACTIVITY_PERIOD_LABEL[p]}
              </Link>
            ))}
          </div>
        }
      >
        Atividade operacional
      </SectionHeader>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Stat label="Tarefas concluídas" value={summary.tasksCompleted} />
        <Stat label="No prazo" value={summary.tasksCompletedOnTime} />
        <Stat label="Atrasadas" value={summary.tasksCompletedLate} />
        <Stat label="Taxa no prazo" value={summary.onTimeRate !== null ? `${summary.onTimeRate}%` : "—"} />
        <Stat label="Atraso médio" value={summary.averageDelayLabel} small />
        <Stat label="Otimizações realizadas" value={summary.optimizationsCompleted} />
        <Stat label="Reuniões realizadas" value={summary.meetingsCompleted} />
        <Stat label="Entregas de criativos" value={summary.creativeDeliveriesCompleted} />
        <Stat label="Tarefas reabertas" value={summary.tasksReopened} />
        <Stat label="Recebeu por reatribuição" value={summary.tasksReassignedReceived} />
        <Stat label="Repassou por reatribuição" value={summary.tasksReassignedAway} />
      </dl>

      <SectionHeader as="h4" className="mt-4">Linha do tempo</SectionHeader>
      {timelineRows.length === 0 ? (
        <EmptyState className="mt-2">Nenhum evento registrado ainda.</EmptyState>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {timelineRows.map((row) => (
            <li key={row.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{OPERATIONAL_EVENT_TYPE_LABEL[row.eventType]}</span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(row.occurredAt)}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {[row.clientName, row.taskTitle].filter(Boolean).join(" · ") || "—"}
              </p>
              {row.wasOnTime !== null && (
                <p className={row.wasOnTime ? "mt-0.5 text-emerald-600 dark:text-emerald-400" : "mt-0.5 text-amber-600 dark:text-amber-400"}>
                  {row.wasOnTime ? "No prazo" : formatDelay(row.delaySeconds)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {(timelinePage > 0 || timelineHasMore) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {timelinePage > 0 && (
            <Link href={pageHref(timelinePage - 1)} scroll={false} className="font-medium text-brand hover:underline">
              Mais recentes
            </Link>
          )}
          {timelineHasMore && (
            <Link href={pageHref(timelinePage + 1)} scroll={false} className="font-medium text-brand hover:underline">
              Ver mais antigos
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={small ? "text-xs font-medium text-foreground" : "text-sm font-medium text-foreground"}>{value}</p>
    </div>
  );
}
