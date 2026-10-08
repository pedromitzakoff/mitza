"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  computeMinhaRotinaCounts,
  filterMinhaRotinaItems,
  formatMinhaRotinaDemandaDueLabel,
  parseMinhaRotinaFilters,
  serializeMinhaRotinaFilters,
  sortMinhaRotinaItems,
  type MinhaRotinaItem,
  type MinhaRotinaQuickFilter,
} from "@/lib/minha-rotina";
import { TASK_PRIORITY_REGISTRY } from "@/lib/status-registry";
import { CockpitCompleteTaskButton } from "@/app/clients/cockpit-complete-task-button";
import { MinhaRotinaRegisterButton } from "./minha-rotina-register-button";
import { EmptyState } from "@/components/ui/empty-state";

const QUICK_FILTERS: { value: MinhaRotinaQuickFilter; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "atrasadas", label: "Atrasadas" },
  { value: "semana", label: "Esta semana" },
  { value: "todas", label: "Todas" },
];

function IndicatorTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface px-3 py-2">
      <p className="text-2xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{value}</p>
      <p className="text-xs text-overview-text-secondary">{label}</p>
    </div>
  );
}

function MinhaRotinaItemRow({ item, today, returnTo }: { item: MinhaRotinaItem; today: string; returnTo: string }) {
  const isOverdue = item.kind === "demanda" && item.bucket === "atrasada";
  const dueLabel = item.kind === "demanda" ? formatMinhaRotinaDemandaDueLabel(item.dueDate, today) : item.nextExecutionLabel;

  return (
    <li className="flex min-h-[32px] items-center gap-2.5 border-b border-overview-border/60 px-2 py-1.5 last:border-0">
      <span className="shrink-0">
        {item.kind === "demanda" ? (
          <CockpitCompleteTaskButton taskId={item.id} clientId={item.clientId ?? ""} />
        ) : item.canOneClick ? (
          <MinhaRotinaRegisterButton recurringTaskId={item.id} clientId={item.clientId} returnTo={returnTo} />
        ) : (
          <Link
            href={`/minha-rotina?recurringTaskDetail=${item.id}&recurringTaskClient=${item.clientId}&recurringTaskSprint=${item.sprintId}`}
            scroll={false}
            className="mitza-pressable rounded-md border border-overview-border px-1.5 py-0.5 text-[11px] font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary"
          >
            Abrir
          </Link>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-overview-text-primary">{item.title}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
              item.kind === "demanda" ? "bg-overview-surface-subtle text-overview-text-muted" : "bg-brand/10 text-brand"
            }`}
          >
            {item.kind === "demanda" ? "Demanda" : "Rotina"}
          </span>
          {item.kind === "demanda" && (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${TASK_PRIORITY_REGISTRY[`task_priority.${item.priority}`].badgeClassName}`}>
              {TASK_PRIORITY_REGISTRY[`task_priority.${item.priority}`].label}
            </span>
          )}
        </span>
        {item.clientId ? (
          <Link href={`/clients/${item.clientId}`} className="truncate text-xs text-overview-text-secondary hover:underline">
            {item.clientName ?? "Cliente"}
          </Link>
        ) : (
          <span className="text-xs text-overview-text-secondary">Interna</span>
        )}
      </span>

      <span className={`shrink-0 text-xs font-medium tabular-nums ${isOverdue ? "text-red-600 dark:text-red-400" : "text-overview-text-secondary"}`}>
        {dueLabel}
      </span>
    </li>
  );
}

/**
 * MITZA ONE — Minha Rotina: orquestrador client-side, MESMO princípio de
 * `pendencias-page-client.tsx` — filtro/busca rodam inteiramente no
 * navegador sobre os dados já carregados pelo Server Component; trocar
 * filtro nunca recarrega a página. A URL é reescrita via
 * `history.replaceState` (nunca `router.push`), e os indicadores sempre
 * refletem a lista INTEIRA (antes do filtro de balde — só a busca por
 * texto, se preenchida, também restringe os indicadores, já que ela
 * representa "eu só quero ver isto", não um recorte de prazo).
 */
export function MinhaRotinaPageClient({ initialItems, today }: { initialItems: MinhaRotinaItem[]; today: string }) {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState(() => parseMinhaRotinaFilters(searchParams));
  const [items, setItems] = useState(initialItems);
  const [syncedInitialItems, setSyncedInitialItems] = useState(initialItems);

  // Ajuste de estado durante a renderização (padrão oficial do React) —
  // dados frescos do servidor (revalidados após concluir/registrar)
  // substituem a lista local sem precisar de um efeito extra.
  if (initialItems !== syncedInitialItems) {
    setSyncedInitialItems(initialItems);
    setItems(initialItems);
  }

  function updateFilters(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const params = serializeMinhaRotinaFilters(merged);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  const returnTo = `/minha-rotina${(() => {
    const query = serializeMinhaRotinaFilters(filters).toString();
    return query ? `?${query}` : "";
  })()}`;

  const counts = computeMinhaRotinaCounts(filterMinhaRotinaItems(items, "todas", filters.search));
  const visibleItems = sortMinhaRotinaItems(filterMinhaRotinaItems(items, filters.quickFilter, filters.search));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-overview-text-primary">Minha Rotina</h1>
        <p className="text-sm text-overview-text-secondary">Suas responsabilidades em toda a carteira.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <IndicatorTile label="Para hoje" value={counts.today} />
        <IndicatorTile label="Atrasadas" value={counts.overdue} />
        <IndicatorTile label="Esta semana" value={counts.week} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
          {QUICK_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filters.quickFilter === option.value}
              onClick={() => updateFilters({ quickFilter: option.value })}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                filters.quickFilter === option.value ? "bg-brand text-white" : "bg-overview-surface-subtle text-overview-text-secondary hover:text-overview-text-primary"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={filters.search}
          onChange={(event) => updateFilters({ search: event.target.value })}
          placeholder="Buscar cliente ou tarefa..."
          aria-label="Buscar cliente ou tarefa"
          className="ml-auto w-full max-w-[220px] rounded-md border border-overview-border bg-transparent px-2.5 py-1 text-xs text-overview-text-primary outline-none focus:border-brand"
        />
      </div>

      <div className="rounded-lg border border-overview-border bg-overview-surface">
        {visibleItems.length > 0 ? (
          <ul className="flex flex-col">
            {visibleItems.map((item) => (
              <MinhaRotinaItemRow key={`${item.kind}-${item.id}-${item.clientId ?? "interna"}`} item={item} today={today} returnTo={returnTo} />
            ))}
          </ul>
        ) : (
          <EmptyState className="px-3 py-6 text-center" size="sm">
            {items.length === 0
              ? "Nenhuma tarefa cadastrada para você ainda."
              : filters.quickFilter === "hoje"
                ? "Nenhuma tarefa para hoje."
                : filters.quickFilter === "atrasadas"
                  ? "Nenhuma demanda atrasada."
                  : filters.quickFilter === "semana"
                    ? "Nada mais previsto para esta semana."
                    : "Nenhum item encontrado para esta busca."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
