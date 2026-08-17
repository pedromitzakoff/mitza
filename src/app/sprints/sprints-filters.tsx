"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter } from "lucide-react";
import { ClientCombobox, type ClientComboboxOption } from "@/app/client-combobox";

export type SprintsHealthFilter = "todos" | "saudavel" | "atencao" | "critico" | "sem_execucao";
export type SprintsRitmoFilter = "todos" | "dentro" | "acima" | "abaixo" | "sem_meta";
export type SprintsTasksFilter = "todas" | "atrasadas" | "hoje" | "sem_atrasadas";
export type SprintsOptimizationFilter = "todas" | "hoje" | "7dias" | "mais7" | "nunca";
export type SprintsActivityFilter = "todos" | "recente" | "sem_recente";
export type SprintsDisplayFilter = "todos" | "atencao" | "em_dia";

/**
 * Barra de filtros da tela Sprints (Etapa 44) — mesma linguagem visual e
 * mesmo comportamento da Visão Geral (`agency-filters.tsx`): só gestor/
 * carteira, busca de cliente e o botão "Filtros" ficam sempre visíveis; os 6
 * filtros secundários (situação do investimento, situação operacional,
 * tarefas, última otimização, atividade operacional, exibir) ficam num
 * popover, com contador e "Limpar filtros" discreto. Nada de botão
 * "Filtrar": toda mudança navega na hora (o combobox de cliente já filtra
 * localmente sem chamada de rede — não precisa de debounce).
 */
export function SprintsFilters({
  clients,
  selectedClientId,
  view,
  grouping,
  month,
  isAdmin,
  gestores,
  manager,
  health,
  ritmo,
  tasks,
  optimization,
  activity,
  display,
}: {
  clients: ClientComboboxOption[];
  selectedClientId: string | undefined;
  view: "current" | "monthly";
  grouping: "consolidated" | "sprints";
  month: string | undefined;
  isAdmin: boolean;
  gestores: { id: string; name: string }[];
  manager: string;
  health: SprintsHealthFilter;
  ritmo: SprintsRitmoFilter;
  tasks: SprintsTasksFilter;
  optimization: SprintsOptimizationFilter;
  activity: SprintsActivityFilter;
  display: SprintsDisplayFilter;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function buildUrl(overrides: Record<string, string>) {
    const next = new URLSearchParams();
    next.set("view", view);
    if (view === "monthly") next.set("grouping", grouping);
    if (view === "monthly" && month) next.set("month", month);
    next.set("manager", manager);
    if (selectedClientId) next.set("client", selectedClientId);
    if (health !== "todos") next.set("health", health);
    if (ritmo !== "todos") next.set("ritmo", ritmo);
    if (tasks !== "todas") next.set("tasks", tasks);
    if (optimization !== "todas") next.set("optimization", optimization);
    if (activity !== "todos") next.set("activity", activity);
    if (display !== "todos") next.set("display", display);

    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }

    return `/sprints?${next.toString()}`;
  }

  /** Interaction & Motion System 1.0: toda troca de filtro é a mesma
   * página, só o search param muda — `scroll: false` evita que a lista
   * pule pro topo a cada clique num filtro, preservando onde o gestor
   * estava olhando (mesmo princípio já usado nos links do drawer de
   * tarefa/otimização). */
  function pushFilters(overrides: Record<string, string>) {
    router.push(buildUrl(overrides), { scroll: false });
  }

  const secondaryCount = [
    health !== "todos",
    ritmo !== "todos",
    tasks !== "todas",
    optimization !== "todas",
    activity !== "todos",
    display !== "todos",
  ].filter(Boolean).length;

  const hasAnythingToClear = secondaryCount > 0 || Boolean(selectedClientId);

  function clearFilters() {
    pushFilters({
      manager: isAdmin ? "all" : "me",
      client: "",
      health: "",
      ritmo: "",
      tasks: "",
      optimization: "",
      activity: "",
      display: "",
    });
    setOpen(false);
  }

  const selectClasses =
    "w-full sm:w-auto rounded-md border border-overview-border bg-transparent px-2 py-1 text-sm text-overview-text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={manager}
        onChange={(e) => pushFilters({ manager: e.target.value })}
        className="h-8 rounded-md border border-overview-border bg-transparent px-2 text-xs text-overview-text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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

      <ClientCombobox
        clients={clients}
        selectedClientId={selectedClientId}
        onSelect={(clientId) => pushFilters({ client: clientId })}
        label=""
      />

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-overview-border px-2.5 text-xs font-medium text-overview-text-primary transition-colors hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Filtros
          {secondaryCount > 0 && (
            <span className="rounded-full bg-overview-brand-subtle px-1.5 text-[11px] font-semibold text-brand">
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
            <div className="mitza-menu-in absolute right-0 z-50 mt-2 w-72 rounded-xl border border-overview-border bg-overview-surface p-3 shadow-[var(--shadow-float)]">
              <div className="flex flex-col gap-2">
                <select
                  value={ritmo}
                  onChange={(e) => pushFilters({ ritmo: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todos">Situação do investimento: todas</option>
                  <option value="abaixo">Abaixo do esperado</option>
                  <option value="dentro">Dentro do esperado</option>
                  <option value="acima">Acima do esperado</option>
                  <option value="sem_meta">Sem planejamento</option>
                </select>

                <select
                  value={health}
                  onChange={(e) => pushFilters({ health: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todos">Situação operacional: todas</option>
                  <option value="saudavel">Em dia</option>
                  <option value="atencao">Atenção</option>
                  <option value="critico">Crítico</option>
                  <option value="sem_execucao">Sem execução</option>
                </select>

                <select
                  value={tasks}
                  onChange={(e) => pushFilters({ tasks: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todas">Tarefas: todas</option>
                  <option value="atrasadas">Com tarefas atrasadas</option>
                  <option value="hoje">Com tarefas para hoje</option>
                  <option value="sem_atrasadas">Sem tarefas atrasadas</option>
                </select>

                <select
                  value={optimization}
                  onChange={(e) => pushFilters({ optimization: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todas">Última revisão de conta: todas</option>
                  <option value="hoje">Hoje</option>
                  <option value="7dias">Últimos 7 dias</option>
                  <option value="mais7">Há mais de 7 dias</option>
                  <option value="nunca">Nunca realizada</option>
                </select>

                <select
                  value={activity}
                  onChange={(e) => pushFilters({ activity: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todos">Atividade operacional: toda</option>
                  <option value="recente">Com atividade recente</option>
                  <option value="sem_recente">Sem atividade recente</option>
                </select>

                <select
                  value={display}
                  onChange={(e) => pushFilters({ display: e.target.value })}
                  className={selectClasses}
                >
                  <option value="todos">Exibir: todos os clientes</option>
                  <option value="atencao">Somente quem precisa de atenção</option>
                  <option value="em_dia">Somente em dia</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {hasAnythingToClear && (
        <button
          type="button"
          onClick={clearFilters}
          className="rounded text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
