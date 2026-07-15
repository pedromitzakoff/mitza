"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Busca (nome/CNPJ/e-mail) + status — aplica sozinho (debounce curto na
 * busca, navegação imediata no select), sem botão "Filtrar". Mesmo padrão
 * de AgencyFilters (Visão Geral), só sem o popover de filtros secundários
 * (esta tela não ganhou filtros novos nesta rodada).
 */
export function SettingsClientsFilters({ search, status }: { search: string; status: string }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState(search);
  const skipNextDebounce = useRef(true);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    if (status !== "todos") next.set("status", status);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "" || value === "todos") next.delete(key);
      else next.set(key, value);
    }

    return `/settings/clients?${next.toString()}`;
  }

  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => {
      router.push(buildUrl({ search: searchText }));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <input
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        placeholder="Buscar por nome, CNPJ ou e-mail..."
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
      />
      <select
        value={status}
        onChange={(event) => router.push(buildUrl({ status: event.target.value }))}
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none transition-colors focus:border-zinc-500"
      >
        <option value="todos">Status: todos</option>
        <option value="ativo">Ativo</option>
        <option value="pausado">Pausado</option>
        <option value="encerrado">Encerrado</option>
        <option value="sem_gestor">Sem gestor principal</option>
      </select>
      {(search || status !== "todos") && (
        <button
          type="button"
          onClick={() => {
            setSearchText("");
            skipNextDebounce.current = true;
            router.push("/settings/clients");
          }}
          className="text-xs text-brand hover:underline"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
