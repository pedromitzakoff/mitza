import type { AnalyticsKpiCard, AnalyticsKpiComparisonTone } from "@/lib/analytics";

const TONE_CLASSES: Record<AnalyticsKpiComparisonTone, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-500",
  neutral: "text-muted-foreground",
};

/**
 * Linha de estatísticas do Analytics — Etapa "Analytics Instagramável"
 * (facelift): divisores finos entre os cards em vez de cada um numa caixa
 * própria (pedido explícito: "prefiro cartões menores e mais elegantes",
 * nunca cartões grandes) — mesma linguagem de um "stat row" de produto
 * premium, não um grid de cards administrativos. Cada card ganha uma linha
 * de contexto (`card.comparison`) quando existe base real de comparação.
 */
export function AnalyticsKpiGrid({ cards }: { cards: AnalyticsKpiCard[] }) {
  return (
    <div className="flex flex-wrap divide-x divide-border">
      {cards.map((card) => (
        <div key={card.key} className="flex min-w-[7rem] flex-col gap-1 px-6 first:pl-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">{card.value}</p>
          {card.comparison && (
            <p className={`text-xs font-medium ${TONE_CLASSES[card.comparison.tone]}`}>{card.comparison.text}</p>
          )}
        </div>
      ))}
    </div>
  );
}
