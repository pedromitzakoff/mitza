import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDateWithYear, formatDateTime, formatShortDateFromInstant } from "@/lib/format";

export interface MonthlyBudgetChangeRow {
  id: string;
  effectiveDate: string;
  changedAt: string;
  changedByName: string | null;
  previousAmount: number;
  newAmount: number;
  consolidatedAmount: number;
  futureAmountDistributed: number;
  resultingTotal: number;
  isBelowConsolidated: boolean;
  /** Motivo opcional informado pelo gestor (Etapa MVP "Comentário no
   * histórico de alteração de orçamento") — `null` = nenhum motivo
   * informado nesta alteração (nunca inventado retroativamente). */
  reason: string | null;
}

/**
 * "Ver histórico" — mesmo padrão visual de drawer usado em AttentionCenterDrawer
 * e TaskDrawerPanel (link fixed-overlay + painel fixo à direita, aberto via
 * query param, sem JS de estado próprio). Só é linkado pra admin (ver
 * month-investment-summary.tsx); a query da lista completa também só roda pro
 * admin no server component que monta a página do cliente.
 */
export function MonthlyBudgetHistoryDrawer({
  monthLabel,
  changes,
  closeHref,
}: {
  monthLabel: string;
  changes: MonthlyBudgetChangeRow[];
  closeHref: string;
}) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Histórico de orçamento · {monthLabel}</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        {changes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {changes.map((change) => (
              <li key={change.id} className="rounded-md border border-border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Efeito em {formatDateWithYear(change.effectiveDate)}
                  </span>
                  <span className="text-muted-foreground">{formatDateTime(change.changedAt)}</span>
                </div>
                <p className="mt-1 tabular-nums text-foreground">
                  {formatCurrency(change.previousAmount)} → {formatCurrency(change.newAmount)}
                </p>
                <dl className="mt-1.5 flex flex-col gap-0.5 text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>Consolidado até a data de efeito</dt>
                    <dd className="tabular-nums">{formatCurrency(change.consolidatedAmount)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Distribuído no futuro</dt>
                    <dd className="tabular-nums">{formatCurrency(change.futureAmountDistributed)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Total resultante</dt>
                    <dd className="tabular-nums">{formatCurrency(change.resultingTotal)}</dd>
                  </div>
                </dl>
                {change.isBelowConsolidated && (
                  <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    Excedente histórico
                  </p>
                )}
                <p className="mt-1.5 text-muted-foreground">
                  Alterado em {formatShortDateFromInstant(change.changedAt)} por {change.changedByName ?? "usuário removido"}
                </p>
                {/* Etapa MVP "Comentário no histórico de alteração de
                    orçamento" — só aparece quando o gestor informou um
                    motivo (nunca "Motivo: —" fabricado). */}
                {change.reason && (
                  <p className="mt-1 text-foreground">
                    <span className="text-muted-foreground">Motivo: </span>
                    {change.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="mt-4">Nenhuma alteração registrada.</EmptyState>
        )}
      </div>
    </>
  );
}
