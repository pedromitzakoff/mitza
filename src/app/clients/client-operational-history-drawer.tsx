import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { ClientHistoryRow } from "@/lib/client-operational-history";

/**
 * "Ver todos de {mês}" (Etapa 9 do pedido) — histórico completo do mês
 * selecionado, paginado (mesmo padrão de `operational-activity-panel.tsx`
 * — Links `?historyPage=N` com `scroll={false}`, nenhum componente de
 * paginação novo). Mesma linha compacta do card, só sem o corte de 5.
 */
export function ClientOperationalHistoryDrawer({
  monthLabel,
  rows,
  hasMore,
  page,
  buildPageHref,
  buildReviewDetailHref,
  closeHref,
}: {
  monthLabel: string;
  rows: ClientHistoryRow[];
  hasMore: boolean;
  page: number;
  buildPageHref: (page: number) => string;
  buildReviewDetailHref: (reviewId: string) => string;
  closeHref: string;
}) {
  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Histórico de {monthLabel}</h2>
          <Link href={closeHref} scroll={false} className="text-sm text-muted-foreground hover:text-foreground">
            Fechar
          </Link>
        </div>

        {rows.length > 0 ? (
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
                    Ver análise
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum evento registrado em {monthLabel}.</p>
        )}

        {(page > 0 || hasMore) && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
            {page > 0 ? (
              <Link href={buildPageHref(page - 1)} scroll={false} className="font-medium text-brand hover:underline">
                &larr; Mais recentes
              </Link>
            ) : (
              <span />
            )}
            {hasMore && (
              <Link href={buildPageHref(page + 1)} scroll={false} className="font-medium text-brand hover:underline">
                Mais antigos &rarr;
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
