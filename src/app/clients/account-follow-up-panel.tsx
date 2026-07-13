import Link from "next/link";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import { CLIENT_UPDATE_STATUS_LABEL, type ClientUpdateStatus } from "@/lib/client-updates";
import type { AccountReviewCadenceStatus } from "@/lib/account-review-cadence";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";

export interface AccountReviewPreviewItem {
  id: string;
  reviewedAt: string;
  managerName: string;
  outcome: AccountReviewOutcome;
  optimizationTypes: OptimizationType[];
  summaryText: string | null;
  /** Etapa 59 — indicador discreto de Atualização para o Cliente (seção 14
   * do pedido); "none" não é mostrado. */
  updateStatus: ClientUpdateStatus;
}

const OUTCOME_TEXT_CLASSES: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "text-muted-foreground",
  OPTIMIZATION_PERFORMED: "text-emerald-600 dark:text-emerald-400",
  ISSUE_IDENTIFIED: "text-amber-600 dark:text-amber-400",
};

/** Linha compacta de uma análise — reaproveitada tanto no preview das 2 mais
 * recentes (AccountFollowUpPanel) quanto no histórico completo
 * (AccountReviewsHistoryDrawer), pra não duplicar a marcação. */
export function ReviewPreviewRow({
  review,
  detailHref,
}: {
  review: AccountReviewPreviewItem;
  detailHref: string;
}) {
  return (
    <li className="border-t border-border py-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatDateTime(review.reviewedAt)}</span>
        <span>{review.managerName}</span>
      </div>
      <p className={`mt-0.5 text-sm font-medium ${OUTCOME_TEXT_CLASSES[review.outcome]}`}>
        {ACCOUNT_REVIEW_OUTCOME_LABEL[review.outcome]}
      </p>
      {review.optimizationTypes.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {review.optimizationTypes.map((type) => OPTIMIZATION_TYPE_LABEL[type]).join(" · ")}
        </p>
      )}
      {review.summaryText && <p className="mt-0.5 truncate text-xs text-muted-foreground">{review.summaryText}</p>}
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <Link href={detailHref} scroll={false} className="inline-block text-xs font-medium text-brand hover:underline">
          Ver análise
        </Link>
        {review.updateStatus !== "none" && (
          <span className="text-[11px] text-muted-foreground">{CLIENT_UPDATE_STATUS_LABEL[review.updateStatus]}</span>
        )}
      </div>
    </li>
  );
}

/**
 * "ACOMPANHAMENTO DA CONTA" (Etapa 58) — renomeado só na UI a partir de
 * "Análises da conta"/`AccountReviewCadencePanel` (as tabelas `account_reviews`
 * etc. continuam com o mesmo nome no banco). Vira o bloco operacional
 * principal da página: resumo de cadência (mesma lógica pura de
 * `computeAccountReviewCadenceStatus`, sem nenhum cálculo novo aqui) + as 2
 * análises mais recentes (já vêm prontas de `accountReviews.slice(0, 2)` na
 * página, nenhuma query nova) + CTA principal "+ Registrar análise", que
 * antes só existia dentro do card da Sprint.
 */
export function AccountFollowUpPanel({
  status,
  today,
  recentReviews,
  hasMoreReviews,
  newReviewHref,
  historyHref,
  buildReviewDetailHref,
  cadenceConfigHref,
  isAdmin,
}: {
  status: AccountReviewCadenceStatus;
  today: Date;
  recentReviews: AccountReviewPreviewItem[];
  hasMoreReviews: boolean;
  newReviewHref: string;
  historyHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
  cadenceConfigHref: string;
  isAdmin: boolean;
}) {
  const lastReviewLabel =
    status.lastReviewedAt === null
      ? "Sem análise registrada"
      : formatLastOptimizationLabel(status.lastReviewedAt.slice(0, 10), today);

  const cadenceStateLabel =
    status.cadenceGoal === null
      ? null
      : status.cadenceMet
        ? "Em dia"
        : status.reviewsThisWeek === 0
          ? "Em risco"
          : "Atenção";

  const cadenceLabel =
    status.cadenceGoal === null
      ? "Sem cadência configurada"
      : `${status.reviewsThisWeek} de ${status.cadenceGoal} nesta semana${cadenceStateLabel ? ` · ${cadenceStateLabel}` : ""}`;

  const intervalLabel =
    status.daysSinceLastReview === null
      ? "Sem análise registrada"
      : status.daysSinceLastReview === 0
        ? "Analisada hoje"
        : `${status.daysSinceLastReview} ${status.daysSinceLastReview === 1 ? "dia útil" : "dias úteis"} sem análise`;

  const lastOptimizationLabel =
    status.lastOptimizationType === null
      ? "Nenhuma otimização registrada"
      : `${OPTIMIZATION_TYPE_LABEL[status.lastOptimizationType]} · ${formatShortDate(status.lastOptimizationAt!.slice(0, 10))}`;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h2 className="text-sm font-medium text-foreground">Acompanhamento da conta</h2>
        <div className="flex items-center gap-3">
          {hasMoreReviews && (
            <Link href={historyHref} className="text-xs font-medium text-foreground hover:underline">
              Ver histórico
            </Link>
          )}
          <Link
            href={newReviewHref}
            scroll={false}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover"
          >
            + Registrar análise
          </Link>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Última análise</p>
          <p className="text-sm text-foreground">{lastReviewLabel}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cadência</p>
          <p
            className={`text-sm ${status.cadenceMet === false ? "font-medium text-amber-600 dark:text-amber-400" : "text-foreground"}`}
          >
            {cadenceLabel}
          </p>
          {status.cadenceGoal === null && isAdmin && (
            <Link href={cadenceConfigHref} className="text-[11px] font-medium text-brand hover:underline">
              Configurar
            </Link>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Intervalo atual</p>
          <p className={`text-sm ${status.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-foreground"}`}>
            {intervalLabel}
          </p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Última otimização</p>
          <p className="text-sm text-foreground">{lastOptimizationLabel}</p>
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-1.5">
        {recentReviews.length > 0 ? (
          <ul className="flex flex-col">
            {recentReviews.map((review) => (
              <ReviewPreviewRow key={review.id} review={review} detailHref={buildReviewDetailHref(review.id)} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <p className="text-sm text-muted-foreground">
              Nenhuma análise registrada. Registre uma análise após avaliar a conta, tomar uma decisão ou realizar uma
              otimização.
            </p>
            <Link
              href={newReviewHref}
              scroll={false}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              Registrar primeira análise
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
