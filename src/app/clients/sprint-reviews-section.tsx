import { SectionHeader } from "@/components/ui/section-header";
import { AccountReviewRow, type AccountReviewSummaryItem } from "./account-reviews-section";
import {
  ACTIVITY_COL_ACTIONS,
  ACTIVITY_COL_ASSIGNEE,
  ACTIVITY_COL_DATE,
  ACTIVITY_COL_STATUS,
  ACTIVITY_COL_TYPE,
} from "./activity-columns";

/**
 * "Otimizações" da sprint — Etapa "Tarefas e Sprints separadas": a sprint
 * deixou de ser onde o gestor gerencia tarefas (ver `MonthTasksPanel`), mas
 * continua sendo o registro de otimizações/revisões de conta do período —
 * isso nunca foi tarefa, é histórico de análise. Extraído de
 * `ActivitySection` (que unificava tarefa + revisão numa fila só): aqui só
 * a metade "revisão" sobrevive, reaproveitando o mesmo `AccountReviewRow` e
 * a mesma grade de colunas, sem nenhum dado ou lógica nova.
 *
 * Só usado pela página do cliente (via `hideTaskList` em `SprintCardBody`)
 * — a tela Sprints (`/sprints`) continua com `ActivitySection` de sempre,
 * tarefas e revisões juntas, comportamento inalterado.
 */
export function SprintReviewsSection({
  reviews,
  reviewHrefPrefix,
}: {
  reviews: AccountReviewSummaryItem[];
  reviewHrefPrefix?: string;
}) {
  return (
    <div>
      <SectionHeader
        action={
          reviews.length > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {reviews.length} {reviews.length === 1 ? "otimização" : "otimizações"}
            </span>
          ) : undefined
        }
      >
        Otimizações
      </SectionHeader>

      <div className="mt-1.5 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2.5 border-b border-border bg-zinc-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/40">
          <span className={`${ACTIVITY_COL_STATUS} truncate`} aria-hidden="true" />
          <span className={ACTIVITY_COL_DATE}>Data</span>
          <span className="min-w-0 flex-1">Resumo</span>
          <span className={ACTIVITY_COL_ASSIGNEE}>Responsável</span>
          <span className={ACTIVITY_COL_TYPE} aria-hidden="true" />
          <span className={ACTIVITY_COL_ACTIONS} aria-hidden="true" />
        </div>

        <ul className="[&>li:last-child]:border-0">
          {reviews.length > 0 ? (
            reviews.map((review) => (
              <AccountReviewRow
                key={review.id}
                review={review}
                detailHref={`${reviewHrefPrefix}${review.id}`}
              />
            ))
          ) : (
            <li className="flex min-h-[28px] items-center px-2 py-1 text-xs text-muted-foreground">
              Nenhuma otimização registrada nesta sprint.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
