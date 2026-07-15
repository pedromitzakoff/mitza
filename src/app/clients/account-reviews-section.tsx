import Link from "next/link";
import { EmptyStateRow } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { formatDateTime } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
import { CLIENT_UPDATE_STATUS_LABEL, type ClientUpdateStatus } from "@/lib/client-updates";
import type { AccountReviewOutcome, AccountReviewReason } from "@/lib/supabase/database.types";

export interface AccountReviewSummaryItem {
  id: string;
  reviewedAt: string;
  reason: AccountReviewReason;
  reasonOtherDescription: string | null;
  outcome: AccountReviewOutcome;
  managerName: string;
  optimizationCount: number;
  issueDescription: string | null;
  /** Etapa 59 — indicador discreto de Atualização para o Cliente; "none"
   * nunca é mostrado (seção 15 do pedido: análise sem atualização gerada não
   * exibe nada). */
  updateStatus: ClientUpdateStatus;
}

const OUTCOME_TEXT_CLASSES: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "text-muted-foreground",
  OPTIMIZATION_PERFORMED: "text-emerald-600 dark:text-emerald-400",
  ISSUE_IDENTIFIED: "text-amber-600 dark:text-amber-400",
};

function reviewSubtitle(review: AccountReviewSummaryItem): string {
  if (review.outcome === "OPTIMIZATION_PERFORMED") {
    return `${review.optimizationCount} ${review.optimizationCount === 1 ? "alteração" : "alterações"}`;
  }
  if (review.outcome === "ISSUE_IDENTIFIED") {
    return review.issueDescription ?? "";
  }
  return "";
}

/**
 * "OTIMIZAÇÕES" (Etapa 57/74) — dentro de "Execução da sprint", ao lado de
 * Tarefas. Otimização = revisão estratégica da conta, registrada mesmo
 * quando nenhuma alteração foi necessária (ver lib/account-reviews.ts).
 *
 * Etapa "Sprint Workspace Polish 1.0" (Parte 3): cada otimização virou uma
 * LINHA estruturada — mesma anatomia de `TaskRow` (moldura em lista com
 * borda/raio, `<li>` com hover, colunas fixas: data/hora, resumo, gestor,
 * indicador de abrir) — em vez do antigo bloco de texto empilhado em 2-3
 * linhas. Nenhum dado novo: mesmas informações de sempre, só reorganizadas
 * numa linha só. "+ Registrar otimização" subiu pro cabeçalho (Parte 5 —
 * mesmo lugar que "+ Tarefa" ocupa em `SprintTaskList`), pra não duplicar
 * essa ação também dentro do estado vazio.
 */
export function AccountReviewsSection({
  reviews,
  newReviewHref,
  buildDetailHref,
}: {
  reviews: AccountReviewSummaryItem[];
  newReviewHref: string;
  buildDetailHref: (reviewId: string) => string;
}) {
  return (
    <div>
      <SectionHeader
        action={
          <span className="flex shrink-0 flex-wrap items-center gap-2.5">
            {reviews.length > 0 && <span className="text-[11px] text-muted-foreground">{reviews.length} nesta sprint</span>}
            <Link
              href={newReviewHref}
              scroll={false}
              className="mitza-pressable rounded text-xs font-medium text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              + Registrar otimização
            </Link>
          </span>
        }
      >
        Otimizações
      </SectionHeader>

      {reviews.length > 0 ? (
        <ul className="mt-1.5 rounded-lg border border-border [&>li:first-child]:rounded-t-lg [&>li:last-child]:rounded-b-lg">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex min-h-[28px] items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
            >
              <Link href={buildDetailHref(review.id)} scroll={false} className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(review.reviewedAt)}
                </span>

                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className={`font-medium ${OUTCOME_TEXT_CLASSES[review.outcome]}`}>
                    {ACCOUNT_REVIEW_OUTCOME_LABEL[review.outcome]}
                  </span>
                  {reviewSubtitle(review) && (
                    <span className="truncate text-xs text-muted-foreground"> · {reviewSubtitle(review)}</span>
                  )}
                </span>

                <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground md:block">
                  {review.managerName}
                </span>

                {review.updateStatus !== "none" && (
                  <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                    {CLIENT_UPDATE_STATUS_LABEL[review.updateStatus]}
                  </span>
                )}

                <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyStateRow className="mt-1.5">Nenhuma otimização registrada nesta sprint.</EmptyStateRow>
      )}
    </div>
  );
}
