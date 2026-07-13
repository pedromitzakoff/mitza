import Link from "next/link";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import { CLIENT_UPDATE_STATUS_LABEL, type ClientUpdateStatus } from "@/lib/client-updates";
import type { AccountReviewCadenceStatus } from "@/lib/account-review-cadence";
import type { OperationalTrackingRow } from "@/lib/operational-tracking";
import { completeTaskAction, markTaskNotDoneAction } from "./tasks-actions";
import { todayDateString } from "@/lib/today";
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

const TRACKED_TYPE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Próxima reunião",
  entrega_criativo: "Próxima entrega",
};

const TRACKED_TYPE_EMPTY_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Nenhuma reunião agendada",
  entrega_criativo: "Nenhuma entrega agendada",
};

const TRACKED_TYPE_SCHEDULE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Agendar reunião",
  entrega_criativo: "Agendar entrega",
};

/**
 * Célula de reunião/entrega dentro do Acompanhamento da Conta — reaproveita
 * `computeOperationalTracking` (já existia, movida pra cá de "Rotina do
 * Cliente", que deixou de existir como bloco separado). Os 5 estados do
 * pedido (sem agendamento / agendada / data chegou / realizada / não
 * realizada) mapeiam direto pro que já existe em `tasks`:
 * - "agendar"/"reagendar" = createTaskAction/updateTaskAction (já existem);
 * - "marcar como realizada" = completeTaskAction (já existe, já emite
 *   meeting_completed/creative_delivery_completed);
 * - "marcar como não realizada" = markTaskNotDoneAction (novo, mesma
 *   transação atômica, emite meeting_cancelled/creative_delivery_late).
 * Nunca sobrescreve a ocorrência anterior: "agendar próxima" é sempre uma
 * tarefa NOVA (createTaskAction), a anterior já resolvida permanece no
 * histórico de tarefas do cliente.
 */
function TrackedOccurrenceCell({
  row,
  clientId,
  returnTo,
}: {
  row: OperationalTrackingRow;
  clientId: string;
  returnTo: string;
}) {
  const scheduleHref = `/clients/${clientId}/tasks/new?type=${row.type}&return_to=${encodeURIComponent(returnTo)}`;

  if (row.nextTaskId === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {TRACKED_TYPE_LABEL[row.type]}
        </p>
        <p className="text-sm text-muted-foreground">{TRACKED_TYPE_EMPTY_LABEL[row.type]}</p>
        <Link href={scheduleHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
          {TRACKED_TYPE_SCHEDULE_LABEL[row.type]}
        </Link>
      </div>
    );
  }

  const isDue = row.nextIsOverdue || (row.nextDueDate !== null && row.nextDueDate <= todayDateString());
  const editHref = `/clients/${clientId}/tasks/${row.nextTaskId}/edit?return_to=${encodeURIComponent(returnTo)}`;

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {TRACKED_TYPE_LABEL[row.type]}
      </p>
      <p className={`text-sm ${row.nextIsOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-foreground"}`}>
        {row.nextDueDate ? formatShortDate(row.nextDueDate) : "—"}
        {row.nextIsOverdue ? " · atrasada" : " · agendada"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={editHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
          Editar/Reagendar
        </Link>
        {isDue && (
          <>
            <form action={completeTaskAction.bind(null, row.nextTaskId, clientId)}>
              <button type="submit" className="text-xs font-medium text-brand hover:underline">
                Marcar como realizada
              </button>
            </form>
            <form action={markTaskNotDoneAction.bind(null, row.nextTaskId, clientId)}>
              <button type="submit" className="text-xs font-medium text-muted-foreground hover:underline">
                Marcar como não realizada
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "ACOMPANHAMENTO DA CONTA" — principal bloco operacional da página do
 * cliente. Absorve reuniões e entregas de criativo (que antes viviam num
 * bloco separado, "Rotina do cliente", removido da interface — os dados,
 * tabela e lógica de `tasks`/`computeOperationalTracking` continuam
 * exatamente os mesmos, só a apresentação muda). "Cadência" e "Intervalo
 * atual" foram removidos da interface por pedido explícito (funcionalidade
 * ainda não bem definida operacionalmente) — `account_review_cadences` e
 * `computeAccountReviewCadenceStatus` continuam existindo por baixo,
 * intactos, só não são mais exibidos aqui; podem voltar futuramente sem
 * nenhuma alteração de schema.
 */
export function AccountFollowUpPanel({
  status,
  today,
  recentReviews,
  hasMoreReviews,
  newReviewHref,
  historyHref,
  buildReviewDetailHref,
  tracking,
  clientId,
  returnTo,
}: {
  status: AccountReviewCadenceStatus;
  today: Date;
  recentReviews: AccountReviewPreviewItem[];
  hasMoreReviews: boolean;
  newReviewHref: string;
  historyHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
  tracking: Record<"reuniao" | "entrega_criativo", OperationalTrackingRow>;
  clientId: string;
  returnTo: string;
}) {
  const lastReviewLabel =
    status.lastReviewedAt === null
      ? "Sem análise registrada"
      : formatLastOptimizationLabel(status.lastReviewedAt.slice(0, 10), today);

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

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Última análise</p>
          <p className="text-sm text-foreground">{lastReviewLabel}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Última otimização</p>
          <p className="text-sm text-foreground">{lastOptimizationLabel}</p>
        </div>
        <TrackedOccurrenceCell row={tracking.reuniao} clientId={clientId} returnTo={returnTo} />
        <TrackedOccurrenceCell row={tracking.entrega_criativo} clientId={clientId} returnTo={returnTo} />
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
