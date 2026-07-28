import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/app/submit-button";
import { registerRecurringExecutionAction } from "./recurring-task-actions";
import type { RecurringTaskDetail } from "@/lib/recurring-task-data";

/**
 * Drawer de UMA recorrência (Reformulação do sistema de tarefas, 28/07) —
 * "Execuções desta semana" + "Histórico" + "Registrar nova execução",
 * exatamente os 3 blocos pedidos. Ainda genérico (sem o checklist especial
 * de Otimização — próxima fase): registrar aqui é só uma observação livre,
 * o suficiente pra Checar saldo/Reportar cliente.
 */
export function RecurringTaskDrawer({
  detail,
  clientId,
  closeHref,
}: {
  detail: RecurringTaskDetail;
  clientId: string;
  closeHref: string;
}) {
  const { weekProgress } = detail;
  const countLabel =
    weekProgress.goal === null
      ? `${weekProgress.done} execuções nesta semana`
      : `${weekProgress.done}/${weekProgress.goal} execuções nesta semana`;

  return (
    <>
      <Link href={closeHref} scroll={false} className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30" aria-label="Fechar" />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <span aria-hidden="true">{detail.icon}</span>
            {detail.title}
          </h2>
          <Link
            href={closeHref}
            scroll={false}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Fechar
          </Link>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">{countLabel}</p>

        <section className="mt-4 border-t border-border pt-4">
          <SectionHeader>Registrar nova execução</SectionHeader>
          <form action={registerRecurringExecutionAction.bind(null, detail.id, clientId, closeHref)} className="mt-2 flex flex-col gap-2">
            <textarea
              name="notes"
              rows={2}
              placeholder="Observações (opcional)"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <SubmitButton
              pendingChildren="Registrando..."
              className="self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
            >
              Registrar execução
            </SubmitButton>
          </form>
        </section>

        <section className="mt-4 border-t border-border pt-4">
          <SectionHeader>Execuções desta semana</SectionHeader>
          {detail.weekExecutions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {detail.weekExecutions.map((execution) => (
                <li key={execution.id} className="text-sm text-foreground">
                  <span className="font-medium">{formatDateTime(execution.executedAt)}</span>
                  <span className="text-muted-foreground"> · {execution.authorName}</span>
                  {execution.notes && <p className="mt-0.5 text-xs text-muted-foreground">{execution.notes}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma execução registrada nesta semana ainda.</p>
          )}
        </section>

        <section className="mt-4 border-t border-border pt-4">
          <SectionHeader>Histórico</SectionHeader>
          {detail.history.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {detail.history.map((execution) => (
                <li key={execution.id} className="rounded-md border border-border p-2 text-sm">
                  <p className="text-foreground">
                    <span className="font-medium">{formatDateTime(execution.executedAt)}</span>
                    <span className="text-muted-foreground"> · {execution.authorName}</span>
                  </p>
                  {execution.notes && <p className="mt-0.5 text-xs text-muted-foreground">{execution.notes}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>
          )}
        </section>
      </div>
    </>
  );
}
