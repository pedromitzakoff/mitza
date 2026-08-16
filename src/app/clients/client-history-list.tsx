import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import type { ClientHistoryRow } from "@/lib/client-operational-history";

/**
 * Lista de eventos do histórico operacional do cliente — extraída de
 * `ClientOperationalHistoryDrawer` (Etapa "MITZA 2.0 — Refinamento da
 * Experiência do Cliente") pra ser reaproveitada pela aba Timeline, pelo
 * drawer, e agora também pela seção Timeline do Analytics (Etapa "Analytics
 * Instagramável") — os 3 lugares que usam este componente ganham o mesmo
 * upgrade visual de uma vez, nunca uma segunda lista. Nenhuma consulta,
 * cálculo ou tipo novo — só a marcação.
 *
 * Facelift: era uma lista de `<li>` com bullet points de texto ("parece uma
 * tabela" — pedido explícito do usuário); agora é um feed vertical de
 * verdade, com marcador + linha conectando os eventos no tempo.
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
      {rows.map((event, index) => (
        <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < rows.length - 1 && <span className="absolute left-[3px] top-3 h-full w-px bg-overview-border" aria-hidden="true" />}
          <span className="relative z-10 mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tabular-nums text-overview-text-primary">{formatDateTime(event.occurredAt)}</p>
            <p className="mt-0.5 text-sm text-overview-text-primary">
              {event.label}
              {event.detail && <span className="text-overview-text-secondary"> · {event.detail}</span>}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-overview-text-secondary">
              {event.responsibleName && <span>{event.responsibleName}</span>}
              {event.reviewId && (
                <Link href={buildReviewDetailHref(event.reviewId)} scroll={false} className="font-medium text-brand hover:underline">
                  Ver otimização
                </Link>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
