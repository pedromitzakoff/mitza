"use client";

import { useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export interface ClientComboboxOption {
  id: string;
  name: string;
}

/**
 * Combobox pesquisável de cliente — compartilhado entre a Visão Geral
 * (`agency-filters.tsx`) e a tela Sprints. Não navega sozinho: recebe
 * `onSelect(clientId)` (string vazia = "Todos os clientes") e quem chama
 * decide como montar a URL, já que cada tela preserva um conjunto diferente
 * de parâmetros. Estado próprio (aberto/fechado, texto digitado, item
 * destacado) porque precisa reagir a teclado — não dá pra fazer isso só com
 * checkbox-hack.
 */
export function ClientCombobox({
  clients,
  selectedClientId,
  onSelect,
  label = "Cliente",
}: {
  clients: ClientComboboxOption[];
  selectedClientId: string | undefined;
  onSelect: (clientId: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = "client-combobox-listbox";

  const selectedClient = selectedClientId ? clients.find((c) => c.id === selectedClientId) ?? null : null;

  const filteredClients = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(trimmed));
  }, [clients, query]);

  function openCombobox() {
    setOpen(true);
    setQuery("");
    setHighlightedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setHighlightedIndex(0);
  }

  function select(clientId: string) {
    onSelect(clientId);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filteredClients.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedIndex === 0) {
        select("");
      } else {
        const client = filteredClients[highlightedIndex - 1];
        if (client) select(client.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative flex w-full items-center gap-1.5 sm:w-auto">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openCombobox())}
        className="flex w-full min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-left text-sm text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:w-48"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{selectedClient ? selectedClient.name : "Todos os clientes"}</span>
      </button>
      {selectedClientId && !open && (
        <button
          type="button"
          onClick={() => onSelect("")}
          aria-label="Limpar cliente selecionado"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label="Fechar seleção de cliente"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            className="mitza-menu-in absolute left-0 z-50 mt-1 w-72 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-float)]"
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
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar cliente..."
              className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
            />
            <ul id={listboxId} role="listbox" className="mt-1.5 max-h-56 overflow-y-auto">
              <li
                role="option"
                aria-selected={!selectedClientId}
                onClick={() => select("")}
                className={`cursor-pointer rounded-md px-2 py-1 text-sm ${
                  highlightedIndex === 0 ? "bg-zinc-100 dark:bg-zinc-900" : ""
                } ${!selectedClientId ? "font-medium text-brand" : "text-foreground"}`}
              >
                Todos os clientes
              </li>
              {filteredClients.length > 0 ? (
                filteredClients.map((client, index) => (
                  <li
                    key={client.id}
                    role="option"
                    aria-selected={client.id === selectedClientId}
                    onClick={() => select(client.id)}
                    className={`cursor-pointer truncate rounded-md px-2 py-1 text-sm ${
                      highlightedIndex === index + 1 ? "bg-zinc-100 dark:bg-zinc-900" : ""
                    } ${client.id === selectedClientId ? "font-medium text-brand" : "text-foreground"}`}
                  >
                    {client.name}
                  </li>
                ))
              ) : (
                <li className="px-2 py-1.5">
                  <EmptyState size="sm">Nenhum cliente encontrado.</EmptyState>
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
