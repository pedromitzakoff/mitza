"use client";

import { useEffect, useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { ALL_METRIC_CARD_IDS, DEFAULT_SELECTED_METRIC_IDS, type MetricCardId, type MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";

/**
 * MITZA ONE — Cockpit Único do Cliente, "Performance Meta Ads" / aba
 * Indicadores. Etapa "Redesign e organização visual do Cockpit" (pedido
 * explícito do usuário): a personalização de métricas (removida na
 * consolidação anterior) volta aqui — 6 indicadores por padrão, escolha
 * livre entre os 14 disponíveis, preferência por cliente persistida em
 * `localStorage` (mesmo padrão já usado em todo o resto do produto, nunca
 * uma tabela nova). Cards sempre aparecem na ordem canônica por categoria
 * (Entrega/Tráfego/Resultados/Receita) — reordenação manual não é
 * necessária aqui (diferente da antiga personalização da Etapa 2.2, que
 * tinha setas pra cima/baixo); escolher QUAIS aparecem já resolve o
 * pedido de reduzir poluição visual sem a complexidade extra de ordem
 * livre.
 *
 * Todo VALOR já chega pronto do servidor (`buildMetricCardViewModels`) —
 * este componente nunca recalcula nada, só decide QUAIS cards aparecem.
 */

const STORAGE_KEY_PREFIX = "mitza:cockpit:ad-metrics:";

const CATEGORY_GROUPS: { title: string; ids: MetricCardId[] }[] = [
  { title: "Entrega", ids: ["impressions", "reach", "frequency", "cpm"] },
  { title: "Tráfego", ids: ["clicks", "linkClicks", "ctr", "linkCtr", "cpc", "linkCpc"] },
  { title: "Resultados", ids: ["investment", "results", "costPerResult"] },
  { title: "Receita", ids: ["roas"] },
];

function isMetricCardId(value: unknown): value is MetricCardId {
  return typeof value === "string" && (ALL_METRIC_CARD_IDS as string[]).includes(value);
}

function loadStoredSelection(clientId: string): MetricCardId[] | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${clientId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isMetricCardId);
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function saveStoredSelection(clientId: string, ids: MetricCardId[]) {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${clientId}`, JSON.stringify(ids));
  } catch {
    // Armazenamento indisponível — personalização não persiste entre
    // sessões nesse caso, nunca quebra a tela por isso.
  }
}

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

export function CockpitAdMetricCards({ clientId, cards }: { clientId: string; cards: MetricCardViewModel[] }) {
  const [selectedIds, setSelectedIds] = useState<MetricCardId[]>(DEFAULT_SELECTED_METRIC_IDS);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const panelId = useId();

  // Mesmo cuidado de hidratação já usado em todo o resto do produto
  // (`DataFreshnessTimer`, antiga `MetricCardsPanel`): a primeira
  // renderização usa sempre o default (idêntico no servidor e no cliente),
  // só troca pra preferência salva dentro de um `useEffect`.
  useEffect(() => {
    function applyStoredSelection() {
      const stored = loadStoredSelection(clientId);
      if (stored) setSelectedIds(stored);
    }
    applyStoredSelection();
  }, [clientId]);

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  // Sempre na ordem canônica (ALL_METRIC_CARD_IDS, já agrupada por
  // categoria) — nunca a ordem em que o usuário marcou os checkboxes.
  const visibleCards = ALL_METRIC_CARD_IDS.map((id) => (selectedIds.includes(id) ? cardsById.get(id) : undefined)).filter(
    (card): card is MetricCardViewModel => card !== undefined,
  );

  function toggleMetric(id: MetricCardId) {
    const next = selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id];
    setSelectedIds(next);
    saveStoredSelection(clientId, next);
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {visibleCards.map((card) => (
          <AdMetricCard key={card.id} card={card} />
        ))}
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setIsCustomizing((current) => !current)}
          aria-expanded={isCustomizing}
          aria-controls={panelId}
          className="mitza-pressable inline-flex items-center gap-1.5 rounded-md border border-overview-border bg-overview-surface px-2.5 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Personalizar indicadores ({selectedIds.length}/{ALL_METRIC_CARD_IDS.length})
        </button>

        {isCustomizing && (
          <div id={panelId} className="mt-2 max-w-md rounded-lg border border-overview-border bg-overview-surface p-3">
            <p className="text-xs text-overview-text-secondary">Escolha quais indicadores aparecem — os outros continuam só a um clique daqui.</p>
            <div className="mt-2 flex flex-col gap-2.5">
              {CATEGORY_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">{group.title}</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {group.ids.map((id) => {
                      const card = cardsById.get(id);
                      if (!card) return null;
                      return (
                        <li key={id}>
                          <label className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-overview-text-primary hover:bg-overview-surface-hover">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(id)}
                              onChange={() => toggleMetric(id)}
                              className="h-4 w-4 rounded border-overview-border text-brand focus:ring-brand"
                            />
                            {card.label}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
