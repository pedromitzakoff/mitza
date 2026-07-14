import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { formatDelay } from "@/lib/operational-events";
import {
  ACCOUNT_REVIEW_OUTCOME_LABEL,
  ACCOUNT_REVIEW_REASON_LABEL,
  OPTIMIZATION_ACTION_LABEL,
  OPTIMIZATION_TYPE_LABEL,
} from "@/lib/account-reviews";
import type { AccountReviewOutcome, AccountReviewReason, OptimizationType } from "@/lib/supabase/database.types";
import { generateClientUpdateAction } from "./client-update-actions";
import { ClientUpdateEditor } from "./client-update-editor";

export interface ClientUpdateDetail {
  id: string;
  content: string;
  sentAt: string | null;
  sentByName: string | null;
}

export interface AccountOptimizationDetail {
  id: string;
  type: OptimizationType;
  action: string;
  description: string | null;
  reason: string | null;
  expectedImpact: string | null;
}

export interface AccountReviewDetail {
  id: string;
  reviewedAt: string;
  managerName: string;
  reason: AccountReviewReason;
  reasonOtherDescription: string | null;
  outcome: AccountReviewOutcome;
  notes: string | null;
  issueDescription: string | null;
  issueCategory: string | null;
  issueTaskTitle: string | null;
  secondsSincePreviousReview: number | null;
  optimizations: AccountOptimizationDetail[];
  clientUpdate: ClientUpdateDetail | null;
}

function reasonLabel(review: AccountReviewDetail): string {
  if (review.reason === "OTHER" && review.reasonOtherDescription) {
    return `Outro — ${review.reasonOtherDescription}`;
  }
  return ACCOUNT_REVIEW_REASON_LABEL[review.reason];
}

/**
 * Drawer de LEITURA (Etapa 57, seção 22/23) — nunca mostra JSON bruto nem
 * IDs técnicos, só os campos já resolvidos em linguagem simples.
 */
export function AccountReviewDetailDrawer({
  review,
  clientId,
  closeHref,
}: {
  review: AccountReviewDetail;
  clientId: string;
  closeHref: string;
}) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Otimização</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Data e hora</dt>
            <dd className="font-medium text-foreground">{formatDateTime(review.reviewedAt)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Gestor</dt>
            <dd className="font-medium text-foreground">{review.managerName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Motivo</dt>
            <dd className="text-right font-medium text-foreground">{reasonLabel(review)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Resultado</dt>
            <dd className="font-medium text-foreground">{ACCOUNT_REVIEW_OUTCOME_LABEL[review.outcome]}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Tempo desde a otimização anterior</dt>
            <dd className="font-medium text-foreground">
              {review.secondsSincePreviousReview === null ? "Primeira otimização" : formatDelay(review.secondsSincePreviousReview)}
            </dd>
          </div>
        </dl>

        {review.optimizations.length > 0 && (
          <section className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Alterações realizadas
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {review.optimizations.map((opt) => (
                <li key={opt.id} className="rounded-md border border-border p-2.5 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {OPTIMIZATION_TYPE_LABEL[opt.type]}
                  </p>
                  <p className="mt-1 text-foreground">
                    <span className="text-muted-foreground">Ação: </span>
                    {OPTIMIZATION_ACTION_LABEL[opt.action] ?? opt.action}
                  </p>
                  {opt.description && (
                    <p className="mt-0.5 text-foreground">
                      <span className="text-muted-foreground">Descrição: </span>
                      {opt.description}
                    </p>
                  )}
                  {opt.reason && (
                    <p className="mt-0.5 text-foreground">
                      <span className="text-muted-foreground">Motivo: </span>
                      {opt.reason}
                    </p>
                  )}
                  {opt.expectedImpact && (
                    <p className="mt-0.5 text-foreground">
                      <span className="text-muted-foreground">Resultado esperado: </span>
                      {opt.expectedImpact}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {review.outcome === "ISSUE_IDENTIFIED" && (
          <section className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Problema identificado</h3>
            <p className="mt-2 text-sm text-foreground">{review.issueDescription}</p>
            {review.issueCategory && <p className="mt-1 text-xs text-muted-foreground">Categoria: {review.issueCategory}</p>}
            {review.issueTaskTitle && (
              <p className="mt-1 text-xs text-muted-foreground">Tarefa criada: {review.issueTaskTitle}</p>
            )}
          </section>
        )}

        {review.notes && (
          <section className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observações</h3>
            <p className="mt-2 text-sm text-foreground">{review.notes}</p>
          </section>
        )}

        <section className="mt-4 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Atualização para o cliente
          </h3>
          {review.clientUpdate ? (
            <ClientUpdateEditor
              clientUpdateId={review.clientUpdate.id}
              clientId={clientId}
              initialContent={review.clientUpdate.content}
              initialSentAt={review.clientUpdate.sentAt}
              initialSentByName={review.clientUpdate.sentByName}
            />
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Transforme esta otimização em uma atualização pronta para enviar ao cliente.
              </p>
              <form
                action={generateClientUpdateAction.bind(
                  null,
                  review.id,
                  `${closeHref}${closeHref.includes("?") ? "&" : "?"}reviewDetail=${review.id}`,
                )}
              >
                <button
                  type="submit"
                  className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
                >
                  Gerar atualização
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
