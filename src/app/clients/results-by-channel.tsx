import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";

/**
 * "Resultados por canal" (Etapa "Meta entra no card principal") — substitui
 * a parte de detalhamento por canal do antigo card "Performance do mês"
 * (removido: meta/CPA/comparação migraram pro card principal, ver
 * `monthly-kpi-summary.tsx`). Responsabilidade única: distribuir os
 * resultados do mês entre os canais que tiveram pelo menos 1 registro —
 * nunca repete meta, CPA, comparação ou qualquer diagnóstico, que já vivem
 * acima. Só aparece com dado em MAIS de 1 canal: com um único canal, a
 * distribuição não diz nada que o total (já exibido acima) não diga.
 */
export function ResultsByChannel({
  goal,
  channelBreakdown,
}: {
  goal: PerformanceGoal;
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
}) {
  if (channelBreakdown.length <= 1) return null;

  return (
    <div className="mt-3 border-t border-border pt-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Resultados por canal</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        {channelBreakdown.map(({ channel, resultCount }) => (
          <p key={channel} className="text-xs text-muted-foreground">
            {TRAFFIC_CHANNELS[channel].shortLabel}:{" "}
            <span className="font-medium text-foreground">{formatPerformanceResult(resultCount, goal)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
