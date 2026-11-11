"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatCount } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import type { ExplorationRow } from "@/lib/meta-ads-dashboard/exploration-data";

/**
 * "Anúncios" com visual de grade de cards (pedido do usuário: "deixar mais
 * bonito... poder visualizar de formas diferentes"). Puramente de
 * apresentação — reaproveita `ExplorationRow` (já calculado, mesmo dado da
 * tabela de Campanhas/Conjuntos) e `row.resultType`/`row.resultByGoal` pra
 * mostrar o Resultado/Custo do PRÓPRIO objetivo de cada anúncio, nunca um
 * número genérico. O quadrado cinza no lugar da imagem é proposital — não
 * existe preview de criativo hoje (`previewImageUrl` sempre `null`, ver
 * `creative-analytics.ts`); o espaço já fica reservado pra quando essa
 * captura existir, sem precisar redesenhar o card depois.
 *
 * Os pills "Ordenar por" são um atalho SEPARADO do clique-no-cabeçalho da
 * tabela (pedido explícito: "ordenar por maior conversão" precisa ser óbvio,
 * não escondido atrás de uma coluna) — por isso usam `row.resultType`
 * (o objetivo PRÓPRIO de cada linha) em vez de uma coluna fixa de um
 * objetivo só, pra funcionar igual numa conta com Leads e Vendas
 * misturados.
 */

export type AdSortKey = "spend" | "result" | "cost" | "name";

const SORT_OPTIONS: { key: AdSortKey; label: string }[] = [
  { key: "spend", label: "Investimento" },
  { key: "result", label: "Resultado" },
  { key: "cost", label: "Custo por resultado" },
  { key: "name", label: "Nome" },
];

export function sortValue(key: Exclude<AdSortKey, "name">, row: ExplorationRow): number {
  const entry = row.resultType ? row.resultByGoal[row.resultType] : undefined;
  if (key === "spend") return row.spend;
  if (key === "result") return entry?.count ?? -1;
  // "cost": sem base nunca vence como se fosse o mais barato — vai pro final.
  return entry?.cost ?? Number.POSITIVE_INFINITY;
}

export function sortAdRows(rows: ExplorationRow[], key: AdSortKey): ExplorationRow[] {
  const sorted = [...rows];
  if (key === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return sorted;
  }
  // Investimento/Resultado: maior primeiro. Custo: menor primeiro (mais
  // eficiente primeiro) — única exceção, por isso a comparação é invertida.
  const ascending = key === "cost";
  sorted.sort((a, b) => {
    const av = sortValue(key, a);
    const bv = sortValue(key, b);
    return ascending ? av - bv : bv - av;
  });
  return sorted;
}

/** Ícone de placeholder desenhado à mão (nunca `lucide-react` aqui) —
 * elimina qualquer dependência de biblioteca de ícone pra este elemento
 * específico, já que é só um espaço reservado visual, nunca informação. */
function PlaceholderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 text-overview-text-muted"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function AdCard({ row, showCampaignNames }: { row: ExplorationRow; showCampaignNames: boolean }) {
  const goal = row.resultType;
  const entry = goal ? row.resultByGoal[goal] : undefined;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
      <div className="flex aspect-square items-center justify-center bg-overview-surface-subtle">
        <PlaceholderIcon />
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-sm font-medium text-overview-text-primary" title={row.name}>
          {row.name}
        </p>
        {showCampaignNames && row.campaignNames && row.campaignNames.length > 0 && (
          <p className="truncate text-xs text-overview-text-muted">{row.campaignNames.join(" · ")}</p>
        )}
        {/* Empilhado, nunca lado a lado — 3 colunas numa coluna estreita de
            card nunca têm espaço suficiente pra um valor grande (ex.: "R$
            12.102,xx") sem cortar. Uma linha por métrica, label à esquerda
            e valor à direita, cada um com a largura inteira do card — o
            valor SEMPRE aparece completo, não importa o tamanho. */}
        <div className="mt-1.5 flex flex-col gap-1 border-t border-overview-border pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-[11px] font-medium text-overview-text-muted">Investimento</p>
            <p className="text-sm font-semibold tabular-nums text-overview-text-primary">{formatCurrency(row.spend)}</p>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-[11px] font-medium text-overview-text-muted">{goal ? PERFORMANCE_GOALS[goal].resultMetricLabel : "Resultado"}</p>
            <p className="text-sm font-semibold tabular-nums text-overview-text-primary">
              {entry?.count !== undefined && entry.count !== null ? formatCount(entry.count) : "—"}
            </p>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className="text-[11px] font-medium text-overview-text-muted">{goal ? PERFORMANCE_GOALS[goal].costMetricShortLabel : "Custo"}</p>
            <p className="text-sm font-semibold tabular-nums text-overview-text-primary">
              {entry?.cost !== undefined && entry.cost !== null ? formatCurrency(entry.cost) : "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdCardGrid({
  rows,
  showCampaignNames,
  emptyMessage,
}: {
  rows: ExplorationRow[];
  showCampaignNames: boolean;
  emptyMessage: string;
}) {
  const [sortKey, setSortKey] = useState<AdSortKey>("spend");
  const sortedRows = useMemo(() => sortAdRows(rows, sortKey), [rows, sortKey]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-overview-border px-4 py-6 text-center text-sm text-overview-text-secondary">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-overview-text-muted">Ordenar por</span>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setSortKey(option.key)}
            className={`mitza-pressable rounded-full px-2.5 py-1 text-xs font-medium ${
              sortKey === option.key
                ? "bg-brand text-white"
                : "border border-overview-border text-overview-text-secondary hover:text-overview-text-primary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedRows.map((row) => (
          <AdCard key={row.id} row={row} showCampaignNames={showCampaignNames} />
        ))}
      </div>
    </div>
  );
}
