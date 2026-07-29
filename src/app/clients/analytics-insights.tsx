import type { AnalyticsInsight } from "@/lib/analytics";

/**
 * Insights determinísticos (sem IA) — só título/assunto/explicação curta,
 * nunca uma análise longa ou uma conclusão estratégica forte (ex.: nunca
 * "essa campanha é ruim", só o fato observado: quem gastou mais sem
 * resultado). O período já está implícito na tela (cabeçalho do Analytics),
 * nunca repetido em cada card.
 */
export function AnalyticsInsights({ insights }: { insights: AnalyticsInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {insights.map((insight) => (
        <div key={insight.key} className="rounded-md border border-border p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{insight.title}</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{insight.subject}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{insight.detail}</p>
        </div>
      ))}
    </div>
  );
}
