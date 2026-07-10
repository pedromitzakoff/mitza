"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";

/**
 * Barra de filtros da Visão Geral — sempre visíveis: gestor/carteira, busca
 * e o botão "Filtros" (status da conta/atividade/ritmo/tarefas, escondidos
 * num popover até o usuário pedir). Nada de botão "Filtrar": toda mudança
 * navega na hora (busca com debounce curto). Roda inteiramente no client
 * porque precisa reagir a onChange, mas a URL final é montada com a mesma
 * lista de parâmetros que a página já preservava no buildUrl do servidor —
 * só a origem da navegação mudou (clique em vez de submit).
 */
export function AgencyFilters({
  defaultManager,
  gestores,
  manager,
  search,
  health,
  activity,
  ritmo,
  tasks,
  preserved,
}: {
  defaultManager: "all" | "me";
  gestores: { id: string; name: string }[];
  manager: string;
  search: string;
  health: string;
  activity: string;
  ritmo: string;
  tasks: string;
  preserved: { month?: string; sprintBucket?: string; sync?: string; meta?: string; sort?: string };
}) {
  const router = useRouter();
  const [searchText, setSearchText] = useState(search);
  const [open, setOpen] = useState(false);
  const skipNextDebounce = useRef(true);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", manager);
    if (search) next.set("search", search);
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

  // Debounce curto pra busca — evita navegar a cada tecla digitada. O
  // primeiro render (valor vindo do servidor) não deve disparar navegação.
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

  const secondaryCount = [health !== "todos", activity !== "todos", ritmo !== "todos", tasks !== "todas"].filter(
    Boolean,
  ).length;

  const hasAnythingToClear =
    secondaryCount > 0 || Boolean(search) || Boolean(preserved.sprintBucket) || Boolean(preserved.sync) || Boolean(preserved.meta);

  function clearFilters() {
    setSearchText("");
    skipNextDebounce.current = true;
    const next = new URLSearchParams();
    if (preserved.month) next.set("month", preserved.month);
    next.set("manager", defaultManager);
    router.push(`/?${next.toString()}`);
    setOpen(false);
  }

  const selectClasses = "w-full sm:w-auto rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select
        value={manager}
        onChange={(e) => router.push(buildUrl({ manager: e.target.value }))}
        className={selectClasses}
      >
        <option value="me">Meus clientes</option>
        <option value="all">Todos os clientes</option>
        {gestores.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <input
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Buscar cliente..."
        className="w-full flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none sm:w-auto"
      />

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
