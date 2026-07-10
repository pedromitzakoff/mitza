"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, Search, X } from "lucide-react";

export interface AgencyClientOption {
  id: string;
  name: string;
}

/**
 * Barra de filtros da Visão Geral — sempre visíveis: carteira (gestor),
 * cliente específico (combobox pesquisável) e o botão "Filtros" (status da
 * conta/atividade/ritmo/tarefas, escondidos num popover até o usuário
 * pedir). Nada de botão "Filtrar": toda mudança navega na hora. Roda
 * inteiramente no client porque precisa reagir a onChange/teclado, mas a
 * URL final é montada com a mesma lista de parâmetros que a página já
 * preservava no buildUrl do servidor — só a origem da navegação mudou
 * (clique/tecla em vez de submit).
 *
 * "Carteira" (gestor) e "Cliente" são dois filtros independentes — carteira
 * decide de quem são os clientes mostrados, cliente escolhe um específico
 * dentro do que já está visível. Por isso os dois nunca reaproveitam o
 * mesmo texto de opção sem contexto (cada um tem seu rótulo antes do
 * controle).
 */
export function AgencyFilters({
  defaultManager,
  gestores,
  manager,
  clients,
  selectedClientId,
  health,
  activity,
  ritmo,
  tasks,
  preserved,
}: {
  defaultManager: "all" | "me";
  gestores: { id: string; name: string }[];
  manager: string;
  clients: AgencyClientOption[];
  selectedClientId: string | undefined;
  health: string;
  activity: string;
  ritmo: string;
  tasks: string;
  preserved: { month?: string; sprintBucket?: string; sync?: string; meta?: string; sort?: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const clientInputRef = useRef<HTMLInputElement>(null);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (health !== "todos") next.set("health", health);
    if (activity !== "todos") next.set("activity", activity);
    if (ritmo !== "todos") next.set("ritmo", ritmo);
    if (tasks !== "todas") next.set("tasks", tasks);
    if (preserved.sprintBucket) next.set("sprintBucket", preserved.sprintBucket);
    if (preserved.sync) next.set("sync", preserved.sync);
    if (preserved.meta) next.set("meta", preserved.meta);
    if (preserved.sort) next.set("sort", preserved.sort);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/?${next.toString()}`;
  }

  const selectedClient = selectedClientId ? clients.find((c) => c.id === selectedClientId) ?? null : null;

  const filteredClients = useMemo(() => {
    const query = clientQuery.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(query));
  }, [clients, clientQuery]);

  function openClientCombobox() {
    setClientOpen(true);
    setClientQuery("");
    setHighlightedIndex(0);
    requestAnimationFrame(() => clientInputRef.current?.focus());
  }

  function handleClientQueryChange(value: string) {
    setClientQuery(value);
    setHighlightedIndex(0);
  }

  function selectClient(clientId: string) {
    router.push(buildUrl({ client: clientId }));
    setClientOpen(false);
  }

  function handleClientKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filteredClients.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedIndex === 0) {
        selectClient("");
      } else {
        const client = filteredClients[highlightedIndex - 1];
        if (client) selectClient(client.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setClientOpen(false);
    }
  }

  const secondaryCount = [health !== "todos", activity !== "todos", ritmo !== "todos", tasks !== "todas"].filter(
    Boolean,
  ).length;

  const hasAnythingToClear =
    secondaryCount > 0 ||
    Boolean(selectedClientId) ||
    Boolean(preserved.sprintBucket) ||
    Boolean(preserved.sync) ||
    Boolean(preserved.meta);

  function clearFilters() {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", defaultManager);
    router.push(`/?${next.toString()}`);
    setOpen(false);
    setClientOpen(false);
  }

  const selectClasses = "w-full sm:w-auto rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground";
  const filterGroupClasses = "flex items-center gap-1.5";
  const filterLabelClasses = "text-xs text-muted-foreground";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className={filterGroupClasses}>
        <span className={filterLabelClasses}>Carteira</span>
        <select
          value={manager}
          onChange={(e) => router.push(buildUrl({ manager: e.target.value }))}
          className={selectClasses}
          aria-label="Carteira"
        >
          <option value="me">Meus clientes</option>
          <option value="all">Todos os clientes</option>
          {gestores.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`${filterGroupClasses} relative w-full sm:w-auto`}>
        <span className={filterLabelClasses}>Cliente</span>
        <button
          type="button"
          onClick={() => (clientOpen ? setClientOpen(false) : openClientCombobox())}
          className="flex w-full min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-left text-sm text-foreground sm:w-48"
          aria-haspopup="listbox"
          aria-expanded={clientOpen}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{selectedClient ? selectedClient.name : "Todos os clientes"}</span>
        </button>
        {selectedClientId && !clientOpen && (
          <button
            type="button"
            onClick={() => router.push(buildUrl({ client: "" }))}
            aria-label="Limpar cliente selecionado"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}

        {clientOpen && (
          <>
            <button
              type="button"
              aria-label="Fechar seleção de cliente"
              onClick={() => setClientOpen(false)}
              className="fixed inset-0 z-40"
            />
            <div className="absolute left-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-lg" style={{ top: "100%" }}>
              <input
                ref={clientInputRef}
                type="text"
                role="combobox"
                aria-expanded={clientOpen}
                aria-controls="agency-client-listbox"
                aria-autocomplete="list"
                value={clientQuery}
                onChange={(e) => handleClientQueryChange(e.target.value)}
                onKeyDown={handleClientKeyDown}
                placeholder="Buscar cliente..."
                className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
              />
              <ul id="agency-client-listbox" role="listbox" className="mt-1.5 max-h-56 overflow-y-auto">
                <li
                  role="option"
                  aria-selected={!selectedClientId}
                  onClick={() => selectClient("")}
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
                      onClick={() => selectClient(client.id)}
                      className={`cursor-pointer truncate rounded-md px-2 py-1 text-sm ${
                        highlightedIndex === index + 1 ? "bg-zinc-100 dark:bg-zinc-900" : ""
                      } ${client.id === selectedClientId ? "font-medium text-brand" : "text-foreground"}`}
                    >
                      {client.name}
                    </li>
                  ))
                ) : (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum cliente encontrado.</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
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
            <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
              <div className="flex flex-col gap-2">
                <select
                  value={health}
                  onChange={(e) => router.push(buildUrl({ health: e.target.value }))}
                  className={selectClasses}
                >
                  <option value="todos">Status da conta: todos</option>
                  <option value="saudavel">Saudável</option>
                  <option value="atencao">Atenção</option>
                  <option value="critico">Crítico</option>
                </select>

                <select
                  value={activity}
                  onChange={(e) => router.push(buildUrl({ activity: e.target.value }))}
                  className={selectClasses}
                >
                  <option value="todos">Atividade: todas</option>
                  <option value="ativo">Ativos</option>
                  <option value="atencao">Atenção por inatividade</option>
                  <option value="inativo">Inativos</option>
                </select>

                <select
                  value={ritmo}
                  onChange={(e) => router.push(buildUrl({ ritmo: e.target.value }))}
                  className={selectClasses}
                >
                  <option value="todos">Ritmo de investimento: todos</option>
                  <option value="abaixo">Abaixo</option>
                  <option value="dentro">No ritmo</option>
                  <option value="acima">Acima</option>
                  <option value="sem_meta">Meta não configurada</option>
                </select>

                <select
                  value={tasks}
                  onChange={(e) => router.push(buildUrl({ tasks: e.target.value }))}
                  className={selectClasses}
                >
                  <option value="todas">Tarefas: todas</option>
                  <option value="atrasadas">Com tarefas atrasadas</option>
                  <option value="sem_atrasadas">Sem tarefas atrasadas</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {hasAnythingToClear && (
        <button type="button" onClick={clearFilters} className="text-xs text-brand hover:underline">
          Limpar filtros
        </button>
      )}
    </div>
  );
}
