import type { MetricCardId, MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";

/**
 * MITZA ONE — Cockpit Único do Cliente, seção "Performance Meta Ads"
 * (consolidação da antiga rota `/clients/[id]/meta-ads`, Etapas 2.1-2.4.1,
 * pra dentro do Cockpit — pedido do usuário: "só quero essa página no
 * sistema para cada cliente"). Grade de indicadores agrupada nas 4
 * categorias do pedido original da Etapa 2.4 (Entrega/Tráfego/Resultados/
 * Receita) — sempre todos visíveis, SEM painel de personalização: nenhuma
 * outra seção do Cockpit (Meta & Ritmo, Diagnóstico) oferece esse tipo de
 * customização, e "página única" pede um produto coeso, não uma segunda
 * preferência salva em `localStorage` só pra esta seção.
 *
 * Todo VALOR já chega pronto do servidor (`buildMetricCardViewModels`) —
 * este componente é Server Component puro, nunca recalcula nada.
 */

const CATEGORY_GROUPS: { title: string; ids: MetricCardId[] }[] = [
  { title: "Entrega", ids: ["impressions", "reach", "frequency", "cpm"] },
  { title: "Tráfego", ids: ["clicks", "linkClicks", "ctr", "linkCtr", "cpc", "linkCpc"] },
  { title: "Resultados", ids: ["results", "costPerResult"] },
  { title: "Receita", ids: ["roas"] },
];

function AdMetricCard({ card }: { card: MetricCardViewModel }) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{card.label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{card.value}</p>
      {card.comparison && (
        <p className={`mt-1 text-xs font-medium ${card.comparison.tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "text-overview-text-secondary"}`}>
          {card.comparison.text}
        </p>
      )}
    </div>
  );
}

export function CockpitAdMetricCards({ cards }: { cards: MetricCardViewModel[] }) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const investmentCard = cardsById.get("investment");

  return (
    <div className="flex flex-col gap-4">
      {investmentCard && (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,220px)]">
          <AdMetricCard card={investmentCard} />
        </div>
      )}
      {CATEGORY_GROUPS.map((group) => {
        const groupCards = group.ids.map((id) => cardsById.get(id)).filter((card): card is MetricCardViewModel => card !== undefined);
        if (groupCards.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{group.title}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {groupCards.map((card) => (
                <AdMetricCard key={card.id} card={card} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
