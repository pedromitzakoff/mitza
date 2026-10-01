import { formatCurrency, formatCount, formatShortDate } from "@/lib/format";
import type { MetasRow, MetasRowUnit } from "@/lib/metas-table";
import type { MetricTone } from "@/lib/metric-diagnostics";

/**
 * "RESUMO DAS METAS" — hero section do módulo Metas (Etapa "MEGA FACELIFT
 * — Fase 2"). Visualização inspirada conceitualmente num plano mensal
 * virando trajetória diária, mas construída só com tokens/cores já
 * existentes do design system MITZA (`overview-*`, `TONE_CLASSES` no mesmo
 * espírito de `performance-diagnostic.tsx`) — nenhuma linguagem visual
 * nova.
 *
 * Colunas Indicador/Meta/Realizado ficam `sticky` (scroll horizontal só
 * move os dias) — primeira leitura (o que importa, de cara) nunca sai de
 * vista mesmo num mês de 31 dias.
 */

const TONE_TEXT_CLASSES: Record<MetricTone, string> = {
  critical: "text-red-700 dark:text-red-400",
  attention: "text-amber-700 dark:text-amber-400",
  normal: "text-overview-text-primary",
};

function formatValue(value: number | null, unit: MetasRowUnit): string {
  if (value === null) return "—";
  if (unit === "currency") return formatCurrency(value);
  if (unit === "ratio_x") return `${value.toFixed(1)}x`;
  return formatCount(Math.round(value));
}

const STICKY_LEFT_INDICADOR = "left-0";
const STICKY_LEFT_META = "left-[140px]";
const STICKY_LEFT_REALIZADO = "left-[260px]";
const STICKY_COL_CLASSES = "sticky z-10 bg-overview-surface";

export function MetasSummaryTable({ rows }: { rows: MetasRow[] }) {
  if (rows.length === 0) return null;

  const days = rows[0].days;

  return (
    <div className="overflow-x-auto rounded-lg border border-overview-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-overview-border bg-overview-surface-subtle">
            <th className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_INDICADOR} w-[140px] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}>
              Indicador
            </th>
            <th className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_META} w-[120px] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}>
              Meta do mês
            </th>
            <th className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_REALIZADO} w-[120px] border-r border-overview-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted`}>
              Realizado
            </th>
            {days.map((day) => (
              <th
                key={day.date}
                className={`w-[64px] px-2 py-2 text-right text-[11px] font-medium tabular-nums ${
                  day.isFuture ? "text-overview-text-muted" : "text-overview-text-secondary"
                }`}
              >
                {formatShortDate(day.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-overview-border last:border-0">
              <td className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_INDICADOR} px-3 py-2 font-medium text-overview-text-primary`}>{row.label}</td>
              <td className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_META} px-3 py-2 text-right tabular-nums text-overview-text-secondary`}>
                {formatValue(row.targetMonth, row.unit)}
              </td>
              <td className={`${STICKY_COL_CLASSES} ${STICKY_LEFT_REALIZADO} border-r border-overview-border px-3 py-2 text-right tabular-nums`}>
                <span className={`font-semibold ${TONE_TEXT_CLASSES[row.tone]}`}>{formatValue(row.realizedMonth, row.unit)}</span>
                {row.unavailableNote && <p className="mt-0.5 text-[10px] font-normal text-overview-text-muted">{row.unavailableNote}</p>}
              </td>
              {row.days.map((day) => (
                <td
                  key={day.date}
                  className={`px-2 py-2 text-right tabular-nums ${
                    day.isNeededRate
                      ? "bg-overview-surface-subtle text-overview-text-muted"
                      : day.isFuture
                        ? "text-overview-text-muted"
                        : "text-overview-text-secondary"
                  }`}
                  title={day.isNeededRate ? "Ritmo necessário a partir de hoje" : undefined}
                >
                  {formatValue(day.value, row.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
