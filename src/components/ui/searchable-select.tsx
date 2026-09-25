"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export interface SearchableSelectOption {
  id: string;
  label: string;
  /** Texto secundário discreto (ex.: "(inativo)") — nunca entra na busca. */
  sublabel?: string;
}

const TRIGGER_CLASSES =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md border border-overview-border bg-transparent px-2 py-1 text-left text-xs text-overview-text-primary outline-none transition-colors hover:border-overview-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Filtro puro (sem hook) — extraído pra ser testável direto (seções 7/8/12
 * do pedido: busca case-insensitive por substring no `label`, nunca no
 * `sublabel`). `useFilteredOptions` abaixo é só um `useMemo` fino em cima
 * dela.
 */
export function filterSearchableOptions(options: SearchableSelectOption[], query: string): SearchableSelectOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return options;
  return options.filter((o) => o.label.toLowerCase().includes(trimmed));
}

function useFilteredOptions(options: SearchableSelectOption[], query: string) {
  return useMemo(() => filterSearchableOptions(options, query), [options, query]);
}

/**
 * Combobox pesquisável genérico (seção 7/8 do pedido "Pendências — Segunda
 * Rodada") — generaliza o padrão já comprovado em `ClientCombobox`
 * (`app/client-combobox.tsx`, usado por Visão Geral/Sprints/Lembretes) pra
 * qualquer lista de opções `{id, label}`, sem reescrever teclado/estado
 * vazio/fechamento a cada novo filtro. `ClientCombobox` continua existindo
 * como está (zero risco pros 3 lugares que já o usam) — esta é a peça nova,
 * pensada pra ser reaproveitada tanto aqui (Pendências) quanto na futura
 * navegação rápida entre clientes.
 */
export function SearchableSelect({
  options,
  selectedId,
  onSelect,
  placeholder = "Selecionar...",
  allLabel,
  searchPlaceholder = "Buscar...",
  emptyLabel = "Nenhum resultado encontrado.",
  ariaLabel,
  disabled = false,
}: {
  options: SearchableSelectOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeholder?: string;
  /** Rótulo da linha "limpar seleção" (ex.: "Todos os clientes") — omitir
   * esconde essa linha inteira (útil quando a seleção é sempre obrigatória). */
  allLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = selectedId ? (options.find((o) => o.id === selectedId) ?? null) : null;
  const filtered = useFilteredOptions(options, query);
  const offset = allLabel ? 1 : 0;

  function openSelect() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setHighlightedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function select(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1 + offset));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (allLabel && highlightedIndex === 0) {
        select(null);
      } else {
        const option = filtered[highlightedIndex - offset];
        if (option) select(option.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openSelect())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`${TRIGGER_CLASSES} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <Search className="h-3 w-3 shrink-0 text-overview-text-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
        {selectedId && !open && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar seleção"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                event.preventDefault();
                onSelect(null);
              }
            }}
            className="shrink-0 rounded p-0.5 text-overview-text-secondary hover:text-overview-text-primary"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            className="mitza-menu-in absolute left-0 z-50 mt-1 w-64 rounded-xl border border-overview-border bg-overview-surface p-2 shadow-[var(--shadow-float)]"
            style={{ top: "100%", transformOrigin: "top left" }}
          >
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary outline-none transition-colors focus:border-brand"
            />
            <ul id={listboxId} role="listbox" className="mt-1.5 max-h-56 overflow-y-auto">
              {allLabel && (
                <li
                  role="option"
                  aria-selected={!selectedId}
                  onClick={() => select(null)}
                  className={`cursor-pointer rounded-md px-2 py-1 text-xs ${
                    highlightedIndex === 0 ? "bg-overview-surface-hover" : ""
                  } ${!selectedId ? "font-medium text-brand" : "text-overview-text-primary"}`}
                >
                  {allLabel}
                </li>
              )}
              {filtered.length > 0 ? (
                filtered.map((option, index) => (
                  <li
                    key={option.id}
                    role="option"
                    aria-selected={option.id === selectedId}
                    onClick={() => select(option.id)}
                    className={`cursor-pointer truncate rounded-md px-2 py-1 text-xs ${
                      highlightedIndex === index + offset ? "bg-overview-surface-hover" : ""
                    } ${option.id === selectedId ? "font-medium text-brand" : "text-overview-text-primary"}`}
                  >
                    {option.label}
                    {option.sublabel && <span className="text-overview-text-muted"> {option.sublabel}</span>}
                  </li>
                ))
              ) : (
                <li className="px-2 py-1.5">
                  <EmptyState size="sm">{emptyLabel}</EmptyState>
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Variante multi-seleção (checkboxes) do mesmo mecanismo — usada por
 * Status/Prioridade em Pendências. Mesma busca/teclado/fechamento do
 * `SearchableSelect`; Enter alterna o item em vez de fechar (seleção
 * múltipla continua aberta pra marcar mais de um item em sequência).
 */
export function SearchableMultiSelect({
  options,
  selectedIds,
  onToggle,
  onClear,
  triggerLabel,
  searchPlaceholder = "Buscar...",
  emptyLabel = "Nenhum resultado encontrado.",
}: {
  options: SearchableSelectOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear?: () => void;
  triggerLabel: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const filtered = useFilteredOptions(options, query);

  function openSelect() {
    setOpen(true);
    setQuery("");
    setHighlightedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[highlightedIndex];
      if (option) onToggle(option.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openSelect())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mitza-pressable cursor-pointer rounded-md border border-overview-border px-2 py-1 text-xs text-overview-text-primary hover:bg-overview-surface-hover"
      >
        {triggerLabel}
        {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
      </button>

      {open && (
        <>
          <button type="button" aria-label="Fechar" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <div
            className="mitza-menu-in absolute left-0 z-50 mt-1 w-56 rounded-xl border border-overview-border bg-overview-surface p-2 shadow-[var(--shadow-float)]"
            style={{ top: "100%", transformOrigin: "top left" }}
          >
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-overview-border bg-transparent px-2 py-1 text-xs text-overview-text-primary outline-none transition-colors focus:border-brand"
            />
            <ul id={listboxId} role="listbox" aria-multiselectable="true" className="mt-1.5 max-h-56 overflow-y-auto">
              {filtered.length > 0 ? (
                filtered.map((option, index) => (
                  <li
                    key={option.id}
                    role="option"
                    aria-selected={selectedIds.includes(option.id)}
                    onClick={() => onToggle(option.id)}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                      highlightedIndex === index ? "bg-overview-surface-hover" : ""
                    }`}
                  >
                    <input type="checkbox" checked={selectedIds.includes(option.id)} readOnly className="pointer-events-none accent-brand" />
                    <span className="min-w-0 truncate text-overview-text-primary">{option.label}</span>
                  </li>
                ))
              ) : (
                <li className="px-2 py-1.5">
                  <EmptyState size="sm">{emptyLabel}</EmptyState>
                </li>
              )}
            </ul>
            {onClear && selectedIds.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="mt-1 w-full rounded-md px-2 py-1 text-left text-[11px] text-overview-text-secondary hover:text-overview-text-primary"
              >
                Limpar seleção
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
