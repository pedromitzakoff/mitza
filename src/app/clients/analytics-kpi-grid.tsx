import type { AnalyticsKpiCard, AnalyticsKpiComparisonTone } from "@/lib/analytics";

const TONE_CLASSES: Record<AnalyticsKpiComparisonTone, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-500",
  neutral: "text-muted-foreground",
};

/**
 * Evidência do Capítulo II ("O que explica esse resultado?") — Etapa
 * "Analytics como Relatório": os mesmos números de sempre, mas como
 * evidência que sustenta a narrativa acima, não como um "stat row" de
 * dashboard — por isso sem divisores/caixa, só espaçamento generoso entre
 * os itens, tipografia um degrau abaixo da manchete do Capítulo I. Cada
 * card ganha uma linha de contexto (`card.comparison`) quando existe base
 * real de comparação.
 */
export function AnalyticsKpiGrid({ cards }: { cards: AnalyticsKpiCard[] }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      {cards.map((card) => (
        <div key={card.key} className="flex min-w-[7rem] flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="text-lg font-semibold tracking-tight text-foreground">{card.value}</p>
          {card.comparison && (
            <p className={`text-xs font-medium ${TONE_CLASSES[card.comparison.tone]}`}>{card.comparison.text}</p>
          )}
        </div>
      ))}
    </div>
  );
}
