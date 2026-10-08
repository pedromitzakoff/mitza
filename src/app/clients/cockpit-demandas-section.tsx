import Link from "next/link";
import { formatDueDate } from "@/lib/format";
import { TASK_PRIORITY_DOT_CLASS } from "./task-labels";
import { CockpitCompleteTaskButton } from "./cockpit-complete-task-button";
import type { PendenciaItem } from "@/lib/pendencias";

/**
 * MITZA ONE — Etapa "Simplificação da Operação": extraído de
 * `cockpit-execution-section.tsx` (MITZA ONE — Fase 1, seção "Execução"),
 * que reunia Operação (sprint atual/última otimização/Registrar revisão) e
 * Demandas no MESMO componente, em 2 cards lado a lado. A seção visual de
 * Operação saiu do Cockpit (seção 2 do pedido desta etapa) — este arquivo é
 * só a metade de Demandas, com a MESMA lógica de sempre, nunca reescrita:
 * contagem aberta/atrasada + até 3 mais urgentes (`loadPendenciasRawData`/
 * `countOpenDemandas`, resolvidos em `[id]/page.tsx`) com "Concluir" inline
 * (`completeTaskAction`, a mesma Server Action da Demandas completa).
 *
 * `cockpit-execution-section.tsx` (arquivo antigo) foi removido por não ter
 * mais nenhum consumidor — isto é limpeza de um componente de APRESENTAÇÃO
 * exclusivo do Cockpit (Fase 1), nunca do sistema de Operação em si:
 * sprints, snapshots, revisões de conta, `/operation` e tudo que vive em
 * `operation-section.tsx` continuam intocados.
 */
export function CockpitDemandasSection({
  clientId,
  demandasOpenCount,
  demandasOverdueCount,
  demandasPreview,
  demandasHref,
  canOperate,
}: {
  clientId: string;
  demandasOpenCount: number;
  demandasOverdueCount: number;
  demandasPreview: PendenciaItem[];
  demandasHref: string;
  /** Mesmo guard de sempre (`client.status === "ativo"`) — cliente pausado/
   * encerrado continua mostrando os resumos, só sem a ação "Concluir". */
  canOperate: boolean;
}) {
  return (
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
  );
}
