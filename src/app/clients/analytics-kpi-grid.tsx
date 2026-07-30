import type { AnalyticsKpiCard } from "@/lib/analytics";

/**
 * Cards de KPI do Analytics — Etapa "Analytics Instagramável": lista curta e
 * explícita por objetivo (ver `buildAnalyticsKpiCards`, no máximo 4 cards
 * hoje), tipografia maior pra manter a hierarquia "números grandes, títulos
 * pequenos" pedida pro Hero também aqui, um degrau abaixo. Renderiza só os
 * cards que `buildAnalyticsKpiCards` decidiu incluir.
 */
export function AnalyticsKpiGrid({ cards }: { cards: AnalyticsKpiCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
      {cards.map((card) => (
        <div key={card.key} className="flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
