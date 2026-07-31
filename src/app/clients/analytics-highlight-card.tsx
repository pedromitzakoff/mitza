import type { PeriodHighlight } from "@/lib/period-highlights";

/**
 * Um card de "Destaques do período" — Etapa "Resumo Executivo". Primeira
 * linha do corpo é sempre o "quem" (nome do criativo/campanha/data), em
 * destaque; as seguintes são o "quanto", em tom secundário. O destaque
 * "Atenção" (`cpa-alert`) ganha cor de alerta — é o único card desta lista
 * que representa algo que precisa de ação, nunca um resultado positivo.
 */
export function AnalyticsHighlightCard({ highlight }: { highlight: PeriodHighlight }) {
  const isAlert = highlight.key === "cpa-alert";

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-4 ${
        isAlert ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : "border-border bg-card"
      }`}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span aria-hidden="true">{highlight.emoji}</span>
        {highlight.title}
      </p>
      <div className="flex flex-col gap-0.5">
        {highlight.lines.map((line, index) => (
          <p key={index} className={index === 0 ? "text-sm font-medium text-foreground" : "text-xs text-muted-foreground"}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
