import Link from "next/link";
import { User } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL } from "@/lib/account-reviews";
import { CLIENT_UPDATE_STATUS_LABEL, type ClientUpdateStatus } from "@/lib/client-updates";
import type { AccountReviewOutcome, AccountReviewReason } from "@/lib/supabase/database.types";
import {
  ACTIVITY_COL_ACTIONS,
  ACTIVITY_COL_ASSIGNEE,
  ACTIVITY_COL_DATE,
  ACTIVITY_COL_STATUS,
  ACTIVITY_COL_TYPE,
} from "./activity-columns";

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
 *
 * Etapa "Padronizar e destacar criação de Atividades": esta linha passou a
 * usar a MESMA grade de colunas de `TaskRow` (`./activity-columns.ts`) —
 * antes começava direto na coluna de data (sem reservar a coluna de
 * status), então a coluna "Atividade" de uma revisão começava num X
 * horizontal diferente do de uma tarefa na mesma lista. Revisão não tem um
 * "status" acionável (nunca pendente/concluída, é sempre um registro
 * histórico fechado), então a coluna de status aqui é só um espaçador
 * neutro — reserva a largura, sem fingir um estado que não existe. O
 * indicador de "Atualização para o Cliente" (`updateStatus`), que antes
 * era um irmão flex à parte entre responsável e tipo (deslocando as
 * colunas seguintes quando presente/ausente), passou a viver DENTRO da
 * célula de atividade (depois do resumo) — ela é `flex-1` e absorve
 * largura variável sem empurrar nenhuma coluna de largura fixa depois
 * dela.
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
      <Link href={detailHref} scroll={false} className="flex w-full items-center gap-2.5">
        <span className={ACTIVITY_COL_STATUS} aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </span>

        <span className={ACTIVITY_COL_DATE}>{formatDateTime(review.reviewedAt)}</span>

        <span className="min-w-0 flex-1 truncate text-sm">
          <span className={`font-medium ${OUTCOME_TEXT_CLASSES[review.outcome]}`}>
            {ACCOUNT_REVIEW_OUTCOME_LABEL[review.outcome]}
          </span>
          {reviewSubtitle(review) && (
            <span className="truncate text-xs text-muted-foreground"> · {reviewSubtitle(review)}</span>
          )}
          {review.updateStatus !== "none" && (
            <span className="truncate text-xs text-muted-foreground"> · {CLIENT_UPDATE_STATUS_LABEL[review.updateStatus]}</span>
          )}
        </span>

        <span className={ACTIVITY_COL_ASSIGNEE}>
          <User className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs text-muted-foreground">{review.managerName}</span>
        </span>

        {typeLabel && (
          <span className={ACTIVITY_COL_TYPE}>
            <span className="inline-flex max-w-full items-center truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-zinc-800">
              {typeLabel}
            </span>
          </span>
        )}

        <span className={ACTIVITY_COL_ACTIONS}>
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            ›
          </span>
        </span>
      </Link>
    </li>
  );
}
