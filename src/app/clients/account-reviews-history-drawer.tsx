import Link from "next/link";
import { ReviewPreviewRow, type AccountReviewPreviewItem } from "./account-follow-up-panel";

/**
 * "Ver histórico" do Acompanhamento da Conta (Etapa 58) — mesmo padrão de
 * drawer usado em MonthlyBudgetHistoryDrawer/TaskDrawerPanel (link
 * fixed-overlay + painel fixo, aberto via query param). Reaproveita a mesma
 * lista `accountReviews` de 60 dias já buscada na página do cliente — nenhuma
 * query nova só para esta tela.
 */
export function AccountReviewsHistoryDrawer({
  reviews,
  buildReviewDetailHref,
  closeHref,
}: {
  reviews: AccountReviewPreviewItem[];
  buildReviewDetailHref: (reviewId: string) => string;
  closeHref: string;
}) {
  return (
    <>
      <Link href={closeHref} scroll={false} className="fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Histórico de análises da conta</h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        {reviews.length > 0 ? (
          <ul className="mt-3 flex flex-col">
            {reviews.map((review) => (
              <ReviewPreviewRow key={review.id} review={review} detailHref={buildReviewDetailHref(review.id)} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma análise registrada nos últimos 60 dias.</p>
        )}
      </div>
    </>
  );
}
