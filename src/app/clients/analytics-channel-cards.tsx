import { TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { AnalyticsChannelRow } from "@/lib/analytics";
import { formatCurrency } from "@/lib/format";

/**
 * "Canais" — Etapa "Analytics Instagramável": substitui a tabela HTML por
 * cards (pedido explícito do usuário). Chamado "Canais", nunca "Campanhas":
 * a MITZA não persiste identidade de campanha em nenhuma tabela hoje (ver
 * `lib/analytics.ts`), então o título reflete exatamente o dado real — o dia
 * em que existir granularidade de campanha, esse será um bloco novo e
 * separado, nunca uma reutilização enganosa deste. Só renderiza com mais de
 * 1 canal (regra inalterada da tabela anterior).
 */
export function AnalyticsChannelCards({ goal, rows }: { goal: PerformanceGoal; rows: AnalyticsChannelRow[] }) {
  if (rows.length < 2) return null;

  const config = PERFORMANCE_GOALS[goal];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.channel} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{TRAFFIC_CHANNELS[row.channel].label}</p>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Investimento</span>
              <span className="font-medium tabular-nums text-foreground">{formatCurrency(row.spend)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{config.resultMetricLabel}</span>
              <span className="font-medium tabular-nums text-foreground">{row.resultCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{config.costMetricShortLabel}</span>
              <span className="font-medium tabular-nums text-foreground">
                {row.costPerResult !== null ? formatCurrency(row.costPerResult) : "—"}
              </span>
            </div>
            {row.revenue !== null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Faturamento</span>
                <span className="font-medium tabular-nums text-foreground">{formatCurrency(row.revenue)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
