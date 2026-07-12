"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { ClientCombobox, type ClientComboboxOption } from "@/app/client-combobox";

/**
 * Filtros da lista de Relatórios (Etapa 45) — só o mês fica sempre visível
 * fora daqui; cliente e gestor ficam atrás do botão "Filtros" (seção 2 do
 * pedido: no máximo mês/cliente/gestor, e os dois últimos podem ficar num
 * botão discreto). Mesmo padrão de popover/contador já usado em
 * agency-filters.tsx e sprints-filters.tsx — nunca um terceiro sistema de
 * filtro diferente.
 */
export function ReportsFilters({
  clients,
  selectedClientId,
  month,
  isAdmin,
  gestores,
  manager,
}: {
  clients: ClientComboboxOption[];
  selectedClientId: string | undefined;
  month: string | undefined;
  isAdmin: boolean;
  gestores: { id: string; name: string }[];
  manager: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (month) next.set("month", month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/reports?${next.toString()}`;
  }

  const secondaryCount = [manager !== (isAdmin ? "all" : "me"), Boolean(selectedClientId)].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:bg-zinc-900"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Filtros
          {secondaryCount > 0 && (
            <span className="rounded-full bg-brand/10 px-1.5 text-[11px] font-semibold text-brand">
              {secondaryCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <button
              type="button"
              aria-label="Fechar filtros"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40"
            />
            <div className="absolute left-0 z-50 mt-2 w-72 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-float)]">
              <div className="flex flex-col gap-2">
                <select
                  value={manager}
                  onChange={(e) => router.push(buildUrl({ manager: e.target.value }))}
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  <option value="me">Meus clientes</option>
                  <option value="all">Todos os clientes</option>
                  {gestores.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                <ClientCombobox
                  clients={clients}
                  selectedClientId={selectedClientId}
                  onSelect={(clientId) => router.push(buildUrl({ client: clientId }))}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {secondaryCount > 0 && (
        <button
          type="button"
          onClick={() => router.push(buildUrl({ manager: isAdmin ? "all" : "me", client: "" }))}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
