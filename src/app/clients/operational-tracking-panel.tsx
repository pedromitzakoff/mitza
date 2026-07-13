import type { OperationalTrackingRow } from "@/lib/operational-tracking";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { formatShortDate } from "@/lib/format";

const TYPE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
};

/**
 * "Rotinas do Cliente" (Etapa 58: antes "Acompanhamento operacional" — nome
 * renomeado só na UI, por ficar conceitualmente perto demais de
 * "Acompanhamento da Conta"). Faixa horizontal compacta de última/próxima
 * ocorrência de cada rotina de relacionamento — nunca um card grande por
 * informação. A linha "Última execução operacional" que existia aqui antes
 * foi removida da UI (Etapa 58, seção 13): ficou redundante com os
 * indicadores mais específicos que já existem (última análise, última
 * otimização, última reunião, última entrega). O dado em si
 * (`client_last_operational_activity`) continua sendo usado normalmente em
 * Prioridades — só esta linha de exibição foi removida. Reaproveita
 * `formatLastOptimizationLabel` (já existia pra "última otimização" na Visão
 * Geral) pros dois tipos.
 */
export function OperationalTrackingPanel({
  tracking,
  today,
}: {
  tracking: Record<"reuniao" | "entrega_criativo", OperationalTrackingRow>;
  today: Date;
}) {
  const rows = (["reuniao", "entrega_criativo"] as const).map((type) => tracking[type]);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Rotinas do cliente</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
