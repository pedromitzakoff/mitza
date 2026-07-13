import type { OperationalTrackingRow } from "@/lib/operational-tracking";
import { formatLastOptimizationLabel } from "@/lib/monthly-reports";
import { formatShortDate } from "@/lib/format";

const TYPE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  otimizacao: "Otimização",
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
};

/**
 * Bloco 6 do pedido de reorganização — "Acompanhamento operacional":
 * última/próxima ocorrência de cada tipo recorrente, numa única faixa
 * compacta (nunca um card grande por informação). Reaproveita
 * `formatLastOptimizationLabel` (já existia pra "última otimização" na
 * Visão Geral) pros três tipos, já que a função não é específica de
 * otimização — só recebe uma data. Quando não há nenhuma tarefa (passada ou
 * futura) de um tipo, mostra "—" em vez de inventar uma cadência.
 */
export function OperationalTrackingPanel({
  tracking,
  today,
}: {
  tracking: Record<"otimizacao" | "reuniao" | "entrega_criativo", OperationalTrackingRow>;
  today: Date;
}) {
  const rows = (["otimizacao", "reuniao", "entrega_criativo"] as const).map((type) => tracking[type]);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Acompanhamento operacional</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.type} className="flex flex-col gap-0.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {TYPE_LABEL[row.type]}
            </p>
            <p className="text-sm text-foreground">
              Última: {formatLastOptimizationLabel(row.lastDoneDate, today)}
            </p>
            <p className="text-xs text-muted-foreground">
              Próxima: {row.nextDueDate ? formatShortDate(row.nextDueDate) : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
