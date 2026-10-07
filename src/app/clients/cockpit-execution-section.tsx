import Link from "next/link";
import { formatDueDate } from "@/lib/format";
import { TASK_PRIORITY_DOT_CLASS } from "./task-labels";
import { CockpitCompleteTaskButton } from "./cockpit-complete-task-button";
import type { PendenciaItem } from "@/lib/pendencias";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Execução" (pedido,
 * seções 21-25) — aproxima Operação e Demandas CONCEITUALMENTE (só
 * composição de UI, nenhuma tabela/domínio renomeado): "O que estamos
 * fazendo nessa conta?" / "O que está pendente?".
 *
 * Operação: sprint atual + última otimização (MESMOS dados que o Dashboard
 * já mostrava antes desta fase — `currentSprintLabel`/`lastOptimizationLabel`,
 * resolvidos em `[id]/page.tsx`, nenhum cálculo novo) + CTA "Registrar
 * revisão" (abre `RecordAccountReviewDrawer` já oficial via `?review=new`,
 * renderizado por quem chama esta seção — este componente só monta o link).
 *
 * Demandas: contagem aberta/atrasada + até 3 mais urgentes (MESMA fonte de
 * sempre, `loadPendenciasRawData`/`countOpenDemandas`) com "Concluir" inline
 * (`completeTaskAction`, a mesma Server Action da Demandas completa) —
 * deliberadamente SEM bulk actions/filtros/CRUD completo nesta fase (seção
 * 24 do pedido: "não trazer inicialmente bulk delete, bulk duplicate, todos
 * os filtros, CRUD inteiro").
 */
export function CockpitExecutionSection({
  clientId,
  currentSprintLabel,
  lastOptimizationLabel,
  registerReviewHref,
  operationHref,
  demandasOpenCount,
  demandasOverdueCount,
  demandasPreview,
  demandasHref,
  canOperate,
}: {
  clientId: string;
  currentSprintLabel: string | null;
  lastOptimizationLabel: string;
  registerReviewHref: string;
  operationHref: string;
  demandasOpenCount: number;
  demandasOverdueCount: number;
  demandasPreview: PendenciaItem[];
  demandasHref: string;
  /** Mesmo guard de `[id]/operation/page.tsx` (`client.status === "ativo"`)
   * — cliente pausado/encerrado continua mostrando os resumos (consulta de
   * histórico), só sem as ações de escrita (seção 9 do pedido original da
   * Fase 4, reaplicada aqui pras novas ações "Concluir"/"Registrar
   * revisão"). */
  canOperate: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Operação</h2>
          <Link href={operationHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
            Ver Operação →
          </Link>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <p className="text-[11px] text-overview-text-muted">Sprint atual</p>
            <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{currentSprintLabel ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-overview-text-muted">Última otimização</p>
            <p className="mt-0.5 text-sm font-medium text-overview-text-primary">{lastOptimizationLabel}</p>
          </div>
        </div>
        {canOperate && (
          <Link href={registerReviewHref} scroll={false} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">
            + Registrar revisão
          </Link>
        )}
      </div>

      <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Demandas</h2>
            <p className="mt-1 text-[13px] text-overview-text-secondary">
              {demandasOpenCount} em aberto
              {demandasOverdueCount > 0 && ` · ${demandasOverdueCount} atrasada${demandasOverdueCount !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Link href={demandasHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
            Ver Demandas →
          </Link>
        </div>
        {demandasPreview.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {demandasPreview.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_PRIORITY_DOT_CLASS[item.priority]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-overview-text-primary">{item.title}</span>
                <span className="shrink-0 text-xs text-overview-text-muted">{formatDueDate(item.dueDate)}</span>
                {canOperate && <CockpitCompleteTaskButton taskId={item.id} clientId={clientId} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-overview-text-secondary">Nenhuma demanda aberta.</p>
        )}
      </div>
    </div>
  );
}
