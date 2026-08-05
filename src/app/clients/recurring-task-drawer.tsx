import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { formatDateTime } from "@/lib/format";
import { formatPreviousWeekMissingLine, OPTIMIZATION_QUICK_GROUPS } from "@/lib/recurring-tasks";
import { RegisterExecutionForm } from "./register-execution-form";
import type { RecurringTaskDetail, RecurringTaskExecutionDetail } from "@/lib/recurring-task-data";

const QUICK_ACTION_BY_COMBO = new Map(
  OPTIMIZATION_QUICK_GROUPS.flatMap((group) => group.actions.map((action) => [`${action.type}:${action.action}`, action])),
);

/**
 * Drawer de UMA recorrência (Reformulação do sistema de tarefas, 28/07) —
 * resumo operacional ("Esta semana"/"Próxima execução"/"Semana anterior") +
 * "Execuções desta semana" + "Histórico" + "Registrar nova execução".
 * `usesAccountReview=true` (hoje só Otimização) troca o checklist genérico
 * pelo registro rápido por chips (`OptimizationQuickPicker`); com checklist
 * genérico mas sem essa integração, mostra os checkboxes configurados; sem
 * nenhum dos dois (Checar saldo/Reportar cliente), é só a observação —
 * mesmo formulário, mesma action (`registerRecurringExecutionAction`).
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
  reportHref,
}: {
  detail: RecurringTaskDetail;
  clientId: string;
  closeHref: string;
  /** Href pronto pra abrir o wizard de Reports com cliente e período
   * (sprint em que o drawer foi aberto) já resolvidos — só relevante
   * quando `detail.usesReport` é true (ver `page.tsx`). */
  reportHref: string | null;
}) {
  const { weekProgress, previousWeek } = detail;
  const weekCountLabel =
    weekProgress.goal === null ? `${weekProgress.done} execuções realizadas` : `${weekProgress.done}/${weekProgress.goal} execuções realizadas`;
  const showPreviousWeek = previousWeek !== null && previousWeek.progress.goal !== null;
  const previousWeekCountLabel = showPreviousWeek ? `${previousWeek!.progress.done}/${previousWeek!.progress.goal} execuções realizadas` : null;

  const checklistLabelByKey = new Map(detail.checklistItems.map((item) => [item.key, item.label]));

  function renderExecutionRow(execution: RecurringTaskExecutionDetail, dense: boolean) {
    const checkedLabels = (execution.checklistSelectedKeys ?? []).map((key) => checklistLabelByKey.get(key) ?? key);
    const optimizationChips = (execution.optimizationSelections ?? []).map((selection) => {
      const quickAction = QUICK_ACTION_BY_COMBO.get(`${selection.type}:${selection.action}`);
      const label = quickAction ? `${quickAction.icon} ${quickAction.label}` : `${selection.type} ${selection.action}`;
      return selection.quantity > 1 ? `${label} ×${selection.quantity}` : label;
    });
    return (
      <li key={execution.id} className={dense ? "text-sm text-foreground" : "rounded-md border border-border p-2 text-sm"}>
        <p className={dense ? undefined : "text-foreground"}>
          <span className="font-medium">{formatDateTime(execution.executedAt)}</span>
          <span className="text-muted-foreground"> · {execution.authorName}</span>
        </p>
        {(checkedLabels.length > 0 || optimizationChips.length > 0) && (
          <p className="mt-0.5 flex flex-wrap gap-1">
            {checkedLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand"
              >
                ✓ {label}
              </span>
            ))}
            {optimizationChips.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand"
              >
                {chip}
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
          <SectionHeader>{detail.usesReport ? "Gerar report" : "Registrar nova execução"}</SectionHeader>
          {detail.usesReport ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                Esta recorrência é atendida gerando o report do cliente — salvar o report registra a execução
                automaticamente, sem precisar de um passo separado.
              </p>
              {reportHref && (
                <Link
                  href={reportHref}
                  scroll={false}
                  className="mitza-pressable self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
                >
                  Gerar report
                </Link>
              )}
            </div>
          ) : (
            <RegisterExecutionForm
              recurringTaskId={detail.id}
              clientId={clientId}
              closeHref={closeHref}
              usesAccountReview={detail.usesAccountReview}
              checklistItems={detail.checklistItems}
            />
          )}
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
