import type { OperationalTrackingRow } from "@/lib/operational-tracking";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { formatShortDate } from "@/lib/format";
import type { OperationalActivityStatus } from "@/lib/operational-activity";

const TYPE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  otimizacao: "Otimização",
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
};

/** Cor de acento da "última execução operacional" — o mesmo sinal que já
 * vira alerta em Prioridades quando é atenção/inativo, aqui só como
 * destaque textual (nunca vermelho isolado sem que exista um problema real
 * já sinalizado em Prioridades — evita repetir o mesmo alerta duas vezes). */
const EXECUTION_TEXT_CLASSES: Record<OperationalActivityStatus, string> = {
  ativo: "text-muted-foreground",
  atencao: "text-amber-600 dark:text-amber-400",
  inativo: "text-red-600 dark:text-red-400",
};

/**
 * "Acompanhamento operacional" — última/próxima ocorrência de cada tipo
 * recorrente, numa única faixa compacta (nunca um card grande por
 * informação), com a última execução operacional do cliente (Etapa 15:
 * tarefa criada/concluída/editada/comentada ou sprint comentada — nunca uma
 * sincronização automática do Meta ou login) integrada ao cabeçalho da
 * própria seção, em vez de um card isolado. Reaproveita
 * `formatLastOptimizationLabel` (já existia pra "última otimização" na
 * Visão Geral) pros três tipos, já que a função não é específica de
 * otimização — só recebe uma data; localmente troca "Nunca" por "Sem
 * registro" (texto neutro, sem essa palavra repetida três vezes quando
 * nenhum dos três tipos ainda tem histórico).
 */
export function OperationalTrackingPanel({
  tracking,
  today,
  lastExecutionLabel,
  lastExecutionStatus,
}: {
  tracking: Record<"otimizacao" | "reuniao" | "entrega_criativo", OperationalTrackingRow>;
  today: Date;
  lastExecutionLabel: string;
  lastExecutionStatus: OperationalActivityStatus;
}) {
  const rows = (["otimizacao", "reuniao", "entrega_criativo"] as const).map((type) => tracking[type]);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Acompanhamento operacional</h2>
        <p className={`text-xs ${EXECUTION_TEXT_CLASSES[lastExecutionStatus]}`}>
          Última execução operacional: {lastExecutionLabel}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map((row) => {
          const lastLabel = row.lastDoneDate === null ? "Sem registro" : formatLastOptimizationLabel(row.lastDoneDate, today);
          return (
            <div key={row.type} className="flex flex-col gap-0.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {TYPE_LABEL[row.type]}
              </p>
              <p className="text-sm text-foreground">Última: {lastLabel}</p>
              <p className={`text-xs ${row.nextIsOverdue ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                Próxima: {row.nextDueDate ? formatShortDate(row.nextDueDate) : "—"}
                {row.nextIsOverdue && " (atrasada)"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
