"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientContractStatus } from "@/lib/supabase/database.types";

const SEARCH_DEBOUNCE_MS = 400;

/**
 * Filtros da tela Clientes — Platform Continuity System 1.0: elimina o
 * botão "Filtrar", que exigia um clique extra pra ver o resultado (as
 * outras telas com filtro — Sprints, Visão Geral, Relatórios — já navegam
 * na hora). Gestor/Status são `<select>`, então navegam direto no
 * `onChange`, igual às outras telas. Busca é texto livre: navegar a cada
 * tecla digitada seria pior, não melhor, então usa um debounce curto em
 * vez de exigir Enter/clique.
 */
export function ClientsFilters({
  search,
  managerFilter,
  statusFilter,
  gestores,
}: {
  search: string;
  managerFilter: string;
  statusFilter: ClientContractStatus | "todos";
  gestores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (search !== syncedSearch) {
    setSyncedSearch(search);
    setSearchValue(search);
  }

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (managerFilter !== "all") next.set("manager", managerFilter);
    if (statusFilter !== "todos") next.set("status", statusFilter);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    const query = next.toString();
    return query ? `/clients?${query}` : "/clients";
  }

  function navigate(overrides: Record<string, string>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ search: value }), SEARCH_DEBOUNCE_MS);
  }

  const hasAnyFilter = Boolean(search) || managerFilter !== "all" || statusFilter !== "todos";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
      <input
        value={searchValue}
        onChange={(event) => handleSearchChange(event.target.value)}
        placeholder="Buscar cliente..."
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />

      <select
        value={managerFilter}
        onChange={(event) => navigate({ manager: event.target.value })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="all">Gestor: todos</option>
        {gestores.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <select
        value={statusFilter}
        onChange={(event) => navigate({ status: event.target.value })}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <option value="todos">Status: todos</option>
        <option value="ativo">Ativo</option>
        <option value="pausado">Pausado</option>
        <option value="encerrado">Encerrado</option>
      </select>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => {
            setSearchValue("");
            navigate({ search: "", manager: "all", status: "todos" });
          }}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
