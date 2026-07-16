import Link from "next/link";
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

export const OUTCOME_TEXT_CLASSES: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "text-muted-foreground",
  OPTIMIZATION_PERFORMED: "text-green-600 dark:text-green-400",
  ISSUE_IDENTIFIED: "text-amber-600 dark:text-amber-400",
};

export function reviewSubtitle(review: AccountReviewSummaryItem): string {
  if (review.outcome === "OPTIMIZATION_PERFORMED") {
    return `${review.optimizationCount} ${review.optimizationCount === 1 ? "alteração" : "alterações"}`;
  }
  if (review.outcome === "ISSUE_IDENTIFIED") {
    return review.issueDescription ?? "";
  }
  return "";
}

/**
 * Linha de UMA revisão de conta — otimização = revisão estratégica da
 * conta, registrada mesmo quando nenhuma alteração foi necessária (ver
 * `lib/account-reviews.ts`). Mesma anatomia de sempre (data/hora, resumo,
 * gestor, indicador de Atualização para o Cliente, indicador de abrir).
 *
 * MITZA Unified Activities 1.0: extraída do antigo `AccountReviewsSection`
 * (cabeçalho "Revisões de conta" + esta lista, lado a lado com "Tarefas")
 * pra ser reaproveitada dentro da fila única "Atividades"
 * (`activity-section.tsx`), junto com `TaskRow`. Nenhum dado, ação ou
 * histórico mudou — só deixou de existir dentro de uma seção própria com
 * cabeçalho e estado vazio duplicados.
 */
export function AccountReviewRow({
  review,
  detailHref,
  typeLabel,
}: {
  review: AccountReviewSummaryItem;
  detailHref: string;
  /** MITZA Unified Activities 1.0 — rótulo discreto de tipo ("Revisão de
   * conta"), visível só em telas largas (`lg:`) — mesmo padrão de `TaskRow`.
   * Desambigua a linha dentro da fila única, onde tarefa e revisão
   * convivem na mesma lista. */
  typeLabel?: string;
}) {
  return (
    <li className="flex min-h-[28px] items-center border-b border-border/60 px-2 py-1 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <Link href={detailHref} scroll={false} className="flex items-center gap-2.5">
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

        {typeLabel && (
          <span className="hidden w-24 shrink-0 truncate text-[10px] uppercase tracking-wide text-muted-foreground lg:block">
            {typeLabel}
          </span>
        )}

        <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
