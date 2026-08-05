"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useFloatingMenuPosition, FloatingPortalPanel } from "@/lib/floating-menu";
import type { AgencyClientOption } from "./agency-filters";

/** Substitui os antigos controles independentes "Carteira" (gestor) e
 * "Cliente" (combobox) por UM único seletor de escopo — pedido explícito do
 * usuário (barra de filtros redesenhada). Escolher um gestor limpa o
 * cliente selecionado e vice-versa: as duas coisas nunca coexistem na UI
 * nova, mesmo a URL ainda usando os dois params (`manager`/`client`) por
 * baixo — ver `AgencyFilters`, que traduz `ScopeValue` pra eles. */
export type ScopeValue = { kind: "all" } | { kind: "me" } | { kind: "manager"; id: string } | { kind: "client"; id: string };

export function ScopeSelector({
  value,
  gestores,
  clients,
  onSelect,
}: {
  value: ScopeValue;
  gestores: { id: string; name: string }[];
  clients: AgencyClientOption[];
  onSelect: (value: ScopeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const position = useFloatingMenuPosition(triggerRef, open, "left");

  const label = useMemo(() => {
    if (value.kind === "all") return "Todos os clientes";
    if (value.kind === "me") return "Minhas contas";
    if (value.kind === "manager") return gestores.find((g) => g.id === value.id)?.name ?? "Gestor";
    return clients.find((c) => c.id === value.id)?.name ?? "Cliente";
  }, [value, gestores, clients]);

  const trimmed = query.trim().toLowerCase();
  const filteredGestores = trimmed ? gestores.filter((g) => g.name.toLowerCase().includes(trimmed)) : gestores;
  const filteredClients = trimmed ? clients.filter((c) => c.name.toLowerCase().includes(trimmed)) : clients;

  function openMenu() {
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function select(next: ScopeValue) {
    onSelect(next);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mitza-pressable flex h-7 max-w-[10rem] items-center gap-1 rounded-md border border-overview-border bg-overview-surface px-2 text-xs font-medium text-overview-text-primary transition-colors hover:border-overview-border-strong sm:max-w-[15rem]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-overview-text-muted" aria-hidden="true" />
      </button>

      <FloatingPortalPanel
        open={open}
        position={position}
        onClose={() => setOpen(false)}
        role="listbox"
        closeLabel="Fechar seletor de escopo"
        className="w-72 rounded-lg border border-overview-border bg-overview-surface p-2 shadow-[var(--shadow-float)]"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar gestor ou cliente..."
          className="w-full rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary outline-none focus:border-overview-border-strong"
        />

        <div className="mt-1.5 max-h-72 overflow-y-auto">
          {!trimmed && (
            <ScopeGroup label="Visões">
              <ScopeOption label="Todos os clientes" active={value.kind === "all"} onClick={() => select({ kind: "all" })} />
              <ScopeOption label="Minhas contas" active={value.kind === "me"} onClick={() => select({ kind: "me" })} />
            </ScopeGroup>
          )}

          <ScopeGroup label="Gestores">
            {filteredGestores.length > 0 ? (
              filteredGestores.map((g) => (
                <ScopeOption
                  key={g.id}
                  label={g.name}
                  active={value.kind === "manager" && value.id === g.id}
                  onClick={() => select({ kind: "manager", id: g.id })}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[11px] text-overview-text-muted">Nenhum gestor encontrado.</p>
            )}
          </ScopeGroup>

          <ScopeGroup label="Clientes">
            {filteredClients.length > 0 ? (
              filteredClients.map((c) => (
                <ScopeOption
                  key={c.id}
                  label={c.name}
                  active={value.kind === "client" && value.id === c.id}
                  onClick={() => select({ kind: "client", id: c.id })}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-[11px] text-overview-text-muted">Nenhum cliente encontrado.</p>
            )}
          </ScopeGroup>
        </div>
      </FloatingPortalPanel>
    </div>
  );
}

function ScopeGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">{label}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function ScopeOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`truncate rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-overview-surface-hover ${
        active ? "font-medium text-brand" : "text-overview-text-primary"
      }`}
    >
      {label}
    </button>
  );
}
