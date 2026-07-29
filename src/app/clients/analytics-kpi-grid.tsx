import type { AnalyticsKpiCard } from "@/lib/analytics";

/**
 * Cards de KPI do Analytics — mesma linguagem visual de `MonthlyKpiSummary`
 * (label pequeno em maiúsculas + valor grande), nunca um componente visual
 * novo. Renderiza só os cards que `buildAnalyticsKpiCards` decidiu incluir
 * (nunca um card com "0" fabricado pra uma métrica sem dado).
 */
export function AnalyticsKpiGrid({ cards }: { cards: AnalyticsKpiCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.key} className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
          <p className="text-xl font-semibold tracking-tight text-foreground">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
