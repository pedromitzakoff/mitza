"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { ALL_METRIC_CARD_IDS, DEFAULT_SELECTED_METRIC_IDS, type MetricCardId, type MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.2. Painel de KPIs configurável
 * do Dashboard Meta Ads — Client Component porque a seleção/ordem de
 * métricas é preferência PESSOAL (persistida em `localStorage`, por
 * navegador — pedido do usuário: "persistir de maneira simples, sem criar
 * infraestrutura desnecessária", nenhuma tabela nova). Todo VALOR exibido
 * (`cards`) já chega pronto do servidor (`buildMetricCardViewModels`) —
 * este componente nunca recalcula nada, só decide QUAIS cards aparecem e
 * EM QUE ORDEM.
 *
 * Mesmo cuidado de hidratação de `DataFreshnessTimer`
 * (`clients/data-freshness-timer.tsx`): a primeira renderização usa sempre
 * `DEFAULT_SELECTED_METRIC_IDS` (idêntico no servidor e no cliente antes da
 * hidratação) — só troca pra preferência salva dentro de um `useEffect`
 * (localStorage não existe no servidor), evitando qualquer divergência de
 * hidratação.
 */
const STORAGE_KEY_PREFIX = "mitza:meta-ads-dashboard:metrics:";

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
    // Armazenamento indisponível (modo privado, bloqueio do navegador) ou
    // conteúdo corrompido — cai no default, nunca quebra a tela por isso.
    return null;
  }
}

function saveStoredSelection(clientId: string, ids: MetricCardId[]) {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${clientId}`, JSON.stringify(ids));
  } catch {
    // Mesma tolerância do load — a personalização simplesmente não
    // persiste entre sessões nesse caso, nunca um erro visível pro usuário.
  }
}

function MetricCard({ card }: { card: MetricCardViewModel }) {
  return (
    <div className="min-h-[96px] rounded-xl border border-[#D9D3C9] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F6B65]">{card.label}</div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-[#17171A] tabular-nums">{card.value}</div>
      {card.comparison &&
        (card.comparison.tone === "positive" ? (
          <span className="mt-1.5 inline-block rounded-full bg-[#D8F238] px-2 py-0.5 text-[11px] font-bold text-[#17171A]">
            {card.comparison.text}
          </span>
        ) : (
          <span className="mt-1.5 block text-[11px] font-semibold text-[#6F6B65]">{card.comparison.text}</span>
        ))}
    </div>
  );
}

export function MetricCardsPanel({ clientId, cards }: { clientId: string; cards: MetricCardViewModel[] }) {
  const [selectedIds, setSelectedIds] = useState<MetricCardId[]>(DEFAULT_SELECTED_METRIC_IDS);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const panelId = useId();

  useEffect(() => {
    function applyStoredSelection() {
      const stored = loadStoredSelection(clientId);
      if (stored) setSelectedIds(stored);
    }
    applyStoredSelection();
  }, [clientId]);

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const visibleCards = selectedIds.map((id) => cardsById.get(id)).filter((card): card is MetricCardViewModel => card !== undefined);

  function updateSelection(next: MetricCardId[]) {
    setSelectedIds(next);
    saveStoredSelection(clientId, next);
  }

  function toggleMetric(id: MetricCardId) {
    updateSelection(selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
  }

  function moveMetric(id: MetricCardId, direction: -1 | 1) {
    const index = selectedIds.indexOf(id);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    updateSelection(next);
  }

  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visibleCards.map((card) => (
          <MetricCard key={card.id} card={card} />
        ))}
      </dl>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setIsCustomizing((current) => !current)}
          aria-expanded={isCustomizing}
          aria-controls={panelId}
          className="mitza-pressable inline-flex items-center gap-1.5 rounded-md border border-[#D9D3C9] bg-white px-2.5 py-1.5 text-xs font-medium text-[#6F6B65] hover:bg-[#EFE9E0] hover:text-[#17171A]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Personalizar métricas
        </button>

        {isCustomizing && (
          <div id={panelId} className="mt-2 max-w-sm rounded-lg border border-[#D9D3C9] bg-white p-3">
            <p className="text-xs text-[#6F6B65]">Escolha quais indicadores aparecem e em que ordem.</p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {ALL_METRIC_CARD_IDS.map((id) => {
                const card = cardsById.get(id);
                if (!card) return null;
                const selectedIndex = selectedIds.indexOf(id);
                const isSelected = selectedIndex !== -1;

                return (
                  <li key={id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-[#EFE9E0]">
                    <label className="flex flex-1 items-center gap-2 text-sm text-[#17171A]">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMetric(id)}
                        className="h-4 w-4 rounded border-[#C8BEAD] text-[#17171A] focus:ring-[#17171A]"
                      />
                      {card.label}
                    </label>
                    {isSelected && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          disabled={selectedIndex === 0}
                          onClick={() => moveMetric(id, -1)}
                          aria-label={`Mover ${card.label} pra cima`}
                          className="rounded p-0.5 text-[#6F6B65] hover:bg-white hover:text-[#17171A] disabled:opacity-30"
                        >
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={selectedIndex === selectedIds.length - 1}
                          onClick={() => moveMetric(id, 1)}
                          aria-label={`Mover ${card.label} pra baixo`}
                          className="rounded p-0.5 text-[#6F6B65] hover:bg-white hover:text-[#17171A] disabled:opacity-30"
                        >
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
