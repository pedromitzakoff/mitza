import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import type { ClientHistoryRow } from "@/lib/client-operational-history";

/**
 * Lista de eventos do histórico operacional do cliente — extraída de
 * `ClientOperationalHistoryDrawer` (Etapa "MITZA 2.0 — Refinamento da
 * Experiência do Cliente") pra ser reaproveitada também pela aba Timeline,
 * que agora mostra a mesma lista como conteúdo principal da aba (sem
 * overlay). Nenhuma consulta, cálculo ou tipo novo — só a marcação da lista
 * em si, sem a moldura de drawer (backdrop/painel fixo/"Fechar").
 */
export function ClientHistoryList({
  rows,
  buildReviewDetailHref,
  emptyLabel,
}: {
  rows: ClientHistoryRow[];
  buildReviewDetailHref: (reviewId: string) => string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <EmptyState className="mt-3">{emptyLabel}</EmptyState>;
  }

  return (
    <ul className="mt-3 flex flex-col">
      {rows.map((event) => (
        <li
          key={event.id}
          className="flex items-start justify-between gap-2 border-t border-border py-2 first:border-t-0 first:pt-0"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{formatDateTime(event.occurredAt)}</span>
              <span className="font-medium text-foreground">{event.label}</span>
              {event.detail && <span>{event.detail}</span>}
            </div>
            {event.responsibleName && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.responsibleName}</p>
            )}
          </div>
          {event.reviewId && (
            <Link
              href={buildReviewDetailHref(event.reviewId)}
              scroll={false}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              Ver otimização
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
