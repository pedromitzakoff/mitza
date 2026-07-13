import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { formatShortDate } from "@/lib/format";
import { OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import type { AccountReviewCadenceStatus } from "@/lib/account-review-cadence";

/**
 * Substitui a antiga informação fixa de "Otimização" no Acompanhamento
 * operacional (Etapa 57, seção 28) — compacto, 5 datapoints, sem cards
 * grandes: Última análise / Cadência / Intervalo atual / Última otimização /
 * Próximo limite.
 */
export function AccountReviewCadencePanel({ status, today }: { status: AccountReviewCadenceStatus; today: Date }) {
  const lastReviewLabel =
    status.lastReviewedAt === null ? "Sem registro" : formatLastOptimizationLabel(status.lastReviewedAt.slice(0, 10), today);

  const cadenceLabel =
    status.cadenceGoal === null
      ? "Sem cadência configurada"
      : `${status.reviewsThisWeek} de ${status.cadenceGoal} nesta semana`;

  const intervalLabel =
    status.daysSinceLastReview === null
      ? "—"
      : status.daysSinceLastReview === 0
        ? "Analisada hoje"
        : `${status.daysSinceLastReview} ${status.daysSinceLastReview === 1 ? "dia útil" : "dias úteis"} sem análise`;

  const lastOptimizationLabel =
    status.lastOptimizationType === null
      ? "Sem registro"
      : `${OPTIMIZATION_TYPE_LABEL[status.lastOptimizationType]} · ${formatShortDate(status.lastOptimizationAt!.slice(0, 10))}`;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Análises da conta</h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Última análise</p>
          <p className="text-sm text-foreground">{lastReviewLabel}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cadência</p>
          <p className={`text-sm ${status.cadenceMet === false ? "font-medium text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {cadenceLabel}
          </p>
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
        {status.nextLimitDate && (
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Próximo limite</p>
            <p className={`text-sm ${status.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-foreground"}`}>
              Analisar até {formatShortDate(status.nextLimitDate)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
