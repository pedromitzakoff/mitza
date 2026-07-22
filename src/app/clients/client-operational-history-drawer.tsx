import Link from "next/link";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import { ClientHistoryList } from "./client-history-list";

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
    <>
      <Link href={closeHref} scroll={false} aria-label="Fechar" className="mitza-backdrop-in fixed inset-0 z-30 bg-black/30" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Histórico de {monthLabel}</h2>
          <Link href={closeHref} scroll={false} autoFocus className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Fechar
          </Link>
        </div>

        <ClientHistoryList
          rows={rows}
          buildReviewDetailHref={buildReviewDetailHref}
          emptyLabel={`Nenhum evento registrado em ${monthLabel}.`}
        />

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
    </>
  );
}
