import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { formatDateTime } from "@/lib/format";
import { formatPreviousWeekMissingLine } from "@/lib/recurring-tasks";
import { SubmitButton } from "@/app/submit-button";
import { registerRecurringExecutionAction } from "./recurring-task-actions";
import type { RecurringTaskDetail, RecurringTaskExecutionDetail } from "@/lib/recurring-task-data";

/**
 * Drawer de UMA recorrência (Reformulação do sistema de tarefas, 28/07) —
 * resumo operacional ("Esta semana"/"Próxima execução"/"Semana anterior") +
 * "Execuções desta semana" + "Histórico" + "Registrar nova execução". Quando
 * `hasChecklist` é true (hoje só Otimização — mas a UI não sabe disso, é
 * dado, não código), o formulário de registro ganha os checkboxes
 * configurados, além da observação; sem checklist (Checar saldo/Reportar
 * cliente), é só a observação — mesmo formulário, mesma action
 * (`registerRecurringExecutionAction`).
 *
 * Etapa "Simplificar linha das recorrentes": o contexto histórico (pendência
 * da sprint anterior) que antes aparecia na própria linha, competindo com a
 * informação de agora, mudou pra cá — é a única leitura de "Semana
 * anterior" no produto. Sem alerta vermelho mesmo quando pendente: é
 * contexto, não uma cobrança — a linha "X execução(ões) não realizada(s)"
 * some sozinha quando a semana anterior foi cumprida.
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
  const { weekProgress, previousWeek } = detail;
  const weekCountLabel =
    weekProgress.goal === null ? `${weekProgress.done} execuções realizadas` : `${weekProgress.done}/${weekProgress.goal} execuções realizadas`;
  const showPreviousWeek = previousWeek !== null && previousWeek.progress.goal !== null;
  const previousWeekCountLabel = showPreviousWeek ? `${previousWeek!.progress.done}/${previousWeek!.progress.goal} execuções realizadas` : null;

  const checklistLabelByKey = new Map(detail.checklistItems.map((item) => [item.key, item.label]));

  function renderExecutionRow(execution: RecurringTaskExecutionDetail, dense: boolean) {
    const checkedLabels = (execution.checklistSelectedKeys ?? []).map((key) => checklistLabelByKey.get(key) ?? key);
    return (
      <li key={execution.id} className={dense ? "text-sm text-foreground" : "rounded-md border border-border p-2 text-sm"}>
        <p className={dense ? undefined : "text-foreground"}>
          <span className="font-medium">{formatDateTime(execution.executedAt)}</span>
          <span className="text-muted-foreground"> · {execution.authorName}</span>
        </p>
        {checkedLabels.length > 0 && (
          <p className="mt-0.5 flex flex-wrap gap-1">
            {checkedLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand"
              >
                ✓ {label}
              </span>
            ))}
          </p>
        )}
        {execution.notes && <p className="mt-0.5 text-xs text-muted-foreground">{execution.notes}</p>}
      </li>
    );
  }

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

        <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-zinc-50 p-3 dark:bg-zinc-900/40 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Esta semana</p>
            <p className="mt-0.5 text-sm text-foreground">{weekCountLabel}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Próxima execução</p>
            <p className="mt-0.5 text-sm text-foreground">{detail.nextExecutionLabel}</p>
          </div>
          {showPreviousWeek && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Semana anterior</p>
              <p className="mt-0.5 text-sm text-foreground">{previousWeekCountLabel}</p>
              {previousWeek!.pending?.isPending && (
                <p className="mt-0.5 text-xs text-muted-foreground">{formatPreviousWeekMissingLine(previousWeek!.pending)}</p>
              )}
            </div>
          )}
        </div>

        <section className="mt-4 border-t border-border pt-4">
          <SectionHeader>Registrar nova execução</SectionHeader>
          <form action={registerRecurringExecutionAction.bind(null, detail.id, clientId, closeHref)} className="mt-2 flex flex-col gap-2">
            {detail.checklistItems.length > 0 && (
              <div className="flex flex-col gap-1">
                {detail.checklistItems.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" name="checklist_items" value={item.key} className="h-3.5 w-3.5 rounded border-border" />
                    {item.label}
                  </label>
                ))}
              </div>
            )}
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
            <ul className="mt-2 flex flex-col gap-1.5">{detail.weekExecutions.map((execution) => renderExecutionRow(execution, true))}</ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma execução registrada nesta semana ainda.</p>
          )}
        </section>

        <section className="mt-4 border-t border-border pt-4">
          <SectionHeader>Histórico</SectionHeader>
          {detail.history.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">{detail.history.map((execution) => renderExecutionRow(execution, false))}</ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>
          )}
        </section>
      </div>
    </>
  );
}
