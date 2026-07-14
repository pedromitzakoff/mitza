import Link from "next/link";
import { formatRelativeDateTime } from "@/lib/format";
import type { ClientHistoryRow } from "@/lib/client-operational-history";

function HistoryRow({
  event,
  buildReviewDetailHref,
}: {
  event: ClientHistoryRow;
  buildReviewDetailHref: (id: string) => string;
}) {
  return (
    <li className="flex items-start justify-between gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatRelativeDateTime(event.occurredAt, new Date())}</span>
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
  );
}

/**
 * Histórico do mês, recolhido por padrão (refinamento visual — mesmos
 * dados/ordem/link "Ver análise" de sempre, só o estado inicial mudou).
 * Usa `<details>/<summary>` nativo em vez de um `button`/`aria-expanded`
 * escrito à mão: é o próprio padrão de disclosure acessível do HTML (estado
 * já anunciado a leitores de tela, navegável por teclado, foco visível via
 * `:focus-visible`) e é o mesmo mecanismo já usado em todo o resto do
 * sistema (`FormSection`, "Ver detalhes da sprint", etc.) — nenhuma
 * duplicação de semântica ARIA por cima do que o navegador já garante.
 * Nunca abre sozinho: `<details>` sem o atributo `open` nasce sempre
 * fechado, em toda visita/navegação (nenhum estado persistido).
 */
export function CollapsibleAccountHistory({
  monthLabel,
  historyRows,
  hasMoreHistory,
  historyHref,
  buildReviewDetailHref,
}: {
  monthLabel: string;
  historyRows: ClientHistoryRow[];
  hasMoreHistory: boolean;
  historyHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
}) {
  // Sufixo de contagem só quando `historyRows.length` já É o total exato do
  // mês (ou seja, quando não há mais nada além do que foi buscado) — com
  // `hasMoreHistory`, o total real é desconhecido aqui (só as 5 mais
  // recentes foram buscadas), então nunca fabricamos um número que pode
  // estar errado.
  const countSuffix =
    historyRows.length > 0 && !hasMoreHistory
      ? ` · ${historyRows.length} registro${historyRows.length === 1 ? "" : "s"}`
      : "";

  return (
    <details className="group mt-3 border-t border-border pt-1.5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-brand">
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">▸</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Histórico de {monthLabel}
          {countSuffix}
        </span>
      </summary>

      <div className="mt-1.5">
        {hasMoreHistory && (
          <div className="mb-1 flex justify-end">
            <Link href={historyHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
              Ver todos de {monthLabel}
            </Link>
          </div>
        )}

        {historyRows.length > 0 ? (
          <ul className="flex flex-col">
            {historyRows.map((event) => (
              <HistoryRow key={event.id} event={event} buildReviewDetailHref={buildReviewDetailHref} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma atividade registrada neste período.</p>
        )}
      </div>
    </details>
  );
}
