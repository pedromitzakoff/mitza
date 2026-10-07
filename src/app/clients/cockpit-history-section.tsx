import Link from "next/link";
import { formatRelativeDateTime } from "@/lib/format";
import type { ClientTimelineRow } from "@/lib/client-timeline";

const CATEGORY_DOT_CLASS: Record<ClientTimelineRow["category"], string> = {
  planejamento: "bg-brand",
  operacao: "bg-overview-text-muted",
  demandas: "bg-lime",
  performance: "bg-overview-success",
  conta: "bg-overview-text-muted",
};

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Histórico" (pedido,
 * seções 26-28) — "O que aconteceu recentemente?". MESMA fonte da Timeline
 * do cliente (`fetchClientTimelinePage`, `lib/client-timeline.ts`), nenhum
 * histórico novo — só as 5-8 linhas mais recentes, num formato mais
 * compacto que a Timeline completa (sem agrupamento por dia, sem filtro de
 * categoria — isso continua só em `/clients/[id]/timeline`).
 */
export function CockpitHistorySection({ rows, fullHistoryHref }: { rows: ClientTimelineRow[]; fullHistoryHref: string }) {
  const now = new Date();

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Histórico</h2>
        <Link href={fullHistoryHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
          Ver histórico completo →
        </Link>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-3 flex flex-col">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 border-b border-overview-border/60 py-2 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-overview-text-muted">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT_CLASS[row.category]}`} aria-hidden="true" />
                <span className="tabular-nums">{formatRelativeDateTime(row.occurredAt, now)}</span>
              </div>
              {row.reviewPresentation ? (
                <p className="text-sm text-overview-text-primary">{row.reviewPresentation.headline}</p>
              ) : (
                <p className="text-sm text-overview-text-primary">
                  {row.label}
                  {row.detail ? <span className="text-overview-text-secondary"> · {row.detail}</span> : null}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-overview-text-secondary">Nenhum evento registrado ainda.</p>
      )}
    </div>
  );
}
