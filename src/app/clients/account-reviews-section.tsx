import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
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
}

const OUTCOME_TEXT_CLASSES: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "text-muted-foreground",
  OPTIMIZATION_PERFORMED: "text-emerald-600 dark:text-emerald-400",
  ISSUE_IDENTIFIED: "text-amber-600 dark:text-amber-400",
};

function reviewSubtitle(review: AccountReviewSummaryItem): string {
  if (review.outcome === "OPTIMIZATION_PERFORMED") {
    return `${review.optimizationCount} ${review.optimizationCount === 1 ? "otimização" : "otimizações"}`;
  }
  if (review.outcome === "ISSUE_IDENTIFIED") {
    return review.issueDescription ?? "";
  }
  return "";
}

/**
 * "ANÁLISES DA CONTA" (Etapa 57, seção 21) — dentro do componente
 * compartilhado de Sprint, logo depois de Tarefas. Compacta: data/hora,
 * resultado, resumo de uma linha, gestor; "+ Registrar análise" abre o
 * drawer (nunca formulário aberto permanentemente na tela).
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
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Análises da conta</h3>
        <span className="text-xs text-muted-foreground">
          {reviews.length} nesta sprint
        </span>
      </div>

      {reviews.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {reviews.map((review) => (
            <li key={review.id}>
              <Link
                href={buildDetailHref(review.id)}
                scroll={false}
                className="flex flex-col gap-0.5 rounded-md px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground">{formatDateTime(review.reviewedAt)}</span>
                  <span className="text-muted-foreground">{review.managerName}</span>
                </div>
                <div className="flex items-baseline gap-1.5 text-sm">
                  <span className={`font-medium ${OUTCOME_TEXT_CLASSES[review.outcome]}`}>
                    {ACCOUNT_REVIEW_OUTCOME_LABEL[review.outcome]}
                  </span>
                  {reviewSubtitle(review) && (
                    <span className="truncate text-xs text-muted-foreground">· {reviewSubtitle(review)}</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">Nenhuma análise registrada nesta sprint.</p>
      )}

      <Link href={newReviewHref} scroll={false} className="mt-1.5 inline-block text-xs font-medium text-brand hover:underline">
        + Registrar análise
      </Link>
    </div>
  );
}
